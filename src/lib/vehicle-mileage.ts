import "server-only";
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db";
import type { MileageReadingInput } from "@/lib/vehicle-mileage-validation";

export type VehicleMileageReading = {
  id: string;
  vehicle_id: string;
  reading_date: string;
  mileage: number;
  note: string | null;
  status: "valid" | "cancelled";
  cancellation_reason: string | null;
  recorded_by_name: string | null;
  cancelled_by_name: string | null;
  cancelled_at: string | null;
  created_at: string;
  lower_reading_acknowledged: boolean;
  compared_with_reading_id: string | null;
};

export class VehicleMileageError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export class LowerMileageWarning extends VehicleMileageError {
  constructor(public latest: { id: string; mileage: number; reading_date: string }) {
    super("Ce kilométrage est inférieur au dernier relevé du véhicule.", 409);
  }
}

const readingColumns = `r.id::text, r.vehicle_id::text, r.reading_date::text,
  r.mileage, r.note, r.status, r.cancellation_reason,
  recorder.display_name AS recorded_by_name, canceller.display_name AS cancelled_by_name,
  r.cancelled_at::text, r.created_at::text,
  r.lower_reading_acknowledged, r.compared_with_reading_id::text`;
const readingJoins = `FROM vehicle_mileage_reading r
  JOIN vehicle v ON v.id = r.vehicle_id AND v.tenant_id = r.tenant_id
  LEFT JOIN organization_membership recorder ON recorder.user_id = r.recorded_by_user_id AND recorder.tenant_id=r.tenant_id
  LEFT JOIN organization_membership canceller ON canceller.user_id = r.cancelled_by_user_id AND canceller.tenant_id=r.tenant_id`;

export async function listVehicleMileageReadings(tenantId: string, vehicleId: string) {
  const result = await pool.query<VehicleMileageReading>(
    `SELECT ${readingColumns} ${readingJoins}
     WHERE r.tenant_id = $1 AND r.vehicle_id = $2
     ORDER BY r.reading_date DESC, r.created_at DESC, r.id DESC`,
    [tenantId, vehicleId],
  );
  return result.rows;
}

export async function createVehicleMileageReading(input: {
  tenantId: string;
  vehicleId: string;
  userId: string;
  reading: MileageReadingInput;
}) {
  const readingId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const vehicle = await client.query(
      `SELECT id FROM vehicle WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [input.tenantId, input.vehicleId],
    );
    if (!vehicle.rows[0]) throw new VehicleMileageError("Vehicle not found.", 404);
    await client.query(
      `INSERT INTO vehicle_mileage_reading
       (id, tenant_id, vehicle_id, recorded_by_user_id, reading_date, mileage, note)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7)`,
      [readingId, input.tenantId, input.vehicleId, input.userId,
        input.reading.readingDate, input.reading.mileage, input.reading.note],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return (await getVehicleMileageReading(input.tenantId, input.vehicleId, readingId))!;
}

export async function createDriverVehicleMileageReading(input: {
  tenantId: string;
  userId: string;
  reading: MileageReadingInput;
}) {
  const client = await pool.connect();
  let vehicleId: string;
  const readingId = randomUUID();
  try {
    await client.query("BEGIN");
    const assigned = await client.query<{ vehicle_id: string }>(
      `SELECT v.id::text AS vehicle_id FROM driver d
       JOIN "user" u ON u.id = d.user_id
         AND EXISTS (SELECT 1 FROM organization_membership membership WHERE membership.user_id=u.id AND membership.tenant_id=d.tenant_id AND membership.role='driver' AND membership.disabled_at IS NULL)
       JOIN assignment a ON a.tenant_id = d.tenant_id
         AND a.driver_id = d.id AND a.ended_at IS NULL
       JOIN vehicle v ON v.tenant_id = a.tenant_id AND v.id = a.vehicle_id
       WHERE d.tenant_id = $1 AND d.user_id = $2
       FOR UPDATE OF v`,
      [input.tenantId, input.userId],
    );
    if (!assigned.rows[0]) {
      throw new VehicleMileageError("Une affectation active est nécessaire pour déclarer le kilométrage.", 409);
    }
    vehicleId = assigned.rows[0].vehicle_id;
    const latest = await client.query<{ id: string; mileage: number; reading_date: string }>(
      `SELECT id::text, mileage, reading_date::text
       FROM vehicle_mileage_reading
       WHERE tenant_id = $1 AND vehicle_id = $2 AND status = 'valid'
       ORDER BY reading_date DESC, created_at DESC, id DESC LIMIT 1`,
      [input.tenantId, vehicleId],
    );
    const previous = latest.rows[0];
    const isLower = previous && input.reading.mileage < previous.mileage;
    if (isLower && input.reading.acknowledgeLowerThanReadingId !== previous.id) {
      throw new LowerMileageWarning(previous);
    }
    if (!isLower && input.reading.acknowledgeLowerThanReadingId) {
      throw new VehicleMileageError("Le dernier relevé a changé. Vérifiez le kilométrage avant de confirmer.", 409);
    }
    await client.query(
      `INSERT INTO vehicle_mileage_reading
       (id, tenant_id, vehicle_id, recorded_by_user_id, reading_date, mileage, note,
        lower_reading_acknowledged, compared_with_reading_id)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9)`,
      [readingId, input.tenantId, vehicleId, input.userId, input.reading.readingDate,
        input.reading.mileage, input.reading.note, Boolean(isLower), isLower ? previous.id : null],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return (await getVehicleMileageReading(input.tenantId, vehicleId!, readingId))!;
}

export async function getVehicleMileageReading(tenantId: string, vehicleId: string, readingId: string) {
  const result = await pool.query<VehicleMileageReading>(
    `SELECT ${readingColumns} ${readingJoins}
     WHERE r.tenant_id = $1 AND r.vehicle_id = $2 AND r.id = $3`,
    [tenantId, vehicleId, readingId],
  );
  return result.rows[0] ?? null;
}

export async function cancelVehicleMileageReading(input: {
  tenantId: string;
  vehicleId: string;
  readingId: string;
  userId: string;
  reason: string;
}) {
  const update = await pool.query(
    `UPDATE vehicle_mileage_reading
     SET status = 'cancelled', cancellation_reason = $5,
         cancelled_by_user_id = $4, cancelled_at = CURRENT_TIMESTAMP
     WHERE tenant_id = $1 AND vehicle_id = $2 AND id = $3 AND status = 'valid'
     RETURNING id`,
    [input.tenantId, input.vehicleId, input.readingId, input.userId, input.reason],
  );
  if (!update.rows[0]) {
    const existing = await getVehicleMileageReading(input.tenantId, input.vehicleId, input.readingId);
    if (!existing) throw new VehicleMileageError("Mileage reading not found.", 404);
    throw new VehicleMileageError("This reading has already been cancelled.", 409);
  }
  return (await getVehicleMileageReading(input.tenantId, input.vehicleId, input.readingId))!;
}
