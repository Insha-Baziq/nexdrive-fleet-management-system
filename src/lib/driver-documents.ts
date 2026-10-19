import "server-only";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db";
import {
  getPrivateDocumentStorage,
  getVehicleDocumentMimeType,
  MAX_VEHICLE_DOCUMENT_BYTES,
  validateVehicleDocumentContent,
  type VehicleDocumentExtension,
} from "@/lib/vehicle-documents";

export const DRIVER_DOCUMENT_CATEGORIES = ["driving_licence", "identity_document", "carte_vitale", "contract", "other"] as const;
export type DriverDocumentCategory = (typeof DRIVER_DOCUMENT_CATEGORIES)[number];
export type DriverDocument = {
  id: string;
  name: string;
  category: DriverDocumentCategory;
  expiry_date: string | null;
  file_name: string;
  file_extension: VehicleDocumentExtension;
  file_size: string;
  created_at: string;
  uploaded_at: string;
  uploaded_by_name: string;
};

const staffRoles = ["administrator", "fleet_manager", "manager"];
const uploadUrlLifetimeSeconds = 5 * 60;
const multipartPolicyOverheadBytes = 8 * 1024;

export class DriverDocumentError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function assertStaff(role: string) {
  if (!staffRoles.includes(role)) throw new DriverDocumentError("Forbidden.", 403);
}

async function assertDocumentAccess(tenantId: string, driverId: string, role: string, userId: string) {
  if (staffRoles.includes(role)) {
    await assertDriverInTenant(tenantId, driverId);
    return;
  }
  if (role !== "driver") throw new DriverDocumentError("Forbidden.", 403);
  const driver = await pool.query(
    `SELECT 1 FROM driver d
     JOIN "user" u ON u.id = d.user_id AND EXISTS (SELECT 1 FROM organization_membership membership WHERE membership.user_id=u.id AND membership.tenant_id=d.tenant_id AND membership.role='driver' AND membership.disabled_at IS NULL)
     WHERE d.tenant_id = $1 AND d.id = $2 AND d.user_id = $3`,
    [tenantId, driverId, userId],
  );
  if (!driver.rows[0]) throw new DriverDocumentError("Driver not found.", 404);
}

function storageConfig() {
  const storage = getPrivateDocumentStorage();
  if (!storage) throw new DriverDocumentError("Private document storage is not configured.", 503);
  return storage;
}

async function assertDriverInTenant(tenantId: string, driverId: string) {
  const driver = await pool.query("SELECT 1 FROM driver WHERE tenant_id = $1 AND id = $2", [tenantId, driverId]);
  if (!driver.rows[0]) throw new DriverDocumentError("Driver not found.", 404);
}

export async function createDriverDocumentUpload(input: {
  tenantId: string;
  driverId: string;
  userId: string;
  role: string;
  name: string;
  category: DriverDocumentCategory;
  expiryDate: string | null;
  fileName: string;
  fileSize: number;
  extension: VehicleDocumentExtension;
}) {
  assertStaff(input.role);
  if ((input.category === "driving_licence" || input.category === "identity_document") && !input.expiryDate) {
    throw new DriverDocumentError("An expiry date is required for this document category.", 400);
  }
  await assertDriverInTenant(input.tenantId, input.driverId);
  const storage = storageConfig();
  const id = randomUUID();
  const storageKey = `driver-documents/${randomUUID()}`;
  const pendingStorageKey = `driver-document-uploads/${randomUUID()}`;
  const contentType = getVehicleDocumentMimeType(input.extension);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO driver_document
       (id, tenant_id, driver_id, name, category, expiry_date, storage_key, pending_storage_key,
        file_name, file_extension, content_type, file_size, status, created_by_user_id, upload_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, 'pending', $13,
        CURRENT_TIMESTAMP + INTERVAL '10 minutes')`,
      [id, input.tenantId, input.driverId, input.name, input.category, input.expiryDate,
        storageKey, pendingStorageKey, input.fileName, input.extension, contentType, input.fileSize, input.userId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  try {
    const post = await createPresignedPost(storage.client, {
      Bucket: storage.bucket,
      Key: pendingStorageKey,
      Expires: uploadUrlLifetimeSeconds,
      Fields: { "Content-Type": contentType },
      Conditions: [
        ["eq", "$key", pendingStorageKey],
        ["eq", "$Content-Type", contentType],
        ["content-length-range", 1, MAX_VEHICLE_DOCUMENT_BYTES + multipartPolicyOverheadBytes],
      ],
    });
    return { id, uploadUrl: post.url, fields: post.fields, expiresIn: uploadUrlLifetimeSeconds };
  } catch {
    await pool.query("DELETE FROM driver_document WHERE id = $1 AND tenant_id = $2 AND status = 'pending'", [id, input.tenantId]);
    throw new DriverDocumentError("Could not prepare a private upload. Check the Tigris bucket setup.", 503);
  }
}

export async function finishDriverDocumentUpload(tenantId: string, driverId: string, documentId: string, userId: string, role: string) {
  assertStaff(role);
  const pending = await pool.query<{
    storage_key: string; pending_storage_key: string; file_size: string; file_extension: VehicleDocumentExtension; content_type: string;
  }>(
    `SELECT storage_key, pending_storage_key, file_size::text, file_extension, content_type
     FROM driver_document
     WHERE tenant_id = $1 AND driver_id = $2 AND id = $3 AND created_by_user_id = $4
       AND status = 'pending' AND upload_expires_at > CURRENT_TIMESTAMP`,
    [tenantId, driverId, documentId, userId],
  );
  const row = pending.rows[0];
  if (!row) throw new DriverDocumentError("Upload not found or expired.", 404);
  const storage = storageConfig();
  const processing = await pool.query(
    `UPDATE driver_document SET status = 'processing'
     WHERE tenant_id = $1 AND driver_id = $2 AND id = $3 AND created_by_user_id = $4
       AND status = 'pending' AND upload_expires_at > CURRENT_TIMESTAMP RETURNING id`,
    [tenantId, driverId, documentId, userId],
  );
  if (!processing.rows[0]) throw new DriverDocumentError("Upload not found or expired.", 404);

  let head;
  try {
    head = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: row.pending_storage_key }));
  } catch {
    await pool.query("UPDATE driver_document SET status = 'pending' WHERE id = $1 AND status = 'processing'", [documentId]);
    throw new DriverDocumentError("The uploaded file could not be found in private storage.", 400);
  }
  let valid = Boolean(head.ContentLength && head.ContentType === row.content_type
    && head.ContentLength === Number(row.file_size)
    && head.ContentLength <= MAX_VEHICLE_DOCUMENT_BYTES);
  if (valid) {
    try {
      const object = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: row.pending_storage_key }));
      const bytes = await object.Body?.transformToByteArray();
      valid = Boolean(bytes && bytes.byteLength <= MAX_VEHICLE_DOCUMENT_BYTES
        && await validateVehicleDocumentContent(Buffer.from(bytes), row.file_extension));
    } catch {
      await pool.query("UPDATE driver_document SET status = 'pending' WHERE id = $1 AND status = 'processing'", [documentId]);
      throw new DriverDocumentError("The uploaded file could not be verified. Please retry.", 503);
    }
  }
  if (!valid) {
    await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: row.pending_storage_key })).catch(() => undefined);
    await pool.query(
      "DELETE FROM driver_document WHERE tenant_id = $1 AND driver_id = $2 AND id = $3 AND status = 'processing'",
      [tenantId, driverId, documentId],
    );
    throw new DriverDocumentError("The uploaded file does not match the selected type and size limit.", 400);
  }

  const copySource = `${encodeURIComponent(storage.bucket)}/${row.pending_storage_key.split("/").map(encodeURIComponent).join("/")}`;
  try {
    await storage.client.send(new CopyObjectCommand({
      Bucket: storage.bucket,
      Key: row.storage_key,
      CopySource: copySource,
      CopySourceIfMatch: head.ETag,
      ContentType: row.content_type,
      MetadataDirective: "REPLACE",
    }));
    const completed = await pool.query(
      `UPDATE driver_document SET status = 'ready', uploaded_at = CURRENT_TIMESTAMP, pending_storage_key = NULL
       WHERE tenant_id = $1 AND driver_id = $2 AND id = $3 AND created_by_user_id = $4
         AND status = 'processing' AND upload_expires_at > CURRENT_TIMESTAMP RETURNING id`,
      [tenantId, driverId, documentId, userId],
    );
    if (!completed.rows[0]) throw new DriverDocumentError("Upload not found or expired.", 404);
  } catch (error) {
    await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: row.storage_key })).catch(() => undefined);
    await pool.query("UPDATE driver_document SET status = 'pending' WHERE id = $1 AND status = 'processing'", [documentId]);
    if (error instanceof DriverDocumentError) throw error;
    throw new DriverDocumentError("The verified file could not be saved to private storage. Please retry.", 503);
  }
  await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: row.pending_storage_key })).catch(() => undefined);
}

export async function listDriverDocuments(tenantId: string, driverId: string, role: string, userId: string) {
  await assertDocumentAccess(tenantId, driverId, role, userId);
  const result = await pool.query<DriverDocument>(
    `SELECT d.id, d.name, d.category, d.expiry_date::text, d.file_name, d.file_extension,
      d.file_size::text, d.created_at::text, d.uploaded_at::text, u.display_name AS uploaded_by_name
     FROM driver_document d
     JOIN driver dr ON dr.id = d.driver_id AND dr.tenant_id = d.tenant_id
     JOIN organization_membership u ON u.user_id = d.created_by_user_id AND u.tenant_id=d.tenant_id
     WHERE d.tenant_id = $1 AND d.driver_id = $2 AND d.status = 'ready'
     ORDER BY d.created_at DESC, d.id`,
    [tenantId, driverId],
  );
  return result.rows;
}

export async function getDriverDocumentContent(
  tenantId: string,
  driverId: string,
  documentId: string,
  role: string,
  userId: string,
) {
  await assertDocumentAccess(tenantId, driverId, role, userId);
  const result = await pool.query<{
    storage_key: string; content_type: string; file_name: string; file_size: string;
  }>(
    `SELECT d.storage_key, d.content_type, d.file_name, d.file_size::text
     FROM driver_document d
     JOIN driver dr ON dr.id = d.driver_id AND dr.tenant_id = d.tenant_id
     WHERE d.tenant_id = $1 AND d.driver_id = $2 AND d.id = $3 AND d.status = 'ready'`,
    [tenantId, driverId, documentId],
  );
  const document = result.rows[0];
  if (!document) throw new DriverDocumentError("Document not found.", 404);
  const storage = storageConfig();
  try {
    const object = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: document.storage_key }));
    if (!object.Body) throw new Error("Missing object body");
    const disposition = document.content_type.includes("wordprocessingml") ? "attachment" : "inline";
    const safeFileName = encodeURIComponent(document.file_name).replaceAll("'", "%27");
    return new Response(object.Body.transformToWebStream(), {
      status: 200,
      headers: {
        "Content-Type": document.content_type,
        "Content-Length": document.file_size,
        "Content-Disposition": `${disposition}; filename*=UTF-8''${safeFileName}`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none';",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    throw new DriverDocumentError("Document content is unavailable.", 503);
  }
}
