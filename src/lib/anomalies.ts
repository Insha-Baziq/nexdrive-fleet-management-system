import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db";
import { getPrivateDocumentStorage, MAX_VEHICLE_DOCUMENT_BYTES } from "@/lib/vehicle-documents";

const PHOTO_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
} as const;
export type AnomalyPhotoExtension = keyof typeof PHOTO_TYPES;
export type AnomalyStatus = "open" | "resolved" | "cancelled";
export type AnomalyPhoto = {
  id: string;
  file_name: string;
  file_extension: AnomalyPhotoExtension;
  file_size: string;
  created_at: string;
};
export type VehicleAnomaly = {
  id: string;
  vehicle_id: string;
  vehicle_registration: string;
  vehicle_make: string;
  vehicle_model: string;
  observed_date: string;
  description: string;
  status: AnomalyStatus;
  reporter_name: string;
  resolution_reason: string | null;
  closed_by_name: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  photo_count: number;
  photos?: AnomalyPhoto[];
};

export class AnomalyError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function getAnomalyPhotoExtension(fileName: string): AnomalyPhotoExtension | null {
  const extension = fileName.trim().split(".").at(-1)?.toLowerCase();
  return extension && extension in PHOTO_TYPES ? extension as AnomalyPhotoExtension : null;
}

export function getAnomalyPhotoContentType(extension: AnomalyPhotoExtension) {
  return PHOTO_TYPES[extension];
}

export function validateAnomalyPhotoContent(buffer: Buffer, extension: AnomalyPhotoExtension) {
  if (buffer.length < 8 || buffer.length > MAX_VEHICLE_DOCUMENT_BYTES) return false;
  if (extension === "png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

const anomalyFields = `a.id, a.vehicle_id, v.registration AS vehicle_registration,
  v.make AS vehicle_make, v.model AS vehicle_model, a.observed_date::text,
  a.description, a.status, reporter.display_name AS reporter_name, a.resolution_reason,
  closer.display_name AS closed_by_name, a.closed_at::text, a.created_at::text, a.updated_at::text,
  (SELECT count(*)::int FROM anomaly_photo p WHERE p.tenant_id = a.tenant_id AND p.anomaly_id = a.id) AS photo_count`;
const anomalyJoins = `FROM vehicle_anomaly a
  JOIN vehicle v ON v.id = a.vehicle_id AND v.tenant_id = a.tenant_id
  JOIN organization_membership reporter ON reporter.user_id = a.reported_by_user_id AND reporter.tenant_id=a.tenant_id
  LEFT JOIN organization_membership closer ON closer.user_id = a.closed_by_user_id AND closer.tenant_id=a.tenant_id`;

export async function listAnomalies(tenantId: string) {
  const result = await pool.query<VehicleAnomaly>(
    `SELECT ${anomalyFields} ${anomalyJoins}
     WHERE a.tenant_id = $1 ORDER BY a.observed_date DESC, a.created_at DESC`,
    [tenantId],
  );
  return result.rows;
}

export async function listVehicleAnomalies(tenantId: string, vehicleId: string) {
  const result = await pool.query<VehicleAnomaly>(
    `SELECT ${anomalyFields} ${anomalyJoins}
     WHERE a.tenant_id = $1 AND a.vehicle_id = $2
     ORDER BY a.observed_date DESC, a.created_at DESC`,
    [tenantId, vehicleId],
  );
  return result.rows;
}

async function listAnomalyPhotos(tenantId: string, anomalyId: string): Promise<AnomalyPhoto[]> {
  const result = await pool.query<AnomalyPhoto>(
    `SELECT id, file_name, file_extension, file_size::text, created_at::text
     FROM anomaly_photo WHERE tenant_id = $1 AND anomaly_id = $2 ORDER BY created_at, id`,
    [tenantId, anomalyId],
  );
  return result.rows;
}

export async function getAnomaly(tenantId: string, anomalyId: string): Promise<VehicleAnomaly | null> {
  const result = await pool.query<VehicleAnomaly>(
    `SELECT ${anomalyFields} ${anomalyJoins} WHERE a.tenant_id = $1 AND a.id = $2`,
    [tenantId, anomalyId],
  );
  const anomaly = result.rows[0];
  return anomaly ? { ...anomaly, photos: await listAnomalyPhotos(tenantId, anomalyId) } : null;
}

export async function createAnomaly(input: {
  tenantId: string;
  vehicleId: string;
  userId: string;
  observedDate: string;
  description: string;
  photos: Array<{ fileName: string; extension: AnomalyPhotoExtension; bytes: Buffer }>;
}) {
  const vehicle = await pool.query("SELECT id FROM vehicle WHERE tenant_id = $1 AND id = $2", [input.tenantId, input.vehicleId]);
  if (!vehicle.rows[0]) throw new AnomalyError("Vehicle not found.", 404);
  const totalBytes = input.photos.reduce((sum, photo) => sum + photo.bytes.length, 0);
  if (input.photos.length > 5 || totalBytes > MAX_VEHICLE_DOCUMENT_BYTES) {
    throw new AnomalyError("Choose up to 5 photos with a combined size up to 15 MB.", 400);
  }
  const storage = input.photos.length ? getPrivateDocumentStorage() : null;
  if (input.photos.length && !storage) throw new AnomalyError("Private photo storage is not configured.", 503);

  const anomalyId = randomUUID();
  const storedKeys: string[] = [];
  try {
    await pool.query(
      `INSERT INTO vehicle_anomaly (id, tenant_id, vehicle_id, observed_date, description, reported_by_user_id)
       VALUES ($1, $2, $3, $4::date, $5, $6)`,
      [anomalyId, input.tenantId, input.vehicleId, input.observedDate, input.description, input.userId],
    );
    for (const photo of input.photos) {
      const photoId = randomUUID();
      const storageKey = `anomaly-photos/${randomUUID()}/${photoId}.${photo.extension}`;
      const contentType = getAnomalyPhotoContentType(photo.extension);
      await storage!.client.send(new PutObjectCommand({
        Bucket: storage!.bucket,
        Key: storageKey,
        Body: photo.bytes,
        ContentLength: photo.bytes.length,
        ContentType: contentType,
        CacheControl: "private, no-store, max-age=0",
      }));
      storedKeys.push(storageKey);
      await pool.query(
        `INSERT INTO anomaly_photo (id, tenant_id, anomaly_id, storage_key, file_name, file_extension, content_type, file_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [photoId, input.tenantId, anomalyId, storageKey, photo.fileName, photo.extension, contentType, photo.bytes.length],
      );
    }
  } catch {
    if (storage) await Promise.all(storedKeys.map((Key) => storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key })).catch(() => undefined)));
    await pool.query("DELETE FROM vehicle_anomaly WHERE tenant_id = $1 AND id = $2", [input.tenantId, anomalyId]).catch(() => undefined);
    throw new AnomalyError("Could not save the anomaly and its private photos.", 503);
  }
  const anomaly = await getAnomaly(input.tenantId, anomalyId);
  if (!anomaly) throw new AnomalyError("Anomaly could not be loaded after saving.", 503);
  return anomaly;
}

export async function closeAnomaly(input: {
  tenantId: string;
  anomalyId: string;
  userId: string;
  status: Exclude<AnomalyStatus, "open">;
  reason: string;
}) {
  const updated = await pool.query(
    `UPDATE vehicle_anomaly SET status = $3, resolution_reason = $4,
       closed_by_user_id = $5, closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = $1 AND id = $2 AND status = 'open' RETURNING id`,
    [input.tenantId, input.anomalyId, input.status, input.reason, input.userId],
  );
  if (!updated.rows[0]) {
    const exists = await pool.query("SELECT 1 FROM vehicle_anomaly WHERE tenant_id = $1 AND id = $2", [input.tenantId, input.anomalyId]);
    if (!exists.rows[0]) throw new AnomalyError("Anomaly not found.", 404);
    throw new AnomalyError("This anomaly has already been closed.", 409);
  }
  const anomaly = await getAnomaly(input.tenantId, input.anomalyId);
  if (!anomaly) throw new AnomalyError("Anomaly not found.", 404);
  return anomaly;
}

export async function getAnomalyPhotoContent(tenantId: string, anomalyId: string, photoId: string) {
  const result = await pool.query<{
    storage_key: string; file_name: string; content_type: string; file_size: string;
  }>(
    `SELECT p.storage_key, p.file_name, p.content_type, p.file_size::text
     FROM anomaly_photo p JOIN vehicle_anomaly a ON a.id = p.anomaly_id AND a.tenant_id = p.tenant_id
     JOIN vehicle v ON v.id = a.vehicle_id AND v.tenant_id = a.tenant_id
     WHERE p.tenant_id = $1 AND p.anomaly_id = $2 AND p.id = $3`,
    [tenantId, anomalyId, photoId],
  );
  const photo = result.rows[0];
  if (!photo) throw new AnomalyError("Anomaly photo not found.", 404);
  const storage = getPrivateDocumentStorage();
  if (!storage) throw new AnomalyError("Private photo storage is not configured.", 503);
  try {
    const object = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: photo.storage_key }));
    if (!object.Body) throw new Error("Missing object body");
    return new Response(object.Body.transformToWebStream(), {
      status: 200,
      headers: {
        "Content-Type": photo.content_type,
        "Content-Length": photo.file_size,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(photo.file_name).replaceAll("'", "%27")}`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none';",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    if (error instanceof AnomalyError) throw error;
    throw new AnomalyError("Anomaly photo content is unavailable.", 503);
  }
}
