import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db";
import { getPrivateDocumentStorage } from "@/lib/vehicle-documents";
import type { ParsedMaintenanceForm } from "@/lib/maintenance-validation";

const readerRoles = ["administrator", "fleet_manager", "manager"];
const writerRoles = ["administrator", "fleet_manager"];

export class MaintenanceError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export type MaintenanceInvoice = {
  id: string;
  file_name: string;
  file_extension: "pdf" | "png" | "jpg" | "jpeg" | "docx";
  file_size: string;
  created_at: string;
};

export type MaintenanceIntervention = {
  id: string;
  vehicle_id: string;
  intervention_date: string;
  location_type: "internal" | "external";
  garage_name: string | null;
  work_performed: string;
  parts_used: string | null;
  status: "active" | "cancelled";
  cancellation_reason: string | null;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  created_at: string;
  created_by_name: string;
  invoice: MaintenanceInvoice | null;
};

function assertReader(role: string) {
  if (!readerRoles.includes(role)) throw new MaintenanceError("Forbidden.", 403);
}

function assertWriter(role: string) {
  if (!writerRoles.includes(role)) throw new MaintenanceError("Forbidden.", 403);
}

async function assertVehicleInTenant(tenantId: string, vehicleId: string) {
  const result = await pool.query("SELECT 1 FROM vehicle WHERE tenant_id = $1 AND id = $2", [tenantId, vehicleId]);
  if (!result.rows[0]) throw new MaintenanceError("Vehicle not found.", 404);
}

export async function listVehicleMaintenance(tenantId: string, vehicleId: string, role: string) {
  assertReader(role);
  await assertVehicleInTenant(tenantId, vehicleId);
  const result = await pool.query<MaintenanceIntervention>(
    `SELECT m.id, m.vehicle_id, m.intervention_date::text, m.location_type, m.garage_name,
       m.work_performed, m.parts_used, m.status, m.cancellation_reason, m.cancelled_at::text,
       canceller.display_name AS cancelled_by_name, m.created_at::text, creator.display_name AS created_by_name,
       CASE WHEN i.id IS NULL THEN NULL ELSE json_build_object(
         'id', i.id, 'file_name', i.file_name, 'file_extension', i.file_extension,
         'file_size', i.file_size::text, 'created_at', i.created_at::text
       ) END AS invoice
     FROM vehicle_maintenance m
     JOIN vehicle v ON v.id = m.vehicle_id AND v.tenant_id = m.tenant_id
     JOIN organization_membership creator ON creator.user_id = m.created_by_user_id AND creator.tenant_id=m.tenant_id
     LEFT JOIN organization_membership canceller ON canceller.user_id = m.cancelled_by_user_id AND canceller.tenant_id=m.tenant_id
     LEFT JOIN maintenance_invoice i ON i.maintenance_id = m.id AND i.tenant_id = m.tenant_id
     WHERE m.tenant_id = $1 AND m.vehicle_id = $2
     ORDER BY m.intervention_date DESC, m.created_at DESC, m.id DESC`,
    [tenantId, vehicleId],
  );
  return result.rows;
}

export async function createVehicleMaintenance(input: {
  tenantId: string;
  vehicleId: string;
  userId: string;
  role: string;
  form: ParsedMaintenanceForm;
}) {
  assertWriter(input.role);
  await assertVehicleInTenant(input.tenantId, input.vehicleId);
  const id = randomUUID();
  const storedInvoiceId = input.form.invoice ? randomUUID() : null;
  const storageKey = input.form.invoice ? `maintenance-invoices/${randomUUID()}` : null;
  const storage = input.form.invoice ? getPrivateDocumentStorage() : null;
  if (input.form.invoice && !storage) throw new MaintenanceError("Private invoice storage is not configured.", 503);
  const client = await pool.connect();
  try {
    if (input.form.invoice && storage && storageKey) {
      await storage.client.send(new PutObjectCommand({
        Bucket: storage.bucket,
        Key: storageKey,
        Body: input.form.invoice.bytes,
        ContentLength: input.form.invoice.bytes.length,
        ContentType: input.form.invoice.contentType,
        CacheControl: "private, no-store, max-age=0",
      }));
    }
    await client.query("BEGIN");
    const vehicle = await client.query("SELECT id FROM vehicle WHERE tenant_id = $1 AND id = $2 FOR KEY SHARE", [input.tenantId, input.vehicleId]);
    if (!vehicle.rows[0]) throw new MaintenanceError("Vehicle not found.", 404);
    await client.query(
      `INSERT INTO vehicle_maintenance
       (id, tenant_id, vehicle_id, intervention_date, location_type, garage_name, work_performed,
        parts_used, created_by_user_id)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9)`,
      [id, input.tenantId, input.vehicleId, input.form.interventionDate, input.form.locationType,
        input.form.garageName, input.form.workPerformed, input.form.partsUsed, input.userId],
    );
    if (input.form.invoice && storedInvoiceId && storageKey) {
      await client.query(
        `INSERT INTO maintenance_invoice
         (id, tenant_id, maintenance_id, storage_key, file_name, file_extension, content_type, file_size, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [storedInvoiceId, input.tenantId, id, storageKey, input.form.invoice.fileName, input.form.invoice.extension,
          input.form.invoice.contentType, input.form.invoice.bytes.length, input.userId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (input.form.invoice && storage && storageKey) await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: storageKey })).catch(() => undefined);
    if (error instanceof MaintenanceError) throw error;
    throw new MaintenanceError("Could not save the intervention and its private invoice.", 503);
  } finally {
    client.release();
  }
  const records = await listVehicleMaintenance(input.tenantId, input.vehicleId, input.role);
  const saved = records.find((record) => record.id === id);
  if (!saved) throw new MaintenanceError("Intervention could not be loaded after saving.", 503);
  return saved;
}

export async function cancelVehicleMaintenance(input: {
  tenantId: string;
  vehicleId: string;
  interventionId: string;
  userId: string;
  role: string;
  reason: string;
}) {
  assertWriter(input.role);
  const updated = await pool.query(
    `UPDATE vehicle_maintenance m SET status = 'cancelled', cancellation_reason = $4,
       cancelled_by_user_id = $5, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     FROM vehicle v
     WHERE m.tenant_id = $1 AND m.vehicle_id = $2 AND m.id = $3 AND m.status = 'active'
       AND v.tenant_id = m.tenant_id AND v.id = m.vehicle_id
     RETURNING m.id`,
    [input.tenantId, input.vehicleId, input.interventionId, input.reason, input.userId],
  );
  if (!updated.rows[0]) {
    const existing = await pool.query(
      `SELECT m.status FROM vehicle_maintenance m JOIN vehicle v
       ON v.id = m.vehicle_id AND v.tenant_id = m.tenant_id
       WHERE m.tenant_id = $1 AND m.vehicle_id = $2 AND m.id = $3`,
      [input.tenantId, input.vehicleId, input.interventionId],
    );
    if (!existing.rows[0]) throw new MaintenanceError("Intervention not found.", 404);
    throw new MaintenanceError("This intervention has already been cancelled.", 409);
  }
  const records = await listVehicleMaintenance(input.tenantId, input.vehicleId, input.role);
  const saved = records.find((record) => record.id === input.interventionId);
  if (!saved) throw new MaintenanceError("Intervention not found.", 404);
  return saved;
}

export async function getMaintenanceInvoiceContent(
  tenantId: string,
  vehicleId: string,
  interventionId: string,
  role: string,
  download: boolean,
) {
  assertReader(role);
  const result = await pool.query<{
    storage_key: string;
    content_type: string;
    file_name: string;
    file_size: string;
  }>(
    `SELECT i.storage_key, i.content_type, i.file_name, i.file_size::text
     FROM maintenance_invoice i
     JOIN vehicle_maintenance m ON m.id = i.maintenance_id AND m.tenant_id = i.tenant_id
     JOIN vehicle v ON v.id = m.vehicle_id AND v.tenant_id = m.tenant_id
     WHERE i.tenant_id = $1 AND m.vehicle_id = $2 AND m.id = $3`,
    [tenantId, vehicleId, interventionId],
  );
  const invoice = result.rows[0];
  if (!invoice) throw new MaintenanceError("Invoice not found.", 404);
  const storage = getPrivateDocumentStorage();
  if (!storage) throw new MaintenanceError("Private invoice storage is not configured.", 503);
  try {
    const object = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: invoice.storage_key }));
    if (!object.Body) throw new Error("Missing object body");
    const safeFileName = encodeURIComponent(invoice.file_name).replaceAll("'", "%27");
    const attachment = download || invoice.content_type.includes("wordprocessingml");
    return new Response(object.Body.transformToWebStream(), {
      status: 200,
      headers: {
        "Content-Type": invoice.content_type,
        "Content-Length": invoice.file_size,
        "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename*=UTF-8''${safeFileName}`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none';",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    if (error instanceof MaintenanceError) throw error;
    throw new MaintenanceError("Invoice content is unavailable.", 503);
  }
}


