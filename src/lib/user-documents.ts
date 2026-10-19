import "server-only";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { randomUUID } from "node:crypto";
import {
  getPrivateDocumentStorage,
  getVehicleDocumentExtension,
  getVehicleDocumentMimeType,
  MAX_VEHICLE_DOCUMENT_BYTES,
  validateVehicleDocumentContent,
  type VehicleDocumentExtension,
} from "@/lib/vehicle-documents";
import { pool } from "@/lib/db";

const uploadUrlLifetimeSeconds = 5 * 60;
const multipartPolicyOverheadBytes = 8 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type UserDocument = {
  id: string;
  name: string;
  category: "general";
  file_name: string;
  file_extension: VehicleDocumentExtension;
  file_size: string;
  created_at: string;
  uploaded_at: string;
};

export class UserDocumentError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function storage() {
  const configured = getPrivateDocumentStorage();
  if (!configured) throw new UserDocumentError("Private document storage is not configured.", 503);
  return configured;
}

export function userDocumentExtension(fileName: string) {
  return getVehicleDocumentExtension(fileName);
}

export async function createUserDocumentUpload(input: {
  tenantId: string;
  userId: string;
  name: string;
  fileName: string;
  fileSize: number;
  extension: VehicleDocumentExtension;
}) {
  const id = randomUUID();
  const storageKey = `user-documents/${randomUUID()}`;
  const pendingStorageKey = `user-document-uploads/${randomUUID()}`;
  const contentType = getVehicleDocumentMimeType(input.extension);
  const store = storage();
  await pool.query(
    `INSERT INTO user_document
       (id, tenant_id, user_id, name, category, storage_key, pending_storage_key,
        file_name, file_extension, content_type, file_size, status, upload_expires_at)
     VALUES ($1,$2,$3,$4,'general',$5,$6,$7,$8,$9,$10,'pending',CURRENT_TIMESTAMP + INTERVAL '10 minutes')`,
    [id, input.tenantId, input.userId, input.name, storageKey, pendingStorageKey,
      input.fileName, input.extension, contentType, input.fileSize],
  );
  try {
    const post = await createPresignedPost(store.client, {
      Bucket: store.bucket,
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
    await pool.query("DELETE FROM user_document WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND status='pending'", [id, input.tenantId, input.userId]);
    throw new UserDocumentError("Could not prepare a private upload. Check the bucket setup.", 503);
  }
}

export async function listUserDocuments(tenantId: string, userId: string) {
  const result = await pool.query<UserDocument>(
    `SELECT id, name, category, file_name, file_extension, file_size::text,
       created_at::text, uploaded_at::text
     FROM user_document
     WHERE tenant_id=$1 AND user_id=$2 AND status='ready'
     ORDER BY created_at DESC, id`,
    [tenantId, userId],
  );
  return result.rows;
}

export async function finishUserDocumentUpload(tenantId: string, userId: string, documentId: string) {
  if (!uuidPattern.test(documentId)) throw new UserDocumentError("Upload not found or expired.", 404);
  const pending = await pool.query<{
    storage_key: string;
    pending_storage_key: string;
    file_size: string;
    file_extension: VehicleDocumentExtension;
    content_type: string;
  }>(
    `SELECT storage_key, pending_storage_key, file_size::text, file_extension, content_type
     FROM user_document
     WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND status='pending'
       AND upload_expires_at>CURRENT_TIMESTAMP`,
    [tenantId, userId, documentId],
  );
  const row = pending.rows[0];
  if (!row) throw new UserDocumentError("Upload not found or expired.", 404);
  const store = storage();
  const processing = await pool.query(
    `UPDATE user_document SET status='processing'
     WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND status='pending'
       AND upload_expires_at>CURRENT_TIMESTAMP RETURNING id`,
    [tenantId, userId, documentId],
  );
  if (!processing.rows[0]) throw new UserDocumentError("Upload not found or expired.", 404);

  let head;
  try {
    head = await store.client.send(new HeadObjectCommand({ Bucket: store.bucket, Key: row.pending_storage_key }));
  } catch {
    await pool.query("UPDATE user_document SET status='pending' WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND status='processing'", [tenantId, userId, documentId]);
    throw new UserDocumentError("The uploaded file could not be found in private storage.", 400);
  }
  let valid = Boolean(head.ContentLength && head.ContentType === row.content_type
    && head.ContentLength === Number(row.file_size)
    && head.ContentLength <= MAX_VEHICLE_DOCUMENT_BYTES);
  if (valid) {
    try {
      const object = await store.client.send(new GetObjectCommand({ Bucket: store.bucket, Key: row.pending_storage_key }));
      const bytes = await object.Body?.transformToByteArray();
      valid = Boolean(bytes && bytes.byteLength <= MAX_VEHICLE_DOCUMENT_BYTES
        && await validateVehicleDocumentContent(Buffer.from(bytes), row.file_extension));
    } catch {
      await pool.query("UPDATE user_document SET status='pending' WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND status='processing'", [tenantId, userId, documentId]);
      throw new UserDocumentError("The uploaded file could not be verified. Please retry.", 503);
    }
  }
  if (!valid) {
    await store.client.send(new DeleteObjectCommand({ Bucket: store.bucket, Key: row.pending_storage_key })).catch(() => undefined);
    await pool.query("DELETE FROM user_document WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND status='processing'", [tenantId, userId, documentId]);
    throw new UserDocumentError("The uploaded file does not match the selected type and size limit.", 400);
  }

  const copySource = `${encodeURIComponent(store.bucket)}/${row.pending_storage_key.split("/").map(encodeURIComponent).join("/")}`;
  try {
    await store.client.send(new CopyObjectCommand({
      Bucket: store.bucket,
      Key: row.storage_key,
      CopySource: copySource,
      CopySourceIfMatch: head.ETag,
      ContentType: row.content_type,
      MetadataDirective: "REPLACE",
    }));
    const completed = await pool.query(
      `UPDATE user_document SET status='ready', uploaded_at=CURRENT_TIMESTAMP, pending_storage_key=NULL
       WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND status='processing'
         AND upload_expires_at>CURRENT_TIMESTAMP RETURNING id`,
      [tenantId, userId, documentId],
    );
    if (!completed.rows[0]) throw new UserDocumentError("Upload not found or expired.", 404);
  } catch (error) {
    await store.client.send(new DeleteObjectCommand({ Bucket: store.bucket, Key: row.storage_key })).catch(() => undefined);
    await pool.query("UPDATE user_document SET status='pending' WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND status='processing'", [tenantId, userId, documentId]);
    if (error instanceof UserDocumentError) throw error;
    throw new UserDocumentError("The verified file could not be saved to private storage. Please retry.", 503);
  }
  await store.client.send(new DeleteObjectCommand({ Bucket: store.bucket, Key: row.pending_storage_key })).catch(() => undefined);
}

export async function getUserDocumentContent(tenantId: string, userId: string, documentId: string) {
  if (!uuidPattern.test(documentId)) throw new UserDocumentError("Document not found.", 404);
  const result = await pool.query<{
    storage_key: string;
    content_type: string;
    file_name: string;
    file_size: string;
  }>(
    `SELECT storage_key, content_type, file_name, file_size::text
     FROM user_document
     WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND status='ready'`,
    [tenantId, userId, documentId],
  );
  const document = result.rows[0];
  if (!document) throw new UserDocumentError("Document not found.", 404);
  const store = storage();
  try {
    const object = await store.client.send(new GetObjectCommand({ Bucket: store.bucket, Key: document.storage_key }));
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
    throw new UserDocumentError("Document content is unavailable.", 503);
  }
}

export async function deleteUserDocument(tenantId: string, userId: string, documentId: string) {
  if (!uuidPattern.test(documentId)) throw new UserDocumentError("Document not found.", 404);
  const client = await pool.connect();
  let storageKeys: string[] = [];
  try {
    await client.query("BEGIN");
    const found = await client.query<{ storage_key: string; pending_storage_key: string | null }>(
      `SELECT storage_key, pending_storage_key FROM user_document
       WHERE tenant_id=$1 AND user_id=$2 AND id=$3 FOR UPDATE`,
      [tenantId, userId, documentId],
    );
    if (!found.rows[0]) throw new UserDocumentError("Document not found.", 404);
    storageKeys = [found.rows[0].storage_key, found.rows[0].pending_storage_key].filter((key): key is string => Boolean(key));
    const store = storage();
    for (const key of storageKeys) {
      await store.client.send(new DeleteObjectCommand({ Bucket: store.bucket, Key: key }));
    }
    await client.query("DELETE FROM user_document WHERE tenant_id=$1 AND user_id=$2 AND id=$3", [tenantId, userId, documentId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof UserDocumentError) throw error;
    throw new UserDocumentError("The document could not be deleted from private storage.", 503);
  } finally {
    client.release();
  }
}
