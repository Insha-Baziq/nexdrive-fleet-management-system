import "server-only";
import { pool } from "@/lib/db";

export type VehicleInspection = {
  id: string;
  vehicle_id: string;
  technical_due_date: string;
  emissions_due_date: string | null;
  source: "legacy" | "staff";
  recorded_by_user_id: string | null;
  recorded_by_name: string | null;
  recorded_at: string;
};

export type VehicleInspectionInput = {
  technicalDueDate: string;
  emissionsDueDate: string | null;
};

export class VehicleInspectionError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const inspectionSelect = `SELECT i.id, i.vehicle_id, i.technical_due_date::text,
  i.emissions_due_date::text, i.source, i.recorded_by_user_id,
  recorder.display_name AS recorded_by_name, i.recorded_at::text
  FROM vehicle_inspection i
  JOIN vehicle v ON v.id = i.vehicle_id AND v.tenant_id = i.tenant_id
  LEFT JOIN organization_membership recorder ON recorder.user_id = i.recorded_by_user_id
    AND recorder.tenant_id=i.tenant_id`;

export async function listVehicleInspections(tenantId: string, vehicleId: string) {
  const result = await pool.query<VehicleInspection>(
    `${inspectionSelect} WHERE i.tenant_id = $1 AND i.vehicle_id = $2
     ORDER BY i.recorded_at DESC, i.id DESC`,
    [tenantId, vehicleId],
  );
  return result.rows;
}

export async function createVehicleInspection(input: {
  tenantId: string;
  vehicleId: string;
  userId: string;
  inspection: VehicleInspectionInput;
}) {
  const client = await pool.connect();
  let inspectionId: string;
  try {
    await client.query("BEGIN");
    const vehicle = await client.query(
      "SELECT id FROM vehicle WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL FOR UPDATE",
      [input.tenantId, input.vehicleId],
    );
    if (!vehicle.rows[0]) throw new VehicleInspectionError("Vehicle not found or archived.", 404);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO vehicle_inspection
       (tenant_id, vehicle_id, technical_due_date, emissions_due_date, source, recorded_by_user_id)
       VALUES ($1, $2, $3::date, $4::date, 'staff', $5) RETURNING id`,
      [input.tenantId, input.vehicleId, input.inspection.technicalDueDate, input.inspection.emissionsDueDate, input.userId],
    );
    inspectionId = inserted.rows[0].id;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const result = await pool.query<VehicleInspection>(
    `${inspectionSelect} WHERE i.tenant_id = $1 AND i.vehicle_id = $2 AND i.id = $3`,
    [input.tenantId, input.vehicleId, inspectionId],
  );
  if (!result.rows[0]) throw new VehicleInspectionError("Inspection could not be loaded after saving.", 503);
  return result.rows[0];
}
