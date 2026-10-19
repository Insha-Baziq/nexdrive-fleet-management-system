import "server-only";
import { pool } from "@/lib/db";

export type ArchivedRecordKind = "vehicle" | "driver";

export class RecordArchiveError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function getRecordArchiveState(tenantId: string, id: string, kind: ArchivedRecordKind): Promise<"missing" | "active" | "archived"> {
  const table = kind === "vehicle" ? "vehicle" : "driver";
  const result = await pool.query<{ archived: boolean }>(
    `SELECT archived_at IS NOT NULL AS archived FROM ${table} WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  if (!result.rows[0]) return "missing";
  return result.rows[0].archived ? "archived" : "active";
}

async function transitionRecord(
  tenantId: string,
  id: string,
  kind: ArchivedRecordKind,
  archived: boolean,
) {
  const client = await pool.connect();
  const table = kind === "vehicle" ? "vehicle" : "driver";
  try {
    await client.query("BEGIN");
    // Assignment creation, archive, restore, and assignment end all serialize on this tenant lock.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [tenantId]);
    const record = await client.query<{ archived_at: string | null }>(
      `SELECT archived_at::text FROM ${table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, id],
    );
    if (!record.rows[0]) throw new RecordArchiveError(`${kind === "vehicle" ? "Vehicle" : "Driver"} not found.`, 404);
    const isArchived = record.rows[0].archived_at !== null;
    if (isArchived === archived) {
      throw new RecordArchiveError(archived ? "This record is already archived." : "This record is already active.", 409);
    }
    if (archived) {
      const activeAssignment = await client.query(
        `SELECT 1 FROM assignment WHERE tenant_id = $1 AND ${kind}_id = $2 AND ended_at IS NULL LIMIT 1 FOR UPDATE`,
        [tenantId, id],
      );
      if (activeAssignment.rows[0]) {
        throw new RecordArchiveError(`End the active assignment before archiving this ${kind}.`, 409);
      }
    }
    await client.query(
      `UPDATE ${table} SET archived_at = ${archived ? "CURRENT_TIMESTAMP" : "NULL"}, updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    await client.query("COMMIT");
    return { id, archived };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function archiveRecord(tenantId: string, id: string, kind: ArchivedRecordKind) {
  return transitionRecord(tenantId, id, kind, true);
}

export function restoreRecord(tenantId: string, id: string, kind: ArchivedRecordKind) {
  return transitionRecord(tenantId, id, kind, false);
}
