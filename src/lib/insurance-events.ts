import "server-only";
import { pool } from "@/lib/db";
import type { PoolClient } from "pg";
import type { InsuranceEventType } from "@/lib/insurance-event-validation";

export type InsuranceEventStatus = "active" | "cancelled";
export type VehicleInsuranceStatus = "to_complete" | "insured" | "suspended" | "unpaid";
export type VehicleInsuranceEvent = {
  id: string;
  vehicle_id: string;
  event_type: InsuranceEventType;
  event_date: string;
  description: string;
  status: InsuranceEventStatus;
  cancellation_reason: string | null;
  created_by_user_id: string;
  created_by_name: string;
  cancelled_by_user_id: string | null;
  cancelled_by_name: string | null;
  cancelled_at: string | null;
  created_at: string;
};

export class InsuranceEventError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function statusForEvent(eventType: InsuranceEventType): VehicleInsuranceStatus {
  return eventType === "suspension" ? "suspended" : eventType;
}

const eventSelect = `SELECT e.id, e.vehicle_id, e.event_type, e.event_date::text, e.description,
  e.status, e.cancellation_reason, e.created_by_user_id, creator.display_name AS created_by_name,
  e.cancelled_by_user_id, canceller.display_name AS cancelled_by_name, e.cancelled_at::text, e.created_at::text
  FROM vehicle_insurance_event e
  JOIN vehicle v ON v.id = e.vehicle_id AND v.tenant_id = e.tenant_id
  JOIN organization_membership creator ON creator.user_id = e.created_by_user_id AND creator.tenant_id=e.tenant_id
  LEFT JOIN organization_membership canceller ON canceller.user_id = e.cancelled_by_user_id AND canceller.tenant_id=e.tenant_id`;

export async function listVehicleInsuranceEvents(tenantId: string, vehicleId: string) {
  const result = await pool.query<VehicleInsuranceEvent>(
    `${eventSelect} WHERE e.tenant_id = $1 AND e.vehicle_id = $2
     ORDER BY e.event_date DESC, e.created_at DESC, e.id DESC`,
    [tenantId, vehicleId],
  );
  return result.rows;
}

export async function createVehicleInsuranceEvent(input: {
  tenantId: string;
  vehicleId: string;
  userId: string;
  eventType: InsuranceEventType;
  eventDate: string;
  description: string;
}) {
  const client = await pool.connect();
  let eventId: string;
  try {
    await client.query("BEGIN");
    const vehicle = await client.query(
      "SELECT id FROM vehicle WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL FOR UPDATE",
      [input.tenantId, input.vehicleId],
    );
    if (!vehicle.rows[0]) throw new InsuranceEventError("Vehicle not found.", 404);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO vehicle_insurance_event (tenant_id, vehicle_id, event_type, event_date, description, created_by_user_id)
       VALUES ($1, $2, $3, $4::date, $5, $6) RETURNING id`,
      [input.tenantId, input.vehicleId, input.eventType, input.eventDate, input.description, input.userId],
    );
    eventId = inserted.rows[0].id;
    const insuranceStatus = await recalculateInsuranceStatus(client, input.tenantId, input.vehicleId);
    await client.query(
      "UPDATE vehicle SET insurance_status = $3, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = $2",
      [input.tenantId, input.vehicleId, insuranceStatus],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const event = await getVehicleInsuranceEvent(input.tenantId, eventId);
  if (!event) throw new InsuranceEventError("Insurance event could not be loaded after saving.", 503);
  return event;
}

export async function getVehicleInsuranceStatus(tenantId: string, vehicleId: string) {
  const result = await pool.query<{ insurance_status: VehicleInsuranceStatus }>(
    "SELECT insurance_status FROM vehicle WHERE tenant_id = $1 AND id = $2",
    [tenantId, vehicleId],
  );
  return result.rows[0]?.insurance_status ?? null;
}

async function recalculateInsuranceStatus(client: PoolClient, tenantId: string, vehicleId: string) {
  const active = await client.query<{ event_type: InsuranceEventType }>(
    `SELECT event_type FROM vehicle_insurance_event
     WHERE tenant_id = $1 AND vehicle_id = $2 AND status = 'active'
     ORDER BY event_date DESC, created_at DESC, id DESC LIMIT 1`,
    [tenantId, vehicleId],
  );
  if (active.rows[0]) return statusForEvent(active.rows[0].event_type);
  const evidence = await client.query<{ inferred_status: VehicleInsuranceStatus }>(
    `SELECT CASE
       WHEN NULLIF(BTRIM(insurance_company), '') IS NOT NULL AND insurance_expiry_date >= CURRENT_DATE THEN 'insured'
       ELSE 'to_complete'
     END AS inferred_status
     FROM vehicle WHERE tenant_id = $1 AND id = $2`,
    [tenantId, vehicleId],
  );
  return evidence.rows[0]?.inferred_status ?? "to_complete";
}

export async function getVehicleInsuranceEvent(tenantId: string, eventId: string) {
  const result = await pool.query<VehicleInsuranceEvent>(`${eventSelect} WHERE e.tenant_id = $1 AND e.id = $2`, [tenantId, eventId]);
  return result.rows[0] ?? null;
}

export async function cancelVehicleInsuranceEvent(input: {
  tenantId: string;
  eventId: string;
  userId: string;
  reason: string;
}) {
  const client = await pool.connect();
  let vehicleId: string;
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ vehicle_id: string }>(
      "SELECT vehicle_id FROM vehicle_insurance_event WHERE tenant_id = $1 AND id = $2",
      [input.tenantId, input.eventId],
    );
    if (!existing.rows[0]) throw new InsuranceEventError("Insurance event not found.", 404);
    vehicleId = existing.rows[0].vehicle_id;
    const vehicle = await client.query(
      "SELECT id FROM vehicle WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
      [input.tenantId, vehicleId],
    );
    if (!vehicle.rows[0]) throw new InsuranceEventError("Insurance event not found.", 404);
    const updated = await client.query(
      `UPDATE vehicle_insurance_event SET status = 'cancelled', cancellation_reason = $3,
         cancelled_by_user_id = $4, cancelled_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND id = $2 AND status = 'active'
       RETURNING id`,
      [input.tenantId, input.eventId, input.reason, input.userId],
    );
    if (!updated.rows[0]) throw new InsuranceEventError("This insurance event has already been cancelled.", 409);
    const insuranceStatus = await recalculateInsuranceStatus(client, input.tenantId, vehicleId);
    await client.query(
      "UPDATE vehicle SET insurance_status = $3, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = $2",
      [input.tenantId, vehicleId, insuranceStatus],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const event = await getVehicleInsuranceEvent(input.tenantId, input.eventId);
  if (!event) throw new InsuranceEventError("Insurance event not found.", 404);
  return event;
}
