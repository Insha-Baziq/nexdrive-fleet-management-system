import "server-only";
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db";
import type { AssignmentCorrectionInput } from "@/lib/assignment-validation";
import type { AssignmentEndInput } from "@/lib/assignment-validation";

export type AssignmentInput = {
  vehicleId: string;
  driverId: string;
  startedAt: string;
  startReason: string | null;
  closureReason: string | null;
};

export type AssignmentHistory = {
  id: string;
  vehicle_id: string;
  vehicle_registration: string;
  driver_id: string;
  driver_name: string;
  started_at: string;
  ended_at: string | null;
  start_reason: string | null;
  end_reason: string | null;
  created_by_name: string;
};

export type AssignmentCorrection = {
  id: string;
  assignment_id: string;
  old_started_at: string;
  old_ended_at: string | null;
  new_started_at: string;
  new_ended_at: string | null;
  reason: string;
  corrected_at: string;
  corrected_by_name: string;
};

export type AssignmentJournalEntry = AssignmentHistory & { corrections: AssignmentCorrection[] };

export type AssignmentLookup = {
  vehicle: { id: string; registration: string; make: string; model: string };
  recordedAssignment: { id: string; driver_id: string; driver_name: string; started_at: string; ended_at: string | null } | null;
  currentAssignment: { id: string; driver_id: string; driver_name: string; started_at: string } | null;
};

export class AssignmentError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function attachCorrections<T extends { id: string }>(tenantId: string, assignments: T[]) {
  const byId = new Map(assignments.map((assignment) => [assignment.id, [] as AssignmentCorrection[]]));
  if (!assignments.length) return assignments.map((assignment) => ({ ...assignment, corrections: [] }));
  const result = await pool.query<AssignmentCorrection>(
    `SELECT c.id, c.assignment_id, c.old_started_at::text, c.old_ended_at::text,
      c.new_started_at::text, c.new_ended_at::text, c.reason, c.corrected_at::text,
      u.display_name AS corrected_by_name
     FROM assignment_correction c
     JOIN organization_membership u ON u.user_id = c.corrected_by_user_id AND u.tenant_id=c.tenant_id
     WHERE c.tenant_id = $1 AND c.assignment_id = ANY($2::uuid[])
     ORDER BY c.corrected_at DESC, c.id DESC`,
    [tenantId, assignments.map((assignment) => assignment.id)],
  );
  for (const correction of result.rows) byId.get(correction.assignment_id)?.push(correction);
  return assignments.map((assignment) => ({ ...assignment, corrections: byId.get(assignment.id) ?? [] }));
}

export async function listVehicleAssignmentHistory(tenantId: string, vehicleId: string) {
  const result = await pool.query<AssignmentHistory>(
    `SELECT a.id, a.vehicle_id, v.registration AS vehicle_registration,
      a.driver_id, d.full_name AS driver_name,
      a.started_at::text, a.ended_at::text, a.start_reason, a.end_reason,
      u.display_name AS created_by_name
     FROM assignment a
     JOIN vehicle v ON v.id = a.vehicle_id AND v.tenant_id = a.tenant_id
     JOIN driver d ON d.id = a.driver_id AND d.tenant_id = a.tenant_id
     JOIN organization_membership u ON u.user_id = a.created_by_user_id AND u.tenant_id=a.tenant_id
     WHERE a.tenant_id = $1 AND a.vehicle_id = $2
     ORDER BY a.started_at DESC, a.created_at DESC`,
    [tenantId, vehicleId],
  );
  return result.rows;
}

export async function listAssignmentJournal(tenantId: string) {
  const result = await pool.query<AssignmentJournalEntry>(
    `SELECT a.id, a.vehicle_id, v.registration AS vehicle_registration,
      a.driver_id, d.full_name AS driver_name,
      a.started_at::text, a.ended_at::text, a.start_reason, a.end_reason,
      u.display_name AS created_by_name
     FROM assignment a
     JOIN vehicle v ON v.id = a.vehicle_id AND v.tenant_id = a.tenant_id
     JOIN driver d ON d.id = a.driver_id AND d.tenant_id = a.tenant_id
     JOIN organization_membership u ON u.user_id = a.created_by_user_id AND u.tenant_id=a.tenant_id
     WHERE a.tenant_id = $1
     ORDER BY a.started_at DESC, a.created_at DESC`,
    [tenantId],
  );
  return attachCorrections(tenantId, result.rows);
}

export async function getAssignmentJournalEntry(tenantId: string, assignmentId: string) {
  const result = await pool.query<AssignmentJournalEntry>(
    `SELECT a.id, a.vehicle_id, v.registration AS vehicle_registration,
      a.driver_id, d.full_name AS driver_name,
      a.started_at::text, a.ended_at::text, a.start_reason, a.end_reason,
      u.display_name AS created_by_name
     FROM assignment a
     JOIN vehicle v ON v.id = a.vehicle_id AND v.tenant_id = a.tenant_id
     JOIN driver d ON d.id = a.driver_id AND d.tenant_id = a.tenant_id
     JOIN organization_membership u ON u.user_id = a.created_by_user_id AND u.tenant_id=a.tenant_id
     WHERE a.tenant_id = $1 AND a.id = $2`,
    [tenantId, assignmentId],
  );
  const assignment = result.rows[0];
  if (!assignment) return null;
  return (await attachCorrections(tenantId, [assignment]))[0];
}

export async function correctAssignment(
  tenantId: string,
  actorId: string,
  assignmentId: string,
  input: AssignmentCorrectionInput,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [tenantId]);
    const assignmentResult = await client.query<{
      id: string; vehicle_id: string; driver_id: string; started_at: string; ended_at: string | null;
    }>(
      `SELECT id, vehicle_id, driver_id, started_at::text, ended_at::text
       FROM assignment WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, assignmentId],
    );
    const assignment = assignmentResult.rows[0];
    if (!assignment) throw new AssignmentError("Assignment not found.", 404);
    if ((assignment.ended_at === null) !== (input.endedAt === null)) {
      throw new AssignmentError("A correction cannot change whether the assignment is active.", 400);
    }
    if (Date.parse(input.startedAt) > Date.now() + 60_000 || (input.endedAt && Date.parse(input.endedAt) > Date.now() + 60_000)) {
      throw new AssignmentError("Assignment dates cannot be in the future.", 400);
    }
    if (input.endedAt && Date.parse(input.endedAt) <= Date.parse(input.startedAt)) {
      throw new AssignmentError("The end must be later than the start.", 400);
    }
    const overlap = await client.query(
      `SELECT 1 FROM assignment other
       WHERE other.tenant_id = $1 AND other.id <> $2
         AND (other.vehicle_id = $3 OR other.driver_id = $4)
         AND $5::timestamptz < COALESCE(other.ended_at, 'infinity'::timestamptz)
         AND other.started_at < COALESCE($6::timestamptz, 'infinity'::timestamptz)
       LIMIT 1 FOR UPDATE`,
      [tenantId, assignmentId, assignment.vehicle_id, assignment.driver_id, input.startedAt, input.endedAt],
    );
    if (overlap.rows[0]) throw new AssignmentError("This correction would overlap another assignment for the vehicle or driver.", 409);

    const correctionId = randomUUID();
    await client.query(
      `INSERT INTO assignment_correction
       (id, tenant_id, assignment_id, corrected_by_user_id, old_started_at, old_ended_at,
        new_started_at, new_ended_at, reason)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9)`,
      [correctionId, tenantId, assignmentId, actorId, assignment.started_at, assignment.ended_at,
       input.startedAt, input.endedAt, input.reason],
    );
    await client.query(
      `UPDATE assignment SET started_at = $3::timestamptz, ended_at = $4::timestamptz
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, assignmentId, input.startedAt, input.endedAt],
    );
    await client.query("COMMIT");
    return { id: assignmentId, correctionId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function endAssignment(tenantId: string, actorId: string, assignmentId: string, input: AssignmentEndInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [tenantId]);
    const result = await client.query<{ id: string; started_at: string; ended_at: string | null }>(
      `SELECT id, started_at::text, ended_at::text FROM assignment
       WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, assignmentId],
    );
    const assignment = result.rows[0];
    if (!assignment) throw new AssignmentError("Assignment not found.", 404);
    if (assignment.ended_at !== null) throw new AssignmentError("This assignment has already ended.", 409);
    if (Date.parse(input.endedAt) > Date.now() + 60_000) throw new AssignmentError("The assignment end cannot be in the future.", 400);
    if (Date.parse(input.endedAt) <= Date.parse(assignment.started_at)) throw new AssignmentError("The end must be later than the start.", 400);
    await client.query(
      `UPDATE assignment SET ended_at = $3::timestamptz, end_reason = $4, ended_by_user_id = $5
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, assignmentId, input.endedAt, input.reason, actorId],
    );
    await client.query("COMMIT");
    return { id: assignmentId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function lookupVehicleAssignment(tenantId: string, vehicleId: string, at: string): Promise<AssignmentLookup | null> {
  const result = await pool.query<{
    vehicle_id: string; registration: string; make: string; model: string;
    recorded_id: string | null; recorded_driver_id: string | null; recorded_driver_name: string | null;
    recorded_started_at: string | null; recorded_ended_at: string | null;
    current_id: string | null; current_driver_id: string | null; current_driver_name: string | null;
    current_started_at: string | null;
  }>(
    `SELECT v.id AS vehicle_id, v.registration, v.make, v.model,
      recorded.id AS recorded_id, recorded.driver_id AS recorded_driver_id,
      recorded.driver_name AS recorded_driver_name,
      recorded.started_at AS recorded_started_at, recorded.ended_at AS recorded_ended_at,
      current.id AS current_id, current.driver_id AS current_driver_id,
      current.driver_name AS current_driver_name, current.started_at AS current_started_at
     FROM vehicle v
     LEFT JOIN LATERAL (
       SELECT a.id, a.driver_id, d.full_name AS driver_name,
         a.started_at::text AS started_at, a.ended_at::text AS ended_at
       FROM assignment a
       JOIN driver d ON d.id = a.driver_id AND d.tenant_id = a.tenant_id
       WHERE a.tenant_id = v.tenant_id AND a.vehicle_id = v.id
         AND a.started_at <= $3::timestamptz
         AND (a.ended_at IS NULL OR $3::timestamptz < a.ended_at)
       ORDER BY a.started_at DESC LIMIT 1
     ) recorded ON true
     LEFT JOIN LATERAL (
       SELECT a.id, a.driver_id, d.full_name AS driver_name,
         a.started_at::text AS started_at
       FROM assignment a
       JOIN driver d ON d.id = a.driver_id AND d.tenant_id = a.tenant_id
       WHERE a.tenant_id = v.tenant_id AND a.vehicle_id = v.id AND a.ended_at IS NULL
       ORDER BY a.started_at DESC LIMIT 1
     ) current ON true
     WHERE v.tenant_id = $1 AND v.id = $2`,
    [tenantId, vehicleId, at],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    vehicle: { id: row.vehicle_id, registration: row.registration, make: row.make, model: row.model },
    recordedAssignment: row.recorded_id ? {
      id: row.recorded_id,
      driver_id: row.recorded_driver_id!,
      driver_name: row.recorded_driver_name!,
      started_at: row.recorded_started_at!,
      ended_at: row.recorded_ended_at,
    } : null,
    currentAssignment: row.current_id ? {
      id: row.current_id,
      driver_id: row.current_driver_id!,
      driver_name: row.current_driver_name!,
      started_at: row.current_started_at!,
    } : null,
  };
}

export async function createAssignment(tenantId: string, actorId: string, input: AssignmentInput) {
  const client = await pool.connect();
  const id = randomUUID();
  try {
    await client.query("BEGIN");
    // Serialize assignment changes for this tenant before reading either active side.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [tenantId]);
    const [vehicle, driver] = await Promise.all([
      client.query<{ archived: boolean }>("SELECT archived_at IS NOT NULL AS archived FROM vehicle WHERE tenant_id = $1 AND id = $2", [tenantId, input.vehicleId]),
      client.query<{ archived: boolean }>("SELECT archived_at IS NOT NULL AS archived FROM driver WHERE tenant_id = $1 AND id = $2", [tenantId, input.driverId]),
    ]);
    if (!vehicle.rows[0]) throw new AssignmentError("Select a vehicle from this organization.", 400);
    if (!driver.rows[0]) throw new AssignmentError("Select a driver from this organization.", 400);
    if (vehicle.rows[0].archived) throw new AssignmentError("Restore this vehicle before assigning it.", 409);
    if (driver.rows[0].archived) throw new AssignmentError("Restore this driver before assigning them.", 409);
    if (Date.parse(input.startedAt) > Date.now() + 60_000) {
      throw new AssignmentError("The assignment start cannot be in the future.", 400);
    }

    const historicalOverlap = await client.query(
      `SELECT 1 FROM assignment WHERE tenant_id = $1
       AND (vehicle_id = $2 OR driver_id = $3)
       AND ended_at IS NOT NULL AND ended_at > $4::timestamptz LIMIT 1`,
      [tenantId, input.vehicleId, input.driverId, input.startedAt],
    );
    if (historicalOverlap.rows[0]) {
      throw new AssignmentError("Start after the latest completed assignment for this driver and vehicle.", 409);
    }
    const active = await client.query<{ id: string; vehicle_id: string; driver_id: string; started_at: string }>(
      `SELECT id, vehicle_id, driver_id, started_at::text FROM assignment
       WHERE tenant_id = $1 AND ended_at IS NULL AND (vehicle_id = $2 OR driver_id = $3)
       FOR UPDATE`,
      [tenantId, input.vehicleId, input.driverId],
    );
    if (active.rows.some((row) => row.vehicle_id === input.vehicleId && row.driver_id === input.driverId)) {
      throw new AssignmentError("This driver is already assigned to this vehicle.", 409);
    }
    if (active.rows.some((row) => Date.parse(row.started_at) >= Date.parse(input.startedAt))) {
      throw new AssignmentError("Start after the current assignment began.", 409);
    }
    if (active.rows.length && !input.closureReason) {
      throw new AssignmentError("Explain why the current assignment is ending.", 400);
    }
    if (active.rows.length) {
      await client.query(
        `UPDATE assignment SET ended_at = $3::timestamptz, end_reason = $4, ended_by_user_id = $5
         WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, active.rows.map((row) => row.id), input.startedAt, input.closureReason, actorId],
      );
    }
    await client.query(
      `INSERT INTO assignment
       (id, tenant_id, vehicle_id, driver_id, started_at, start_reason, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7)`,
      [id, tenantId, input.vehicleId, input.driverId, input.startedAt, input.startReason, actorId],
    );
    await client.query("COMMIT");
    return { id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
