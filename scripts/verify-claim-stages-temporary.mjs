import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { isOversizedUploadRejected, maxTestUploadBytes } from "./verify-upload-limits.mjs";

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "TIGRIS_BUCKET", "TIGRIS_ACCESS_KEY_ID", "TIGRIS_SECRET_ACCESS_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Local claim-stage verification needs application and private storage configuration (${missing.join(", ")}).`);

const origin = process.env.BETTER_AUTH_URL;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const auth = betterAuth({
  baseURL: origin,
  secret: process.env.BETTER_AUTH_SECRET,
  database: { dialect: new PostgresDialect({ pool }), type: "postgres" },
  emailAndPassword: { enabled: true },
  user: { additionalFields: {
    tenantId: { type: "string", required: false, input: false },
    appRole: { type: ["administrator", "fleet_manager", "manager", "driver"], required: false, input: false },
  } },
});
const storage = new S3Client({
  endpoint: process.env.TIGRIS_ENDPOINT || "https://t3.storage.dev",
  region: "auto",
  credentials: { accessKeyId: process.env.TIGRIS_ACCESS_KEY_ID, secretAccessKey: process.env.TIGRIS_SECRET_ACCESS_KEY },
});
const bucket = process.env.TIGRIS_BUCKET;
const tenantA = randomUUID(), tenantB = randomUUID(), runId = randomUUID();
const tenants = [tenantA, tenantB];
const password = randomBytes(24).toString("base64url");
const users = [
  { key: "manager", role: "manager", tenant: tenantA },
  { key: "fleet", role: "fleet_manager", tenant: tenantA },
  { key: "driver", role: "driver", tenant: tenantA },
  { key: "foreign", role: "administrator", tenant: tenantB },
].map((user) => ({ ...user, name: `Claim stages QA ${user.key}`, email: `claim-stages-${runId}-${user.key}@example.invalid` }));
const pdf = Buffer.from("%PDF-1.7\nNexDrive claim stage evidence fixture\n%%EOF\n");

async function request(path, method = "GET", cookie, body) {
  const form = body instanceof FormData;
  const response = await fetch(origin + path, {
    method,
    headers: Object.assign({}, cookie ? { cookie } : {}, body !== undefined && !form ? { "content-type": "application/json", origin } : {}),
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    redirect: "manual",
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, data, response };
}

async function signIn(user) {
  const result = await request("/api/auth/sign-in/email", "POST", null, { email: user.email, password });
  assert.equal(result.status, 200, `${user.key} can sign in`);
  return result.response.headers.get("set-cookie")?.split(";")[0];
}

let claimA, claimB, claimToCancel, vehicleA, vehicleB;
try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Temporary Claim Stages QA A'), ($2, 'Temporary Claim Stages QA B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2 WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = saved.rows[0].id;
  }
  const [manager, fleet, driver, foreignAdmin] = await Promise.all(users.map(signIn));
  [vehicleA, vehicleB] = [randomUUID(), randomUUID()];
  await pool.query(
    `INSERT INTO vehicle (id, tenant_id, registration, make, model, current_mileage)
     VALUES ($1, $2, $3, 'Renault', 'Clio', NULL), ($4, $5, $6, 'Peugeot', '208', NULL)`,
    [vehicleA, tenantA, `CSA-${runId.slice(0, 6)}-AA`, vehicleB, tenantB, `CSB-${runId.slice(0, 6)}-AA`],
  );
  [claimA, claimB, claimToCancel] = [randomUUID(), randomUUID(), randomUUID()];
  await pool.query(
    `INSERT INTO claim (id, tenant_id, vehicle_id, incident_date, description, created_by_user_id)
     VALUES ($1, $2, $3, '2026-09-24', 'Temporary stage verification claim.', $4),
       ($5, $6, $7, '2026-09-24', 'Temporary foreign stage verification claim.', $8),
       ($9, $2, $3, '2026-09-24', 'Temporary cancellation verification claim.', $4)`,
    [claimA, tenantA, vehicleA, users[0].id, claimB, tenantB, vehicleB, users[3].id, claimToCancel],
  );
  for (const [claimId, tenantId, creator] of [[claimA, tenantA, users[0].id], [claimB, tenantB, users[3].id], [claimToCancel, tenantA, users[0].id]]) {
    await pool.query(
      `INSERT INTO claim_evidence (id, tenant_id, claim_id, storage_key, file_name, file_extension, content_type, file_size, uploaded_by_user_id)
       VALUES ($1, $2, $3, $4, 'initial.pdf', 'pdf', 'application/pdf', 1, $5)`,
      [randomUUID(), tenantId, claimId, `verification-only/claim-stages/${runId}/${claimId}`, creator],
    );
  }

  const form = new FormData();
  form.set("stepType", "quote_received");
  form.set("stepDate", "2026-09-25");
  form.set("note", "Repair estimate received for internal review.");
  form.append("evidence", new Blob([pdf], { type: "application/pdf" }), "quote.pdf");
  const savedStep = await request(`/api/claims/${claimA}/stages`, "POST", manager, form);
  assert.equal(savedStep.status, 201, `Manager can add a dated stage with evidence (received ${savedStep.status})`);
  assert.equal(savedStep.data.stage.step_type, "quote_received");
  assert.equal(savedStep.data.stage.step_date, "2026-09-25");
  assert.equal(savedStep.data.stage.evidence.file_name, "quote.pdf");

  const timeline = await request(`/api/claims/${claimA}/stages`, "GET", manager);
  assert.equal(timeline.status, 200);
  assert.deepEqual(timeline.data.stages.map(({ step_type }) => step_type), ["quote_received"]);
  const proofUrl = `/api/claims/${claimA}/stages/${savedStep.data.stage.id}/evidence/${savedStep.data.stage.evidence.id}/content`;
  const content = await request(proofUrl, "GET", manager);
  assert.equal(content.status, 200);
  assert.deepEqual(content.data, pdf, "new evidence is retrieved from private Tigris storage");
  assert.equal((await request(`/api/claims/${claimB}/stages`, "GET", manager)).status, 404, "other tenant cannot access stages by guessed parent ID");
  assert.equal((await request(`/api/claims/${claimA}/stages`, "GET", foreignAdmin)).status, 404, "foreign tenant cannot access this claim");
  assert.equal((await request(`/api/claims/${claimA}/stages`, "GET", driver)).status, 403, "Drivers cannot access claim stages");
  assert.equal((await request(`/api/claims/${claimA}/stages`, "GET", fleet)).status, 200, "Fleet Manager can inspect stages");
  assert.equal((await request(`/api/claims/${claimA}/stages?tenantId=${tenantB}`, "GET", manager)).data.stages.length, 1, "query tenant tampering cannot redirect stage reads");
  assert.equal((await request(`/api/claims/${claimA}/stages`, "GET")).status, 401, "anonymous stage reads are denied");
  assert.equal((await request(`/api/claims/${claimA}/stages`, "POST", fleet, form)).status, 403, "Fleet Manager cannot create stages");
  assert.equal((await request(`/api/claims/${claimA}/stages`, "POST", driver, form)).status, 403, "Driver cannot create stages");
  assert.equal((await request(`/api/claims/${claimA}/stages/${savedStep.data.stage.id}/evidence/${savedStep.data.stage.evidence.id}/content`, "GET", driver)).status, 403, "Driver cannot open stage evidence");
  assert.equal((await request(`/api/claims/${claimA}/stages/${savedStep.data.stage.id}/evidence/${savedStep.data.stage.evidence.id}/content`, "GET")).status, 401, "anonymous evidence opens are denied");
  assert.equal((await request(`/api/claims/${claimA}/stages/${savedStep.data.stage.id}/evidence/${savedStep.data.stage.evidence.id}/content`, "GET", fleet)).status, 200, "Fleet Manager can read stage evidence");
  assert.equal((await request(`/api/claims/${claimB}/stages/${savedStep.data.stage.id}/evidence/${savedStep.data.stage.evidence.id}/content`, "GET", foreignAdmin)).status, 404, "evidence route checks claim, stage, and evidence parent IDs together");
  assert.equal((await request(`/api/claims/${claimToCancel}/stages/${savedStep.data.stage.id}/evidence/${savedStep.data.stage.evidence.id}/content`, "GET", manager)).status, 404, "same-tenant altered parent claim ID cannot open stage evidence");
  assert.equal((await request(`/api/claims/${claimA}/stages/${randomUUID()}/evidence/${savedStep.data.stage.evidence.id}/content`, "GET", manager)).status, 404, "altered stage ID cannot open another stage's evidence");
  assert.equal((await request(`/api/claims/${claimA}/stages`, "PATCH", manager, { status: "closed" })).status, 405, "stage history cannot be overwritten with an unscoped status patch");
  const persisted = await request(`/api/claims/${claimA}/stages`, "GET", await signIn(users[0]));
  assert.equal(persisted.status, 200);
  assert.equal(persisted.data.stages[0].evidence.file_name, "quote.pdf", "stage and evidence persist after a fresh sign-in");

  const optional = new FormData();
  optional.set("stepType", "expert_scheduled");
  optional.set("stepDate", "2026-09-26");
  optional.set("note", "x".repeat(2000));
  const noteBoundary = await request(`/api/claims/${claimA}/stages`, "POST", manager, optional);
  assert.equal(noteBoundary.status, 201, "2,000-character stage note is accepted without a file");
  assert.equal(noteBoundary.data.stage.evidence, null, "stage evidence is optional");

  const stageForm = ({ stepType = "repair_completed", stepDate = "2026-09-26", note = "boundary", fileName = "evidence.pdf", bytes = pdf, extra = [] } = {}) => {
    const body = new FormData();
    body.set("stepType", stepType);
    body.set("stepDate", stepDate);
    body.set("note", note);
    if (fileName !== null) body.append("evidence", new Blob([bytes], { type: "application/pdf" }), fileName);
    for (const [key, value] of extra) body.set(key, value);
    return body;
  };
  for (const [label, payload] of [
    ["unsupported file extension", stageForm({ fileName: "invoice.exe" })],
    ["extension and file-signature mismatch", stageForm({ fileName: "spoof.pdf", bytes: Buffer.from("not pdf") })],
    ["empty evidence file", stageForm({ bytes: Buffer.alloc(0) })],
    ["invalid calendar date", stageForm({ stepDate: "2026-02-30" })],
    ["timestamp instead of a date", stageForm({ stepDate: "2026-09-26T08:00:00Z" })],
    ["unsupported stage type", stageForm({ stepType: "payment_sent" })],
    ["oversized note", stageForm({ note: "x".repeat(2001) })],
    ["client-supplied parent", stageForm({ extra: [["claimId", claimB]] })],
    ["client-supplied tenant", stageForm({ extra: [["tenantId", tenantB]] })],
  ]) {
    assert.equal((await request(`/api/claims/${claimA}/stages`, "POST", manager, payload)).status, 400, `${label} is rejected`);
  }
  const overLimit = Buffer.alloc(maxTestUploadBytes + 1, 0x61);
  Buffer.from("%PDF-").copy(overLimit);
  const overLimitResponse = await request(`/api/claims/${claimA}/stages`, "POST", manager, stageForm({ bytes: overLimit }));
  assert.ok(isOversizedUploadRejected(overLimitResponse.status), `file above the configured test boundary is rejected (received ${overLimitResponse.status})`);
  const exactLimit = Buffer.alloc(maxTestUploadBytes, 0x61);
  Buffer.from("%PDF-").copy(exactLimit);
  const maxEvidence = await request(`/api/claims/${claimA}/stages`, "POST", manager, stageForm({ bytes: exactLimit }));
  assert.equal(maxEvidence.status, 201, "valid evidence at the maximum test upload size is accepted");

  const lifecycle = (claimId, action, reason) => request(`/api/claims/${claimId}/lifecycle`, "POST", manager, reason === undefined ? { action } : { action, reason });
  assert.equal((await lifecycle(claimA, "archive")).status, 409, "open claims cannot be archived");
  assert.equal((await lifecycle(claimA, "cancel", " ")).status, 400, "cancellation requires a nonblank reason");
  assert.equal((await lifecycle(claimA, "cancel", "x".repeat(1001))).status, 400, "cancellation reason is bounded");
  assert.equal((await lifecycle(claimA, "close")).status, 200, "Manager can close an open claim");
  const closed = await request(`/api/claims/${claimA}`, "GET", manager);
  assert.equal(closed.data.claim.status, "closed");
  assert.equal((await request(`/api/claims/${claimA}/stages`, "GET", manager)).data.stages.at(-1).step_type, "closed");
  assert.equal((await lifecycle(claimA, "close")).status, 409, "closed claims cannot be closed again");
  assert.equal((await request(`/api/claims/${claimA}/stages`, "POST", manager, optional)).status, 409, "closed claims reject new stages");
  const archived = await lifecycle(claimA, "archive");
  assert.equal(archived.status, 200);
  assert.equal(archived.data.status, "archived", "closed claim can be archived");
  const retained = await request(`/api/claims/${claimA}/stages`, "GET", manager);
  assert.ok(retained.data.stages.some((stage) => stage.id === savedStep.data.stage.id), "closure and archive retain previous stages");
  const retainedProof = await request(`/api/claims/${claimA}/stages/${savedStep.data.stage.id}/evidence/${savedStep.data.stage.evidence.id}/content`, "GET", manager);
  assert.deepEqual(retainedProof.data, pdf, "closure and archive retain access to earlier evidence");
  assert.equal((await lifecycle(claimA, "cancel", "cannot cancel now")).status, 409, "archived claims cannot be cancelled");

  assert.equal((await lifecycle(claimToCancel, "cancel")).status, 400, "cancellation reason is required");
  const priorStageForm = new FormData();
  priorStageForm.set("stepType", "garage_designated");
  priorStageForm.set("stepDate", "2026-09-25");
  priorStageForm.set("note", "Internal garage recorded before cancellation.");
  priorStageForm.append("evidence", new Blob([pdf], { type: "application/pdf" }), "garage-note.pdf");
  const priorStage = await request(`/api/claims/${claimToCancel}/stages`, "POST", manager, priorStageForm);
  assert.equal(priorStage.status, 201, "a claim can record stage history before cancellation");
  const cancelled = await lifecycle(claimToCancel, "cancel", "Duplicate claim entry.");
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.status, "cancelled");
  assert.equal(cancelled.data.stage.note, "Duplicate claim entry.", "cancellation reason stays in the timeline");
  assert.equal((await lifecycle(claimToCancel, "close")).status, 409, "cancelled claims cannot be closed");
  const cancelledTimeline = await request(`/api/claims/${claimToCancel}/stages`, "GET", manager);
  assert.ok(cancelledTimeline.data.stages.some((stage) => stage.id === priorStage.data.stage.id), "cancellation retains previous stages");
  assert.deepEqual((await request(`/api/claims/${claimToCancel}/stages/${priorStage.data.stage.id}/evidence/${priorStage.data.stage.evidence.id}/content`, "GET", manager)).data, pdf, "cancellation retains access to prior evidence");
  assert.ok(cancelledTimeline.data.stages.some((stage) => stage.step_type === "cancelled"));
  assert.equal((await lifecycle(claimB, "close")).status, 404, "foreign-tenant claim lifecycle is hidden");
  assert.equal((await request(`/api/claims/${claimA}/lifecycle`, "POST", fleet, { action: "close" })).status, 403, "Fleet Manager cannot change lifecycle state");
  assert.equal((await request(`/api/claims/${claimA}/lifecycle`, "POST", driver, { action: "close" })).status, 403, "Driver cannot change lifecycle state");
  assert.equal((await request(`/api/claims/${claimA}/lifecycle`, "POST", manager, { action: "cancel", reason: "bad", tenantId: tenantB })).status, 400, "lifecycle request cannot choose a tenant");

  process.stdout.write(`Claim-stage verification passed: dated timeline persistence; private evidence upload/open/download; ${maxTestUploadBytes / (1024 * 1024)} MiB test boundary, type, date, and note limits; close/archive/cancel retention; Manager/Fleet Manager/Driver rules; anonymous, cross-tenant, altered-parent, and altered-evidence denial.`);
} finally {
  const rows = await pool.query("SELECT storage_key FROM claim_stage_evidence WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => ({ rows: [] }));
  for (const row of rows.rows) await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.storage_key })).catch(() => undefined);
  await pool.query("DELETE FROM claim WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
  storage.destroy();
}
