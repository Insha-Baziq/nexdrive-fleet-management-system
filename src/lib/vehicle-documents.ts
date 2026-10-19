import "server-only";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { randomUUID } from "node:crypto";
import yauzl from "yauzl";
import { pool } from "@/lib/db";

export const MAX_VEHICLE_DOCUMENT_BYTES = 15 * 1024 * 1024;
export const VEHICLE_DOCUMENT_CATEGORIES = ["registration", "inspection", "insurance", "rental_agreement", "other"] as const;
export const VEHICLE_DOCUMENT_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "docx"] as const;
const uploadUrlLifetimeSeconds = 5 * 60;
const multipartPolicyOverheadBytes = 8 * 1024;
let configuredStorage: { bucket: string; client: S3Client } | null | undefined;
const supportedMimeTypes: Record<(typeof VEHICLE_DOCUMENT_EXTENSIONS)[number], string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export type VehicleDocumentCategory = (typeof VEHICLE_DOCUMENT_CATEGORIES)[number];
export type VehicleDocumentExtension = (typeof VEHICLE_DOCUMENT_EXTENSIONS)[number];
export type VehicleDocument = {
  id: string;
  name: string;
  category: VehicleDocumentCategory;
  expiry_date: string | null;
  visible_to_driver: boolean;
  file_name: string;
  file_extension: VehicleDocumentExtension;
  file_size: string;
  created_at: string;
  uploaded_at: string;
  uploaded_by_name: string;
};

export class VehicleDocumentError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function storageConfig() {
  if (configuredStorage !== undefined) return configuredStorage;
  const bucket = process.env.TIGRIS_STORAGE_BUCKET || process.env.TIGRIS_BUCKET;
  const accessKeyId = process.env.TIGRIS_STORAGE_ACCESS_KEY_ID || process.env.TIGRIS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY || process.env.TIGRIS_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    configuredStorage = null;
    return configuredStorage;
  }
  const endpoint = process.env.TIGRIS_ENDPOINT || "https://t3.storage.dev";
  configuredStorage = {
    bucket,
    client: new S3Client({
      endpoint,
      region: "auto",
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
  return configuredStorage;
}

export function getPrivateDocumentStorage() {
  return storageConfig();
}

export function getVehicleDocumentMimeType(extension: VehicleDocumentExtension) {
  return supportedMimeTypes[extension];
}

export function getVehicleDocumentExtension(fileName: string): VehicleDocumentExtension | null {
  const extension = fileName.trim().split(".").at(-1)?.toLowerCase();
  return extension && VEHICLE_DOCUMENT_EXTENSIONS.includes(extension as VehicleDocumentExtension)
    ? extension as VehicleDocumentExtension
    : null;
}

export async function createVehicleDocumentUpload(input: {
  tenantId: string;
  vehicleId: string;
  userId: string;
  name: string;
  category: VehicleDocumentCategory;
  expiryDate: string | null;
  visibleToDriver: boolean;
  fileName: string;
  fileSize: number;
  extension: VehicleDocumentExtension;
}) {
  const id = randomUUID();
  const storageKey = `vehicle-documents/${randomUUID()}`;
  const pendingStorageKey = `vehicle-document-uploads/${randomUUID()}`;
  const contentType = getVehicleDocumentMimeType(input.extension);
  const vehicle = await pool.query(
    "SELECT id FROM vehicle WHERE tenant_id = $1 AND id = $2",
    [input.tenantId, input.vehicleId],
  );
  if (!vehicle.rows[0]) throw new VehicleDocumentError("Vehicle not found.", 404);
  const storage = storageConfig();
  if (!storage) throw new VehicleDocumentError("Private document storage is not configured.", 503);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO vehicle_document
       (id, tenant_id, vehicle_id, name, category, expiry_date, visible_to_driver,
        storage_key, pending_storage_key, file_name, file_extension, content_type, file_size,
        status, created_by_user_id, upload_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, $13,
        'pending', $14, CURRENT_TIMESTAMP + INTERVAL '10 minutes')`,
      [id, input.tenantId, input.vehicleId, input.name, input.category, input.expiryDate,
        input.visibleToDriver, storageKey, pendingStorageKey, input.fileName, input.extension, contentType,
        input.fileSize, input.userId],
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
    await pool.query("DELETE FROM vehicle_document WHERE id = $1 AND tenant_id = $2 AND status = 'pending'", [id, input.tenantId]);
    throw new VehicleDocumentError("Could not prepare a private upload. Check the Tigris bucket setup.", 503);
  }
}

async function assertDocx(buffer: Buffer) {
  const entries = new Set<string>();
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, autoClose: true, decodeStrings: true }, (error, zipFile) => {
      if (error || !zipFile) return reject(error ?? new Error("Invalid DOCX archive"));
      let count = 0;
      zipFile.on("error", reject);
      zipFile.on("entry", (entry) => {
        count += 1;
        if (count > 4096 || (entry.generalPurposeBitFlag & 0x1) !== 0) {
          zipFile.close();
          reject(new Error("Invalid DOCX archive"));
          return;
        }
        entries.add(entry.fileName.replaceAll("\\", "/"));
        zipFile.readEntry();
      });
      zipFile.on("end", () => resolve());
      zipFile.readEntry();
    });
  });
  if (!entries.has("[Content_Types].xml") || !entries.has("word/document.xml")) {
    throw new Error("Invalid DOCX document");
  }
}

export async function validateVehicleDocumentContent(buffer: Buffer, extension: VehicleDocumentExtension) {
  if (buffer.length === 0 || buffer.length > MAX_VEHICLE_DOCUMENT_BYTES) return false;
  if (extension === "pdf") return buffer.subarray(0, 5).equals(Buffer.from("%PDF-"));
  if (extension === "png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === "jpg" || extension === "jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  try {
    await assertDocx(buffer);
    return true;
  } catch {
    return false;
  }
}

async function getStorage() {
  const storage = storageConfig();
  if (!storage) throw new VehicleDocumentError("Private document storage is not configured.", 503);
  return storage;
}

export async function finishVehicleDocumentUpload(tenantId: string, vehicleId: string, documentId: string, userId: string) {
  const pending = await pool.query<{
    storage_key: string; pending_storage_key: string; file_size: string; file_extension: VehicleDocumentExtension; content_type: string;
  }>(
    `SELECT storage_key, pending_storage_key, file_size::text, file_extension, content_type
     FROM vehicle_document
     WHERE tenant_id = $1 AND vehicle_id = $2 AND id = $3 AND created_by_user_id = $4
       AND status = 'pending' AND upload_expires_at > CURRENT_TIMESTAMP`,
    [tenantId, vehicleId, documentId, userId],
  );
  const row = pending.rows[0];
  if (!row) throw new VehicleDocumentError("Upload not found or expired.", 404);
  const storage = await getStorage();
  const processing = await pool.query(
    `UPDATE vehicle_document SET status = 'processing'
     WHERE tenant_id = $1 AND vehicle_id = $2 AND id = $3 AND created_by_user_id = $4
       AND status = 'pending' AND upload_expires_at > CURRENT_TIMESTAMP RETURNING id`,
    [tenantId, vehicleId, documentId, userId],
  );
  if (!processing.rows[0]) throw new VehicleDocumentError("Upload not found or expired.", 404);

  let head;
  try {
    head = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: row.pending_storage_key }));
  } catch {
    await pool.query("UPDATE vehicle_document SET status = 'pending' WHERE id = $1 AND status = 'processing'", [documentId]);
    throw new VehicleDocumentError("The uploaded file could not be found in private storage.", 400);
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
      await pool.query("UPDATE vehicle_document SET status = 'pending' WHERE id = $1 AND status = 'processing'", [documentId]);
      throw new VehicleDocumentError("The uploaded file could not be verified. Please retry.", 503);
    }
  }
  if (!valid) {
    await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: row.pending_storage_key })).catch(() => undefined);
    await pool.query(
      "DELETE FROM vehicle_document WHERE tenant_id = $1 AND vehicle_id = $2 AND id = $3 AND status = 'processing'",
      [tenantId, vehicleId, documentId],
    );
    throw new VehicleDocumentError("The uploaded file does not match the selected type and size limit.", 400);
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
      `UPDATE vehicle_document SET status = 'ready', uploaded_at = CURRENT_TIMESTAMP, pending_storage_key = NULL
     WHERE tenant_id = $1 AND vehicle_id = $2 AND id = $3 AND created_by_user_id = $4
       AND status = 'processing' AND upload_expires_at > CURRENT_TIMESTAMP RETURNING id`,
      [tenantId, vehicleId, documentId, userId],
    );
    if (!completed.rows[0]) throw new VehicleDocumentError("Upload not found or expired.", 404);
  } catch (error) {
    await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: row.storage_key })).catch(() => undefined);
    await pool.query("UPDATE vehicle_document SET status = 'pending' WHERE id = $1 AND status = 'processing'", [documentId]);
    if (error instanceof VehicleDocumentError) throw error;
    throw new VehicleDocumentError("The verified file could not be saved to private storage. Please retry.", 503);
  }
  await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: row.pending_storage_key })).catch(() => undefined);
}

export async function listVehicleDocuments(tenantId: string, vehicleId: string, user: { id: string }, role: string) {
  if (role === "driver") {
    const access = await pool.query(
      `SELECT 1 FROM driver d JOIN assignment a
         ON a.tenant_id = d.tenant_id AND a.driver_id = d.id AND a.ended_at IS NULL
       WHERE d.tenant_id = $1 AND d.user_id = $2 AND a.vehicle_id = $3 LIMIT 1`,
      [tenantId, user.id, vehicleId],
    );
    if (!access.rows[0]) throw new VehicleDocumentError("Vehicle not found.", 404);
  } else if (!["administrator", "fleet_manager", "manager"].includes(role)) {
    throw new VehicleDocumentError("Forbidden.", 403);
  }
  const result = await pool.query<VehicleDocument>(
    `SELECT d.id, d.name, d.category, d.expiry_date::text, d.visible_to_driver,
      d.file_name, d.file_extension, d.file_size::text, d.created_at::text,
      d.uploaded_at::text, u.display_name AS uploaded_by_name
     FROM vehicle_document d
     JOIN vehicle v ON v.id = d.vehicle_id AND v.tenant_id = d.tenant_id
     JOIN organization_membership u ON u.user_id = d.created_by_user_id AND u.tenant_id=d.tenant_id
     WHERE d.tenant_id = $1 AND d.vehicle_id = $2 AND d.status = 'ready'
       AND ($3::boolean = false OR d.visible_to_driver = true)
     ORDER BY d.created_at DESC, d.id`,
    [tenantId, vehicleId, role === "driver"],
  );
  return result.rows;
}

export async function getVehicleDocumentContent(
  tenantId: string,
  vehicleId: string,
  documentId: string,
  user: { id: string },
  role: string,
) {
  const staff = ["administrator", "fleet_manager", "manager"].includes(role);
  if (!staff && role !== "driver") throw new VehicleDocumentError("Forbidden.", 403);
  const result = await pool.query<{
    storage_key: string; content_type: string; file_name: string; file_size: string;
  }>(
    `SELECT d.storage_key, d.content_type, d.file_name, d.file_size::text
     FROM vehicle_document d
     JOIN vehicle v ON v.id = d.vehicle_id AND v.tenant_id = d.tenant_id
     WHERE d.tenant_id = $1 AND d.vehicle_id = $2 AND d.id = $3 AND d.status = 'ready'
       AND ($4::boolean = true OR (
         d.visible_to_driver = true AND EXISTS (
           SELECT 1 FROM driver dr JOIN assignment a
             ON a.tenant_id = dr.tenant_id AND a.driver_id = dr.id AND a.ended_at IS NULL
           WHERE dr.tenant_id = d.tenant_id AND dr.user_id = $5 AND a.vehicle_id = d.vehicle_id
         )
       ))`,
    [tenantId, vehicleId, documentId, staff, user.id],
  );
  const document = result.rows[0];
  if (!document) throw new VehicleDocumentError("Document not found.", 404);
  const storage = await getStorage();
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
    throw new VehicleDocumentError("Document content is unavailable.", 503);
  }
}
