import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { getPrivateDocumentStorage, getVehicleDocumentMimeType, type VehicleDocumentExtension } from "@/lib/vehicle-documents";
import type { ParsedClaimInput } from "@/lib/claim-validation";
import type { ClaimContactRole, ParsedClaimContact } from "@/lib/claim-contact-validation";
import type { ClaimLifecycleAction, ClaimStageType, ParsedClaimStage } from "@/lib/claim-stage-validation";

const readerRoles = ["administrator", "fleet_manager", "manager"];
const writerRoles = ["administrator", "manager"];

export class ClaimError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export type ClaimEvidence = {
  id: string;
  file_name: string;
  file_extension: VehicleDocumentExtension;
  content_type: string;
  file_size: string;
  created_at: string;
};

export type Claim = {
  id: string;
  vehicle_id: string;
  vehicle_registration: string;
  vehicle_make: string;
  vehicle_model: string;
  incident_date: string;
  description: string;
  status: "open" | "closed" | "cancelled" | "archived";
  created_at: string;
  updated_at: string;
  initial_evidence: ClaimEvidence;
};

export type ClaimStageEvidence = {
  id: string;
  file_name: string;
  file_extension: VehicleDocumentExtension;
  content_type: string;
  file_size: string;
  created_at: string;
};

export type ClaimStage = {
  id: string;
  step_type: ClaimStageType | "declared" | "closed" | "cancelled" | "archived";
  step_date: string;
  note: string | null;
  created_at: string;
  actor_name: string;
  evidence: ClaimStageEvidence | null;
};

export type ClaimContact = {
  id: string;
  role: ClaimContactRole;
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  created_at: string;
};

type ClaimRow = Omit<Claim, "initial_evidence"> & {
  evidence_id: string;
  evidence_file_name: string;
  evidence_file_extension: VehicleDocumentExtension;
  evidence_content_type: string;
  evidence_file_size: string;
  evidence_created_at: string;
};

function assertReader(role: string) {
  if (!readerRoles.includes(role)) throw new ClaimError("Forbidden.", 403);
}

function assertWriter(role: string) {
  if (!writerRoles.includes(role)) throw new ClaimError("Forbidden.", 403);
}

function mapClaimContact(row: ClaimContact) {
  return row;
}

async function assertClaimInTenant(tenantId: string, claimId: string) {
  const result = await pool.query(
    `SELECT 1 FROM claim c JOIN vehicle v ON v.id = c.vehicle_id AND v.tenant_id = c.tenant_id
     WHERE c.tenant_id = $1 AND c.id = $2`,
    [tenantId, claimId],
  );
  if (!result.rows[0]) throw new ClaimError("Claim not found.", 404);
}

export async function listClaimContacts(tenantId: string, claimId: string, role: string) {
  assertReader(role);
  await assertClaimInTenant(tenantId, claimId);
  const result = await pool.query<ClaimContact>(
    `SELECT id, role, name, phone, email, note, created_at::text
     FROM claim_contacts WHERE tenant_id = $1 AND claim_id = $2
     ORDER BY created_at, id`,
    [tenantId, claimId],
  );
  return result.rows.map(mapClaimContact);
}

export async function createClaimContact(tenantId: string, claimId: string, role: string, contact: ParsedClaimContact) {
  assertWriter(role);
  const id = randomUUID();
  const result = await pool.query<ClaimContact>(
    `INSERT INTO claim_contacts (id, tenant_id, claim_id, role, name, phone, email, note)
     SELECT $1, c.tenant_id, c.id, $4, $5, $6, $7, $8
     FROM claim c JOIN vehicle v ON v.id = c.vehicle_id AND v.tenant_id = c.tenant_id
     WHERE c.tenant_id = $2 AND c.id = $3
     RETURNING id, role, name, phone, email, note, created_at::text`,
    [id, tenantId, claimId, contact.role, contact.name, contact.phone, contact.email, contact.note],
  );
  if (!result.rows[0]) throw new ClaimError("Claim not found.", 404);
  return mapClaimContact(result.rows[0]);
}

function mapClaim(row: ClaimRow): Claim {
  const { evidence_id, evidence_file_name, evidence_file_extension, evidence_content_type, evidence_file_size, evidence_created_at, ...claim } = row;
  return {
    ...claim,
    initial_evidence: {
      id: evidence_id,
      file_name: evidence_file_name,
      file_extension: evidence_file_extension,
      content_type: evidence_content_type,
      file_size: evidence_file_size,
      created_at: evidence_created_at,
    },
  };
}

const claimSelect = `SELECT c.id, c.vehicle_id, v.registration AS vehicle_registration,
  v.make AS vehicle_make, v.model AS vehicle_model, c.incident_date::text,
  c.description, c.status, c.created_at::text, c.updated_at::text,
  e.id AS evidence_id, e.file_name AS evidence_file_name, e.file_extension AS evidence_file_extension,
  e.content_type AS evidence_content_type, e.file_size::text AS evidence_file_size,
  e.created_at::text AS evidence_created_at
 FROM claim c
 JOIN vehicle v ON v.id = c.vehicle_id AND v.tenant_id = c.tenant_id
 JOIN claim_evidence e ON e.claim_id = c.id AND e.tenant_id = c.tenant_id`;

export async function listClaims(tenantId: string, role: string) {
  assertReader(role);
  const result = await pool.query<ClaimRow>(
    `${claimSelect} WHERE c.tenant_id = $1 ORDER BY c.incident_date DESC, c.created_at DESC, c.id`,
    [tenantId],
  );
  return result.rows.map(mapClaim);
}

export async function getClaim(tenantId: string, claimId: string, role: string) {
  assertReader(role);
  const result = await pool.query<ClaimRow>(`${claimSelect} WHERE c.tenant_id = $1 AND c.id = $2`, [tenantId, claimId]);
  if (!result.rows[0]) throw new ClaimError("Claim not found.", 404);
  return mapClaim(result.rows[0]);
}

export async function createClaim(input: { tenantId: string; userId: string; role: string; claim: ParsedClaimInput }) {
  assertWriter(input.role);
  const storage = getPrivateDocumentStorage();
  if (!storage) throw new ClaimError("Private evidence storage is not configured.", 503);
  const vehicle = await pool.query("SELECT 1 FROM vehicle WHERE tenant_id = $1 AND id = $2", [input.tenantId, input.claim.vehicleId]);
  if (!vehicle.rows[0]) throw new ClaimError("Vehicle not found.", 404);

  const id = randomUUID();
  const evidenceId = randomUUID();
  const storageKey = `claim-evidence/${randomUUID()}`;
  const contentType = getVehicleDocumentMimeType(input.claim.extension);
  try {
    await storage.client.send(new PutObjectCommand({
      Bucket: storage.bucket,
      Key: storageKey,
      Body: input.claim.fileBytes,
      ContentLength: input.claim.fileBytes.length,
      ContentType: contentType,
      Metadata: { "claim-id": id, "tenant-id": input.tenantId },
    }));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO claim (id, tenant_id, vehicle_id, incident_date, description, created_by_user_id)
         VALUES ($1, $2, $3, $4::date, $5, $6)`,
        [id, input.tenantId, input.claim.vehicleId, input.claim.incidentDate, input.claim.description, input.userId],
      );
      await client.query(
        `INSERT INTO claim_evidence (id, tenant_id, claim_id, storage_key, file_name, file_extension, content_type, file_size, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [evidenceId, input.tenantId, id, storageKey, input.claim.fileName, input.claim.extension, contentType, input.claim.fileBytes.length, input.userId],
      );
      await client.query(
        `INSERT INTO claim_steps (tenant_id, claim_id, step_type, step_date, note, actor_user_id)
         VALUES ($1, $2, 'declared', $3::date, 'Claim declared.', $4)`,
        [input.tenantId, id, input.claim.incidentDate, input.userId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: storageKey })).catch(() => undefined);
    throw error;
  }
  return getClaim(input.tenantId, id, input.role);
}

export async function listClaimStages(tenantId: string, claimId: string, role: string) {
  assertReader(role);
  await assertClaimInTenant(tenantId, claimId);
  const result = await pool.query<{
    id: string; step_type: ClaimStage["step_type"]; step_date: string; note: string | null; created_at: string; actor_name: string;
    evidence_id: string | null; evidence_file_name: string | null; evidence_file_extension: VehicleDocumentExtension | null;
    evidence_content_type: string | null; evidence_file_size: string | null; evidence_created_at: string | null;
  }>(
    `SELECT s.id, s.step_type, s.step_date::text, s.note, s.created_at::text, u.display_name AS actor_name,
       e.id AS evidence_id, e.file_name AS evidence_file_name, e.file_extension AS evidence_file_extension,
       e.content_type AS evidence_content_type, e.file_size::text AS evidence_file_size, e.created_at::text AS evidence_created_at
     FROM claim_steps s
     JOIN claim c ON c.id = s.claim_id AND c.tenant_id = s.tenant_id
     JOIN vehicle v ON v.id = c.vehicle_id AND v.tenant_id = c.tenant_id
     JOIN organization_membership u ON u.user_id = s.actor_user_id AND u.tenant_id=s.tenant_id
     LEFT JOIN claim_step_evidence e ON e.id = s.proof_document_id AND e.step_id = s.id
       AND e.tenant_id = s.tenant_id AND e.claim_id = s.claim_id
     WHERE s.tenant_id = $1 AND s.claim_id = $2
     ORDER BY s.step_date, s.created_at, s.id`,
    [tenantId, claimId],
  );
  return result.rows.map((row): ClaimStage => ({
    id: row.id,
    step_type: row.step_type,
    step_date: row.step_date,
    note: row.note,
    created_at: row.created_at,
    actor_name: row.actor_name,
    evidence: row.evidence_id ? {
      id: row.evidence_id,
      file_name: row.evidence_file_name!,
      file_extension: row.evidence_file_extension!,
      content_type: row.evidence_content_type!,
      file_size: row.evidence_file_size!,
      created_at: row.evidence_created_at!,
    } : null,
  }));
}

export async function createClaimStage(tenantId: string, claimId: string, userId: string, role: string, stage: ParsedClaimStage) {
  assertWriter(role);
  const parent = await pool.query<{ status: Claim["status"] }>(
    "SELECT status FROM claim WHERE tenant_id = $1 AND id = $2",
    [tenantId, claimId],
  );
  if (!parent.rows[0]) throw new ClaimError("Claim not found.", 404);
  if (parent.rows[0].status !== "open") throw new ClaimError("Stages can only be added to an open claim.", 409);

  const stageId = randomUUID();
  const evidenceId = stage.fileBytes ? randomUUID() : null;
  const storageKey = evidenceId ? `claim-stage-evidence/${randomUUID()}` : null;
  const contentType = stage.extension ? getVehicleDocumentMimeType(stage.extension) : null;
  const storage = storageKey ? getPrivateDocumentStorage() : null;
  if (storageKey && !storage) throw new ClaimError("Private evidence storage is not configured.", 503);
  if (storage && storageKey && stage.fileBytes && contentType) {
    try {
      await storage.client.send(new PutObjectCommand({
        Bucket: storage.bucket,
        Key: storageKey,
        Body: stage.fileBytes,
        ContentLength: stage.fileBytes.length,
        ContentType: contentType,
        Metadata: { "claim-id": claimId, "tenant-id": tenantId, "claim-step-id": stageId },
    }));
    } catch {
      await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: storageKey })).catch(() => undefined);
      throw new ClaimError("Evidence could not be saved to private storage.", 503);
    }
  }

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const locked = await client.query<{ status: Claim["status"] }>(
      "SELECT status FROM claim WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
      [tenantId, claimId],
    );
    if (!locked.rows[0]) throw new ClaimError("Claim not found.", 404);
    if (locked.rows[0].status !== "open") throw new ClaimError("Stages can only be added to an open claim.", 409);
    await client.query(
      `INSERT INTO claim_steps (id, tenant_id, claim_id, step_type, step_date, note, proof_document_id, actor_user_id)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8)`,
      [stageId, tenantId, claimId, stage.stepType, stage.stepDate, stage.note, evidenceId, userId],
    );
    if (evidenceId && storageKey && stage.fileBytes && stage.fileName && stage.extension && contentType) {
      await client.query(
        `INSERT INTO claim_step_evidence
         (id, tenant_id, claim_id, step_id, storage_key, file_name, file_extension, content_type, file_size, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [evidenceId, tenantId, claimId, stageId, storageKey, stage.fileName, stage.extension, contentType, stage.fileBytes.length, userId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ClaimError) throw error;
    throw error;
  } finally {
    client?.release();
    if (storage && storageKey) {
      const exists = await pool.query("SELECT 1 FROM claim_step_evidence WHERE id = $1 AND tenant_id = $2", [evidenceId, tenantId]).catch(() => ({ rows: [] }));
      if (!exists.rows[0]) await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: storageKey })).catch(() => undefined);
    }
  }
  return (await listClaimStages(tenantId, claimId, role)).find((item) => item.id === stageId)!;
}

export async function changeClaimLifecycle(tenantId: string, claimId: string, userId: string, role: string, action: ClaimLifecycleAction, reason: string | null) {
  assertWriter(role);
  const targetStatus = action === "close" ? "closed" : action === "cancel" ? "cancelled" : "archived";
  const stepType = targetStatus;
  const date = new Date().toISOString().slice(0, 10);
  const note = action === "cancel" ? reason : action === "close" ? reason ?? "Claim closed." : reason ?? "Claim archived.";
  const client = await pool.connect();
  let stageId = "";
  try {
    await client.query("BEGIN");
    const claim = await client.query<{ status: Claim["status"] }>(
      "SELECT status FROM claim WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
      [tenantId, claimId],
    );
    const current = claim.rows[0]?.status;
    if (!current) throw new ClaimError("Claim not found.", 404);
    const allowed = action === "archive" ? current === "closed" : current === "open";
    if (!allowed) throw new ClaimError(action === "archive" ? "Only a closed claim can be archived." : "Only an open claim can be changed to this state.", 409);
    stageId = randomUUID();
    await client.query(
      `INSERT INTO claim_steps (id, tenant_id, claim_id, step_type, step_date, note, actor_user_id)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7)`,
      [stageId, tenantId, claimId, stepType, date, note, userId],
    );
    await client.query("UPDATE claim SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = $2", [tenantId, claimId, targetStatus]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const stages = await listClaimStages(tenantId, claimId, role);
  return { status: targetStatus, stage: stages.find((item) => item.id === stageId)! };
}

export async function getClaimStageEvidenceContent(tenantId: string, claimId: string, stageId: string, evidenceId: string, role: string, download: boolean) {
  assertReader(role);
  const result = await pool.query<{
    storage_key: string; content_type: string; file_name: string; file_size: string; file_extension: VehicleDocumentExtension;
  }>(
    `SELECT e.storage_key, e.content_type, e.file_name, e.file_size::text, e.file_extension
     FROM claim_step_evidence e
     JOIN claim_steps s ON s.id = e.step_id AND s.tenant_id = e.tenant_id AND s.claim_id = e.claim_id
     JOIN claim c ON c.id = s.claim_id AND c.tenant_id = s.tenant_id
     JOIN vehicle v ON v.id = c.vehicle_id AND v.tenant_id = c.tenant_id
     WHERE c.tenant_id = $1 AND c.id = $2 AND s.id = $3 AND e.id = $4`,
    [tenantId, claimId, stageId, evidenceId],
  );
  const evidence = result.rows[0];
  if (!evidence) throw new ClaimError("Stage evidence not found.", 404);
  const storage = getPrivateDocumentStorage();
  if (!storage) throw new ClaimError("Private evidence storage is not configured.", 503);
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
    throw new ClaimError("Stage evidence content is unavailable.", 503);
  }
}

export async function getClaimEvidenceContent(tenantId: string, claimId: string, evidenceId: string, role: string, download: boolean) {
  assertReader(role);
  const result = await pool.query<{
    storage_key: string; content_type: string; file_name: string; file_size: string; file_extension: VehicleDocumentExtension;
  }>(
    `SELECT e.storage_key, e.content_type, e.file_name, e.file_size::text, e.file_extension
     FROM claim_evidence e JOIN claim c ON c.id = e.claim_id AND c.tenant_id = e.tenant_id
     JOIN vehicle v ON v.id = c.vehicle_id AND v.tenant_id = c.tenant_id
     WHERE c.tenant_id = $1 AND c.id = $2 AND e.id = $3`,
    [tenantId, claimId, evidenceId],
  );
  const evidence = result.rows[0];
  if (!evidence) throw new ClaimError("Initial evidence not found.", 404);
  const storage = getPrivateDocumentStorage();
  if (!storage) throw new ClaimError("Private evidence storage is not configured.", 503);
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
    throw new ClaimError("Initial evidence content is unavailable.", 503);
  }
}
