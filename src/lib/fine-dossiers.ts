import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { getPrivateDocumentStorage, getVehicleDocumentMimeType, type VehicleDocumentExtension } from "@/lib/vehicle-documents";
import type { FineStatus, FineType, ParsedFineInput } from "@/lib/fine-validation";
import type { FineWorkflowStepType } from "@/lib/fine-step-status";
import type { ParsedFineCompanyPaidMarker } from "@/lib/fine-company-paid-validation";
import type { ParsedFineStep } from "@/lib/fine-step-validation";

const readerRoles = ["administrator", "fleet_manager", "manager"];
const writerRoles = ["administrator", "manager"];

export class FineError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export type FineEvidence = {
  id: string;
  file_name: string;
  file_extension: VehicleDocumentExtension;
  content_type: string;
  file_size: string;
  created_at: string;
};

export type FineStepEvidence = FineEvidence & { source: "fine" | "step" };

export type FineStep = {
  id: string;
  step_type: FineWorkflowStepType;
  step_date: string;
  note: string | null;
  response_positive: boolean | null;
  designated_driver_id: string | null;
  designated_driver_name: string | null;
  created_at: string;
  actor_name: string | null;
  evidence: FineStepEvidence;
};

export type FineCompanyPaidMarker = {
  id: string;
  context: string;
  created_at: string;
  recorded_by_name: string;
  evidence: FineEvidence;
};

export type Fine = {
  id: string;
  reference: string;
  fine_type: FineType;
  vehicle_id: string;
  vehicle_registration: string;
  vehicle_make: string;
  vehicle_model: string;
  infraction_at: string;
  payment_deadline: string;
  description: string | null;
  amount: string | null;
  status: FineStatus;
  created_at: string;
  updated_at: string;
  evidence: FineEvidence;
  recorded_driver?: {
    driver_id: string;
    driver_name: string;
    started_at: string;
    ended_at: string | null;
  } | null;
};

type FineListRow = Omit<Fine, "evidence"> & {
  evidence_id: string;
  evidence_file_name: string;
  evidence_file_extension: VehicleDocumentExtension;
  evidence_content_type: string;
  evidence_file_size: string;
  evidence_created_at: string;
};

function assertReader(role: string) {
  if (!readerRoles.includes(role)) throw new FineError("Forbidden.", 403);
}

function assertWriter(role: string) {
  if (!writerRoles.includes(role)) throw new FineError("Forbidden.", 403);
}

export async function listFines(tenantId: string, role: string) {
  assertReader(role);
  const result = await pool.query<FineListRow>(
    `SELECT f.id, f.reference, f.fine_type, f.vehicle_id, v.registration AS vehicle_registration,
      v.make AS vehicle_make, v.model AS vehicle_model, f.infraction_at::text, f.payment_deadline::text,
      f.description, f.amount::text, f.status, f.created_at::text, f.updated_at::text,
      e.id AS evidence_id, e.file_name AS evidence_file_name, e.file_extension AS evidence_file_extension,
      e.content_type AS evidence_content_type, e.file_size::text AS evidence_file_size, e.created_at::text AS evidence_created_at
     FROM fine f
     JOIN vehicle v ON v.id = f.vehicle_id AND v.tenant_id = f.tenant_id
     JOIN fine_evidence e ON e.fine_id = f.id AND e.tenant_id = f.tenant_id
     WHERE f.tenant_id = $1
     ORDER BY f.infraction_at DESC, f.created_at DESC, f.id`,
    [tenantId],
  );
  return result.rows.map(({ evidence_id, evidence_file_name, evidence_file_extension, evidence_content_type, evidence_file_size, evidence_created_at, ...fine }) => ({
    ...fine,
    evidence: {
      id: evidence_id,
      file_name: evidence_file_name,
      file_extension: evidence_file_extension,
      content_type: evidence_content_type,
      file_size: evidence_file_size,
      created_at: evidence_created_at,
    },
  }));
}

export async function getFine(tenantId: string, fineId: string, role: string): Promise<Fine> {
  assertReader(role);
  const result = await pool.query<Fine & {
    evidence_id: string; evidence_file_name: string; evidence_file_extension: VehicleDocumentExtension;
    evidence_content_type: string; evidence_file_size: string; evidence_created_at: string;
    recorded_driver_id: string | null; recorded_driver_name: string | null;
    recorded_started_at: string | null; recorded_ended_at: string | null;
  }>(
    `SELECT f.id, f.reference, f.fine_type, f.vehicle_id, v.registration AS vehicle_registration,
      v.make AS vehicle_make, v.model AS vehicle_model, f.infraction_at::text, f.payment_deadline::text,
      f.description, f.amount::text, f.status, f.created_at::text, f.updated_at::text,
      e.id AS evidence_id, e.file_name AS evidence_file_name, e.file_extension AS evidence_file_extension,
      e.content_type AS evidence_content_type, e.file_size::text AS evidence_file_size, e.created_at::text AS evidence_created_at,
      recorded.driver_id AS recorded_driver_id, recorded.driver_name AS recorded_driver_name,
      recorded.started_at AS recorded_started_at, recorded.ended_at AS recorded_ended_at
     FROM fine f
     JOIN vehicle v ON v.id = f.vehicle_id AND v.tenant_id = f.tenant_id
     JOIN fine_evidence e ON e.fine_id = f.id AND e.tenant_id = f.tenant_id
     LEFT JOIN LATERAL (
       SELECT a.driver_id, d.full_name AS driver_name,
         a.started_at::text AS started_at, a.ended_at::text AS ended_at
       FROM assignment a
       JOIN driver d ON d.id = a.driver_id AND d.tenant_id = a.tenant_id
       WHERE a.tenant_id = f.tenant_id AND a.vehicle_id = f.vehicle_id
         AND f.fine_type = 'driver'
         AND a.started_at <= f.infraction_at
         AND (a.ended_at IS NULL OR f.infraction_at < a.ended_at)
       ORDER BY a.started_at DESC, a.created_at DESC
       LIMIT 1
     ) recorded ON true
     WHERE f.tenant_id = $1 AND f.id = $2`,
    [tenantId, fineId],
  );
  const row = result.rows[0];
  if (!row) throw new FineError("Fine not found.", 404);
  return {
    id: row.id,
    reference: row.reference,
    fine_type: row.fine_type,
    vehicle_id: row.vehicle_id,
    vehicle_registration: row.vehicle_registration,
    vehicle_make: row.vehicle_make,
    vehicle_model: row.vehicle_model,
    infraction_at: row.infraction_at,
    payment_deadline: row.payment_deadline,
    description: row.description,
    amount: row.amount,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    evidence: {
      id: row.evidence_id,
      file_name: row.evidence_file_name,
      file_extension: row.evidence_file_extension,
      content_type: row.evidence_content_type,
      file_size: row.evidence_file_size,
      created_at: row.evidence_created_at,
    },
    recorded_driver: row.recorded_driver_id ? {
      driver_id: row.recorded_driver_id,
      driver_name: row.recorded_driver_name!,
      started_at: row.recorded_started_at!,
      ended_at: row.recorded_ended_at,
    } : null,
  };
}

export async function createFine(input: {
  tenantId: string;
  userId: string;
  role: string;
  fine: ParsedFineInput;
}) {
  assertWriter(input.role);
  const storage = getPrivateDocumentStorage();
  if (!storage) throw new FineError("Private evidence storage is not configured.", 503);
  const vehicle = await pool.query("SELECT 1 FROM vehicle WHERE tenant_id = $1 AND id = $2", [input.tenantId, input.fine.vehicleId]);
  if (!vehicle.rows[0]) throw new FineError("Vehicle not found.", 404);

  const id = randomUUID();
  const evidenceId = randomUUID();
  const objectKey = `fine-evidence/${randomUUID()}`;
  const contentType = getVehicleDocumentMimeType(input.fine.extension);
  try {
    await storage.client.send(new PutObjectCommand({
      Bucket: storage.bucket,
      Key: objectKey,
      Body: input.fine.fileBytes,
      ContentLength: input.fine.fileBytes.length,
      ContentType: contentType,
      Metadata: { "fine-id": id, "tenant-id": input.tenantId },
    }));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO fine (id, tenant_id, vehicle_id, reference, fine_type, infraction_at, payment_deadline, description, amount, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::date, $8, $9::numeric, $10)`,
        [id, input.tenantId, input.fine.vehicleId, input.fine.reference, input.fine.fineType,
          input.fine.infractionAt, input.fine.paymentDeadline, input.fine.description, input.fine.amount, input.userId],
      );
      await client.query(
        `INSERT INTO fine_evidence (id, tenant_id, fine_id, storage_key, file_name, file_extension, content_type, file_size, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [evidenceId, input.tenantId, id, objectKey, input.fine.fileName, input.fine.extension, contentType, input.fine.fileBytes.length, input.userId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: objectKey })).catch(() => undefined);
    if (error instanceof FineError) throw error;
    throw error;
  }
  return getFine(input.tenantId, id, input.role);
}

export async function updateFineStatus(tenantId: string, fineId: string, role: string, status: FineStatus) {
  assertWriter(role);
  const result = await pool.query(
    `UPDATE fine SET status = $3, updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, fineId, status],
  );
  if (!result.rows[0]) throw new FineError("Fine not found.", 404);
  return getFine(tenantId, fineId, role);
}

export async function getFineEvidenceContent(tenantId: string, fineId: string, evidenceId: string, role: string, download: boolean) {
  assertReader(role);
  const result = await pool.query<{
    storage_key: string; content_type: string; file_name: string; file_size: string; file_extension: VehicleDocumentExtension;
  }>(
    `SELECT e.storage_key, e.content_type, e.file_name, e.file_size::text, e.file_extension
     FROM fine_evidence e JOIN fine f ON f.id = e.fine_id AND f.tenant_id = e.tenant_id
     WHERE f.tenant_id = $1 AND f.id = $2 AND e.id = $3`,
    [tenantId, fineId, evidenceId],
  );
  const evidence = result.rows[0];
  if (!evidence) throw new FineError("Evidence not found.", 404);
  const storage = getPrivateDocumentStorage();
  if (!storage) throw new FineError("Private evidence storage is not configured.", 503);
  try {
    const object = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: evidence.storage_key }));
    if (!object.Body) throw new Error("Missing object body");
    const disposition = download || evidence.file_extension === "docx" ? "attachment" : "inline";
    const safeFileName = encodeURIComponent(evidence.file_name).replaceAll("'", "%27");
    return new Response(object.Body.transformToWebStream(), {
      status: 200,
      headers: {
        "Content-Type": evidence.content_type,
        "Content-Length": evidence.file_size,
        "Content-Disposition": `${disposition}; filename*=UTF-8''${safeFileName}`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none';",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    throw new FineError("Evidence content is unavailable.", 503);
  }
}

export async function listFineSteps(tenantId: string, fineId: string, role: string): Promise<FineStep[]> {
  assertReader(role);
  const result = await pool.query<FineStep & {
    evidence_id: string;
    evidence_file_name: string;
    evidence_file_extension: VehicleDocumentExtension;
    evidence_content_type: string;
    evidence_file_size: string;
    evidence_created_at: string;
    evidence_source: "fine" | "step";
  }>(
    `SELECT ('received:' || f.id::text) AS id, 'received'::text AS step_type,
       f.created_at::date::text AS step_date, NULL::text AS note, NULL::boolean AS response_positive,
       NULL::uuid AS designated_driver_id, NULL::text AS designated_driver_name,
       f.created_at::text AS created_at, creator.display_name AS actor_name,
       e.id AS evidence_id, e.file_name AS evidence_file_name, e.file_extension AS evidence_file_extension,
       e.content_type AS evidence_content_type, e.file_size::text AS evidence_file_size,
       e.created_at::text AS evidence_created_at, 'fine'::text AS evidence_source
     FROM fine f
     JOIN vehicle v ON v.id = f.vehicle_id AND v.tenant_id = f.tenant_id
     JOIN fine_evidence e ON e.fine_id = f.id AND e.tenant_id = f.tenant_id
     JOIN organization_membership creator ON creator.user_id = f.created_by_user_id AND creator.tenant_id=f.tenant_id
     WHERE f.tenant_id = $1 AND f.id = $2
     UNION ALL
     SELECT s.id::text AS id, s.step_type, s.step_date::text, s.note, s.response_positive,
       s.designated_driver_id, d.full_name AS designated_driver_name,
       s.created_at::text, actor.display_name AS actor_name,
       e.id AS evidence_id, e.file_name AS evidence_file_name, e.file_extension AS evidence_file_extension,
       e.content_type AS evidence_content_type, e.file_size::text AS evidence_file_size,
       e.created_at::text AS evidence_created_at, 'step'::text AS evidence_source
     FROM fine_steps s
     JOIN fine f ON f.id = s.fine_id AND f.tenant_id = s.tenant_id
     JOIN vehicle v ON v.id = f.vehicle_id AND v.tenant_id = f.tenant_id
     JOIN organization_membership actor ON actor.user_id = s.actor_user_id AND actor.tenant_id=s.tenant_id
     LEFT JOIN driver d ON d.id = s.designated_driver_id AND d.tenant_id = s.tenant_id
     JOIN fine_step_evidence e ON e.id = s.proof_document_id AND e.step_id = s.id
       AND e.fine_id = s.fine_id AND e.tenant_id = s.tenant_id
     WHERE s.tenant_id = $1 AND s.fine_id = $2
     ORDER BY step_date, created_at, id`,
    [tenantId, fineId],
  );
  if (!result.rows.length) {
    const parent = await pool.query("SELECT 1 FROM fine WHERE tenant_id = $1 AND id = $2", [tenantId, fineId]);
    if (!parent.rows[0]) throw new FineError("Fine not found.", 404);
  }
  return result.rows.map((row): FineStep => ({
    id: row.id,
    step_type: row.step_type,
    step_date: row.step_date,
    note: row.note,
    response_positive: row.response_positive,
    designated_driver_id: row.designated_driver_id,
    designated_driver_name: row.designated_driver_name,
    created_at: row.created_at,
    actor_name: row.actor_name,
    evidence: {
      id: row.evidence_id,
      file_name: row.evidence_file_name,
      file_extension: row.evidence_file_extension,
      content_type: row.evidence_content_type,
      file_size: row.evidence_file_size,
      created_at: row.evidence_created_at,
      source: row.evidence_source,
    },
  }));
}

export async function createFineStep(input: {
  tenantId: string;
  fineId: string;
  userId: string;
  role: string;
  step: ParsedFineStep;
}): Promise<FineStep> {
  if (input.role !== "manager") throw new FineError("Forbidden.", 403);
  const parent = await pool.query<{ status: FineStatus }>(
    "SELECT status FROM fine WHERE tenant_id = $1 AND id = $2",
    [input.tenantId, input.fineId],
  );
  if (!parent.rows[0]) throw new FineError("Fine not found.", 404);
  if (parent.rows[0].status !== "open") throw new FineError("Steps can only be added to an open fine.", 409);

  if (input.step.designatedDriverId) {
    const driver = await pool.query("SELECT 1 FROM driver WHERE tenant_id = $1 AND id = $2", [input.tenantId, input.step.designatedDriverId]);
    if (!driver.rows[0]) throw new FineError("Driver not found.", 404);
  }

  const storage = getPrivateDocumentStorage();
  if (!storage) throw new FineError("Private evidence storage is not configured.", 503);
  const stepId = randomUUID();
  const evidenceId = randomUUID();
  const storageKey = `fine-step-evidence/${randomUUID()}`;
  const contentType = getVehicleDocumentMimeType(input.step.extension);
  let client: PoolClient | null = null;
  try {
    try {
      await storage.client.send(new PutObjectCommand({
        Bucket: storage.bucket,
        Key: storageKey,
        Body: input.step.fileBytes,
        ContentLength: input.step.fileBytes.length,
        ContentType: contentType,
        Metadata: { "fine-id": input.fineId, "tenant-id": input.tenantId, "fine-step-id": stepId },
      }));
    } catch {
      throw new FineError("Proof could not be saved to private storage.", 503);
    }

    client = await pool.connect();
    await client.query("BEGIN");
    const locked = await client.query<{ status: FineStatus }>(
      "SELECT status FROM fine WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
      [input.tenantId, input.fineId],
    );
    if (!locked.rows[0]) throw new FineError("Fine not found.", 404);
    if (locked.rows[0].status !== "open") throw new FineError("Steps can only be added to an open fine.", 409);
    await client.query(
      `INSERT INTO fine_steps
       (id, tenant_id, fine_id, step_type, step_date, note, response_positive, designated_driver_id, proof_document_id, actor_user_id)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10)`,
      [stepId, input.tenantId, input.fineId, input.step.stepType, input.step.stepDate, input.step.note,
        input.step.responsePositive, input.step.designatedDriverId, evidenceId, input.userId],
    );
    await client.query(
      `INSERT INTO fine_step_evidence
       (id, tenant_id, fine_id, step_id, storage_key, file_name, file_extension, content_type, file_size, uploaded_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [evidenceId, input.tenantId, input.fineId, stepId, storageKey, input.step.fileName,
        input.step.extension, contentType, input.step.fileBytes.length, input.userId],
    );
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof FineError) throw error;
    throw error;
  } finally {
    client?.release();
    const exists = await pool.query(
      "SELECT 1 FROM fine_step_evidence WHERE id = $1 AND tenant_id = $2 AND fine_id = $3 AND step_id = $4",
      [evidenceId, input.tenantId, input.fineId, stepId],
    ).catch(() => ({ rows: [] }));
    if (!exists.rows[0]) await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: storageKey })).catch(() => undefined);
  }
  const created = (await listFineSteps(input.tenantId, input.fineId, input.role)).find((item) => item.id === stepId);
  if (!created) throw new FineError("Fine step could not be loaded after saving.", 503);
  return created;
}

export async function getFineStepEvidenceContent(
  tenantId: string,
  fineId: string,
  stepId: string,
  evidenceId: string,
  role: string,
  download: boolean,
) {
  assertReader(role);
  const result = await pool.query<{
    storage_key: string;
    content_type: string;
    file_name: string;
    file_size: string;
    file_extension: VehicleDocumentExtension;
  }>(
    `SELECT e.storage_key, e.content_type, e.file_name, e.file_size::text, e.file_extension
     FROM fine_step_evidence e
     JOIN fine_steps s ON s.id = e.step_id AND s.tenant_id = e.tenant_id AND s.fine_id = e.fine_id
     JOIN fine f ON f.id = s.fine_id AND f.tenant_id = s.tenant_id
     JOIN vehicle v ON v.id = f.vehicle_id AND v.tenant_id = f.tenant_id
     WHERE f.tenant_id = $1 AND f.id = $2 AND s.id = $3 AND e.id = $4`,
    [tenantId, fineId, stepId, evidenceId],
  );
  const evidence = result.rows[0];
  if (!evidence) throw new FineError("Step proof not found.", 404);
  const storage = getPrivateDocumentStorage();
  if (!storage) throw new FineError("Private evidence storage is not configured.", 503);
  try {
    const object = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: evidence.storage_key }));
    if (!object.Body) throw new Error("Missing object body");
    const disposition = download || evidence.file_extension === "docx" ? "attachment" : "inline";
    const safeFileName = encodeURIComponent(evidence.file_name).replaceAll("'", "%27");
    return new Response(object.Body.transformToWebStream(), {
      status: 200,
      headers: {
        "Content-Type": evidence.content_type,
        "Content-Length": evidence.file_size,
        "Content-Disposition": `${disposition}; filename*=UTF-8''${safeFileName}`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none';",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    throw new FineError("Step proof content is unavailable.", 503);
  }
}

export async function getFineCompanyPaidMarkerState(tenantId: string, fineId: string, role: string) {
  assertReader(role);
  const result = await pool.query<{
    fine_type: FineType;
    status: FineStatus;
    has_designation: boolean;
    marker_id: string | null;
    context: string | null;
    marker_created_at: string | null;
    recorded_by_name: string | null;
    evidence_id: string | null;
    evidence_file_name: string | null;
    evidence_file_extension: VehicleDocumentExtension | null;
    evidence_content_type: string | null;
    evidence_file_size: string | null;
    evidence_created_at: string | null;
  }>(
    `SELECT f.fine_type, f.status,
       EXISTS (SELECT 1 FROM fine_steps s
         WHERE s.tenant_id = f.tenant_id AND s.fine_id = f.id AND s.step_type = 'designation') AS has_designation,
       m.id AS marker_id, m.context, m.created_at::text AS marker_created_at, actor.display_name AS recorded_by_name,
       e.id AS evidence_id, e.file_name AS evidence_file_name, e.file_extension AS evidence_file_extension,
       e.content_type AS evidence_content_type, e.file_size::text AS evidence_file_size,
       e.created_at::text AS evidence_created_at
     FROM fine f
     LEFT JOIN fine_company_paid_markers m ON m.fine_id = f.id AND m.tenant_id = f.tenant_id
     LEFT JOIN organization_membership actor ON actor.user_id = m.recorded_by_user_id AND actor.tenant_id=m.tenant_id
     LEFT JOIN fine_company_paid_marker_evidence e
       ON e.id = m.proof_document_id AND e.marker_id = m.id AND e.fine_id = f.id AND e.tenant_id = f.tenant_id
     WHERE f.tenant_id = $1 AND f.id = $2`,
    [tenantId, fineId],
  );
  const row = result.rows[0];
  if (!row) throw new FineError("Fine not found.", 404);
  const marker: FineCompanyPaidMarker | null = row.marker_id && row.evidence_id ? {
    id: row.marker_id,
    context: row.context!,
    created_at: row.marker_created_at!,
    recorded_by_name: row.recorded_by_name!,
    evidence: {
      id: row.evidence_id,
      file_name: row.evidence_file_name!,
      file_extension: row.evidence_file_extension!,
      content_type: row.evidence_content_type!,
      file_size: row.evidence_file_size!,
      created_at: row.evidence_created_at!,
    },
  } : null;
  return {
    marker,
    canRecord: role === "manager" && row.fine_type === "driver" && row.status !== "cancelled"
      && row.has_designation && !marker,
  };
}

async function assertCompanyPaidMarkerEligible(tenantId: string, fineId: string) {
  const parent = await pool.query<{ fine_type: FineType; status: FineStatus; has_designation: boolean }>(
    `SELECT f.fine_type, f.status,
       EXISTS (SELECT 1 FROM fine_steps s
         WHERE s.tenant_id = f.tenant_id AND s.fine_id = f.id AND s.step_type = 'designation') AS has_designation
     FROM fine f WHERE f.tenant_id = $1 AND f.id = $2`,
    [tenantId, fineId],
  );
  if (!parent.rows[0]) throw new FineError("Fine not found.", 404);
  const { fine_type: fineType, status, has_designation: hasDesignation } = parent.rows[0];
  if (fineType !== "driver" || status === "cancelled" || !hasDesignation) {
    throw new FineError("This marker requires a designated driver on a non-cancelled driver-related fine.", 409);
  }
  const existing = await pool.query(
    "SELECT 1 FROM fine_company_paid_markers WHERE tenant_id = $1 AND fine_id = $2",
    [tenantId, fineId],
  );
  if (existing.rows[0]) throw new FineError("A company-paid marker is already recorded for this fine.", 409);
}

export async function createFineCompanyPaidMarker(input: {
  tenantId: string;
  fineId: string;
  userId: string;
  role: string;
  marker: ParsedFineCompanyPaidMarker;
}): Promise<FineCompanyPaidMarker> {
  if (input.role !== "manager") throw new FineError("Forbidden.", 403);
  await assertCompanyPaidMarkerEligible(input.tenantId, input.fineId);
  const storage = getPrivateDocumentStorage();
  if (!storage) throw new FineError("Private evidence storage is not configured.", 503);

  const markerId = randomUUID();
  const evidenceId = randomUUID();
  const storageKey = `fine-company-paid-evidence/${randomUUID()}`;
  const contentType = getVehicleDocumentMimeType(input.marker.extension);
  let client: PoolClient | null = null;
  try {
    try {
      await storage.client.send(new PutObjectCommand({
        Bucket: storage.bucket,
        Key: storageKey,
        Body: input.marker.fileBytes,
        ContentLength: input.marker.fileBytes.length,
        ContentType: contentType,
        Metadata: { "fine-id": input.fineId, "tenant-id": input.tenantId, "fine-company-paid-marker-id": markerId },
      }));
    } catch {
      throw new FineError("Proof could not be saved to private storage.", 503);
    }

    client = await pool.connect();
    await client.query("BEGIN");
    const locked = await client.query<{ fine_type: FineType; status: FineStatus }>(
      "SELECT fine_type, status FROM fine WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
      [input.tenantId, input.fineId],
    );
    if (!locked.rows[0]) throw new FineError("Fine not found.", 404);
    if (locked.rows[0].fine_type !== "driver" || locked.rows[0].status === "cancelled") {
      throw new FineError("This marker requires a designated driver on a non-cancelled driver-related fine.", 409);
    }
    const designation = await client.query(
      "SELECT 1 FROM fine_steps WHERE tenant_id = $1 AND fine_id = $2 AND step_type = 'designation' LIMIT 1",
      [input.tenantId, input.fineId],
    );
    if (!designation.rows[0]) throw new FineError("This marker requires a designated driver on a non-cancelled driver-related fine.", 409);
    const existing = await client.query(
      "SELECT 1 FROM fine_company_paid_markers WHERE tenant_id = $1 AND fine_id = $2",
      [input.tenantId, input.fineId],
    );
    if (existing.rows[0]) throw new FineError("A company-paid marker is already recorded for this fine.", 409);

    await client.query(
      `INSERT INTO fine_company_paid_markers
       (id, tenant_id, fine_id, context, proof_document_id, recorded_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [markerId, input.tenantId, input.fineId, input.marker.context, evidenceId, input.userId],
    );
    await client.query(
      `INSERT INTO fine_company_paid_marker_evidence
       (id, tenant_id, fine_id, marker_id, storage_key, file_name, file_extension, content_type, file_size, uploaded_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [evidenceId, input.tenantId, input.fineId, markerId, storageKey, input.marker.fileName,
        input.marker.extension, contentType, input.marker.fileBytes.length, input.userId],
    );
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof FineError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new FineError("A company-paid marker is already recorded for this fine.", 409);
    }
    throw error;
  } finally {
    client?.release();
    const exists = await pool.query(
      "SELECT 1 FROM fine_company_paid_marker_evidence WHERE id = $1 AND tenant_id = $2 AND fine_id = $3 AND marker_id = $4",
      [evidenceId, input.tenantId, input.fineId, markerId],
    ).catch(() => ({ rows: [] }));
    if (!exists.rows[0]) await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: storageKey })).catch(() => undefined);
  }

  const result = await getFineCompanyPaidMarkerState(input.tenantId, input.fineId, input.role);
  if (!result.marker) throw new FineError("Company-paid marker could not be loaded after saving.", 503);
  return result.marker;
}

export async function getFineCompanyPaidMarkerEvidenceContent(
  tenantId: string,
  fineId: string,
  evidenceId: string,
  role: string,
  download: boolean,
) {
  assertReader(role);
  const result = await pool.query<{
    storage_key: string;
    content_type: string;
    file_name: string;
    file_size: string;
    file_extension: VehicleDocumentExtension;
  }>(
    `SELECT e.storage_key, e.content_type, e.file_name, e.file_size::text, e.file_extension
     FROM fine_company_paid_marker_evidence e
     JOIN fine_company_paid_markers m ON m.id = e.marker_id AND m.tenant_id = e.tenant_id AND m.fine_id = e.fine_id
       AND m.proof_document_id = e.id
     JOIN fine f ON f.id = m.fine_id AND f.tenant_id = m.tenant_id
     JOIN vehicle v ON v.id = f.vehicle_id AND v.tenant_id = f.tenant_id
     WHERE f.tenant_id = $1 AND f.id = $2 AND e.id = $3`,
    [tenantId, fineId, evidenceId],
  );
  const evidence = result.rows[0];
  if (!evidence) throw new FineError("Company-paid marker proof not found.", 404);
  const storage = getPrivateDocumentStorage();
  if (!storage) throw new FineError("Private evidence storage is not configured.", 503);
  try {
    const object = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: evidence.storage_key }));
    if (!object.Body) throw new Error("Missing object body");
    const disposition = download || evidence.file_extension === "docx" ? "attachment" : "inline";
    const safeFileName = encodeURIComponent(evidence.file_name).replaceAll("'", "%27");
    return new Response(object.Body.transformToWebStream(), {
      status: 200,
      headers: {
        "Content-Type": evidence.content_type,
        "Content-Length": evidence.file_size,
        "Content-Disposition": `${disposition}; filename*=UTF-8''${safeFileName}`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none';",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    throw new FineError("Company-paid marker proof content is unavailable.", 503);
  }
}
