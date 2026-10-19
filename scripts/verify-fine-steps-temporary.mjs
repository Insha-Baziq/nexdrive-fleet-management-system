import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { isOversizedUploadRejected, maxTestUploadBytes } from "./verify-upload-limits.mjs";

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "TIGRIS_BUCKET", "TIGRIS_ACCESS_KEY_ID", "TIGRIS_SECRET_ACCESS_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Local fine-step verification needs the app and private Tigris configuration (${missing.join(", ")}).`);

const origin = process.env.BETTER_AUTH_URL;
const requestTimeoutMs = Number(process.env.FINE_STEPS_VERIFY_REQUEST_TIMEOUT_MS || 180_000);
if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
  throw new Error("FINE_STEPS_VERIFY_REQUEST_TIMEOUT_MS must be a positive integer.");
}
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
  { key: "admin", role: "administrator", tenant: tenantA },
  { key: "fleet", role: "fleet_manager", tenant: tenantA },
  { key: "driver", role: "driver", tenant: tenantA },
  { key: "foreign_manager", role: "manager", tenant: tenantB },
].map((user) => ({ ...user, name: `Fine steps QA ${user.key}`, email: `fine-steps-${runId}-${user.key}@example.invalid` }));
const pdf = Buffer.from("%PDF-1.7\nNexDrive fine step evidence fixture\n%%EOF\n");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
const contentTypes = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeMinimalDocx() {
  const entries = [
    ["[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>"],
    ["word/document.xml", "<document xmlns=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>"],
  ];
  const localRecords = [], centralRecords = [];
  let localOffset = 0;
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name), data = Buffer.from(value), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const record = Buffer.concat([local, nameBytes, data]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(localOffset, 42);
    centralRecords.push(Buffer.concat([central, nameBytes]));
    localRecords.push(record);
    localOffset += record.length;
  }
  const directory = Buffer.concat(centralRecords), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, directory, end]);
}

async function request(path, method = "GET", cookie, body) {
  const isForm = body instanceof FormData;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(origin + path, {
      method,
      headers: Object.assign({}, cookie ? { cookie } : {}, body !== undefined && !isForm ? { "content-type": "application/json", origin } : {}),
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      redirect: "manual",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, data, response };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out after ${requestTimeoutMs} ms: ${method} ${path}`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function signIn(user) {
  const result = await request("/api/auth/sign-in/email", "POST", null, { email: user.email, password });
  assert.equal(result.status, 200, `${user.key} can sign in`);
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

async function makeFineForm(vehicleId, reference, fileName = "notice.pdf", bytes = pdf, extraFields = {}) {
  const form = new FormData();
  form.set("vehicleId", vehicleId);
  form.set("reference", reference);
  form.set("fineType", "company");
  form.set("infractionAt", "2026-09-25T10:30:00.000Z");
  form.set("paymentDeadline", "2026-10-25");
  form.set("description", "Fine-step verification fixture.");
  form.set("amount", "125.50");
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  form.append("evidence", new Blob([bytes], { type: contentTypes[extension] || "application/octet-stream" }), fileName);
  for (const [key, value] of Object.entries(extraFields)) form.set(key, value);
  return form;
}

function makeStepForm(stepType, overrides = {}) {
  const form = new FormData();
  form.set("stepType", stepType);
  form.set("stepDate", overrides.stepDate ?? "2026-09-29");
  if (overrides.note !== undefined) form.set("note", overrides.note);
  if (overrides.responsePositive !== undefined) form.set("responsePositive", overrides.responsePositive);
  if (overrides.designatedDriverId !== undefined) form.set("designatedDriverId", overrides.designatedDriverId);
  if (overrides.evidence !== null) {
    const fileName = overrides.fileName ?? "proof.pdf";
    const bytes = overrides.evidence ?? pdf;
    const extension = fileName.split(".").at(-1)?.toLowerCase();
    form.append("evidence", new Blob([bytes], { type: contentTypes[extension] || "application/octet-stream" }), fileName);
  }
  for (const [key, value] of Object.entries(overrides.extraFields ?? {})) form.set(key, value);
  return form;
}

let vehicleA, vehicleB, driverA, driverB;
const fineIds = [];
try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Temporary Fine Steps QA A'), ($2, 'Temporary Fine Steps QA B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2, "emailVerified"=true WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = saved.rows[0].id;
  }
  const [manager, admin, fleet, driver, foreignManager] = await Promise.all(users.map(signIn));
  vehicleA = randomUUID(); vehicleB = randomUUID(); driverA = randomUUID(); driverB = randomUUID();
  await pool.query(
    `INSERT INTO vehicle (id, tenant_id, registration, make, model, current_mileage)
     VALUES ($1, $2, $3, 'Renault', 'Clio', NULL), ($4, $5, $6, 'Peugeot', '208', NULL)`,
    [vehicleA, tenantA, `FSA-${runId.slice(0, 6)}-AA`, vehicleB, tenantB, `FSB-${runId.slice(0, 6)}-AA`],
  );
  await pool.query(
    `INSERT INTO driver (id, tenant_id, full_name) VALUES ($1, $2, 'Local Driver A'), ($3, $4, 'Foreign Driver B')`,
    [driverA, tenantA, driverB, tenantB],
  );

  assert.equal((await request(`/api/fines/${randomUUID()}/steps`)).status, 401, "fine-step list requires sign in");
  assert.equal((await request(`/api/fines/${randomUUID()}/steps`, "POST", null, makeStepForm("payment"))).status, 401, "fine-step write requires sign in");

  const createdA = await request("/api/fines", "POST", manager, await makeFineForm(vehicleA, `FSA-${runId.slice(0, 8)}`));
  assert.equal(createdA.status, 201, "Manager can create the parent fine");
  const fineA = createdA.data.fine;
  fineIds.push(fineA.id);
  const createdB = await request("/api/fines", "POST", foreignManager, await makeFineForm(vehicleB, `FSB-${runId.slice(0, 8)}`));
  assert.equal(createdB.status, 201, "temporary second-tenant fixture fine created");
  const fineB = createdB.data.fine;
  fineIds.push(fineB.id);

  const initial = await request(`/api/fines/${fineA.id}/steps`, "GET", manager);
  assert.equal(initial.status, 200);
  assert.equal(initial.data.steps.length, 1, "initial fine evidence appears as the Received history row");
  assert.equal(initial.data.steps[0].step_type, "received");
  assert.equal(initial.data.steps[0].evidence.id, fineA.evidence.id);
  assert.equal(initial.data.steps[0].evidence.source, "fine");
  assert.equal(JSON.stringify(initial.data).includes("storage_key"), false, "timeline API never exposes private storage keys");

  assert.equal((await request(`/api/fines/${fineA.id}/steps`, "GET", admin)).status, 200, "Administrator may read the fine timeline");
  assert.equal((await request(`/api/fines/${fineA.id}/steps`, "GET", fleet)).status, 200, "Fleet Manager may read the fine timeline");
  assert.equal((await request(`/api/fines/${fineA.id}/steps`, "GET", driver)).status, 403, "Driver cannot read organization fine steps");
  assert.equal((await request(`/api/fines/${fineA.id}/steps`, "POST", admin, makeStepForm("payment"))).status, 403, "Administrator is not a ticket 25 writer");
  assert.equal((await request(`/api/fines/${fineA.id}/steps`, "POST", fleet, makeStepForm("payment"))).status, 403, "Fleet Manager is read-only");
  assert.equal((await request(`/api/fines/${fineA.id}/steps`, "POST", driver, makeStepForm("payment"))).status, 403, "Driver cannot write fine steps");
  assert.equal((await request(`/api/fines/${fineB.id}/steps`, "GET", manager)).status, 404, "another tenant cannot read a guessed fine");
  assert.equal((await request(`/api/fines/${fineB.id}/steps`, "POST", manager, makeStepForm("payment"))).status, 404, "another tenant cannot write to a guessed parent fine");
  assert.equal((await request(`/api/fines/not-a-uuid/steps`, "GET", manager)).status, 404, "malformed parent IDs are hidden");

  for (const [label, type, overrides] of [
    ["unsupported step", "received", {}],
    ["missing required proof", "contestation", { evidence: null }],
    ["unsupported extension", "payment", { fileName: "proof.exe" }],
    ["mismatched file signature", "contestation", { fileName: "bad.pdf", evidence: png }],
    ["empty file", "payment", { fileName: "empty.pdf", evidence: Buffer.alloc(0) }],
    ["oversized proof", "payment", { fileName: "large.pdf", evidence: Buffer.alloc(15 * 1024 * 1024 + 1, 65) }],
    ["invalid calendar date", "contestation", { stepDate: "2026-02-30" }],
    ["timestamp in date-only field", "payment", { stepDate: "2026-09-29T10:00:00Z" }],
    ["note over 2,000 characters", "contestation", { note: "n".repeat(2001) }],
    ["control characters in note", "contestation", { note: "line\u0007bell" }],
    ["designation without driver", "designation", {}],
    ["designation with malformed driver", "designation", { designatedDriverId: "driver-1" }],
    ["response without outcome", "response", {}],
    ["response with invalid outcome", "response", { responsePositive: "maybe" }],
    ["non-response with outcome", "payment", { responsePositive: "true" }],
    ["non-designation with driver", "contestation", { designatedDriverId: driverA }],
    ["client tenant spoof", "payment", { extraFields: { tenantId: tenantB } }],
  ]) {
    const invalid = await request(`/api/fines/${fineA.id}/steps`, "POST", manager, makeStepForm(type, overrides));
    if (label === "oversized proof") assert.ok(isOversizedUploadRejected(invalid.status), `${label} is rejected (received ${invalid.status})`);
    else assert.equal(invalid.status, 400, `${label} is rejected (received ${invalid.status})`);
  }
  const foreignDesignation = await request(`/api/fines/${fineA.id}/steps`, "POST", manager,
    makeStepForm("designation", { designatedDriverId: driverB }));
  assert.equal(foreignDesignation.status, 404, "designation with another tenant driver is rejected without exposing the foreign record");

  const allowedFiles = [["allowed.png", png], ["allowed.jpg", jpeg], ["allowed.jpeg", jpeg], ["allowed.docx", makeMinimalDocx()]];
  for (let index = 0; index < allowedFiles.length; index++) {
    const [fileName, bytes] = allowedFiles[index];
    const result = await request(`/api/fines/${fineA.id}/steps`, "POST", manager, makeStepForm("contestation", {
      stepDate: `2026-10-${String(4 + index).padStart(2, "0")}`,
      fileName,
      evidence: bytes,
    }));
    assert.equal(result.status, 201, `${fileName} proof is accepted with verified content`);
  }

  const maximumBytes = Buffer.alloc(maxTestUploadBytes, 0x41);
  pdf.copy(maximumBytes);
  const maximum = await request(`/api/fines/${fineA.id}/steps`, "POST", manager, makeStepForm("contestation", {
    stepDate: "2026-10-08", note: "m".repeat(2000), fileName: "maximum.pdf", evidence: maximumBytes,
  }));
  assert.equal(maximum.status, 201, "the maximum test evidence upload and a 2,000 character note are accepted");
  assert.equal(maximum.data.step.evidence.file_name, "maximum.pdf");
  assert.equal(Number(maximum.data.step.evidence.file_size), maxTestUploadBytes, "the maximum evidence size is persisted in the response metadata");

  const designation = await request(`/api/fines/${fineA.id}/steps`, "POST", manager, makeStepForm("designation", {
    stepDate: "2026-10-01", note: "Driver selected from this organization.", designatedDriverId: driverA, fileName: "designation.pdf", evidence: pdf,
  }));
  assert.equal(designation.status, 201, "Manager records a dated designation with driver and private proof");
  assert.equal(designation.data.step.step_type, "designation");
  assert.equal(designation.data.step.designated_driver_id, driverA);
  assert.equal(designation.data.step.designated_driver_name, "Local Driver A");
  assert.equal(designation.data.step.evidence.file_name, "designation.pdf");
  assert.equal(designation.data.step.evidence.source, "step");

  const responseNegative = await request(`/api/fines/${fineA.id}/steps`, "POST", manager, makeStepForm("response", {
    stepDate: "2026-10-02", responsePositive: "false", note: "Negative response recorded.", fileName: "response.pdf", evidence: pdf,
  }));
  assert.equal(responseNegative.status, 201, "negative response is stored");
  assert.equal(responseNegative.data.step.response_positive, false);
  const responsePositive = await request(`/api/fines/${fineA.id}/steps`, "POST", manager, makeStepForm("response", {
    stepDate: "2026-10-02", responsePositive: "true", fileName: "response-positive.pdf", evidence: pdf,
  }));
  assert.equal(responsePositive.status, 201, "positive response is stored");
  assert.equal(responsePositive.data.step.response_positive, true);

  const payment = await request(`/api/fines/${fineA.id}/steps`, "POST", manager, makeStepForm("payment", {
    stepDate: "2026-10-03", note: "Paid manually outside NexDrive.", fileName: "payment-proof.pdf", evidence: pdf,
  }));
  assert.equal(payment.status, 201, "payment is recorded manually with private proof");

  const steps = await request(`/api/fines/${fineA.id}/steps`, "GET", manager);
  assert.equal(steps.status, 200);
  const received = steps.data.steps.find((step) => step.step_type === "received");
  assert.ok(received, "original fine evidence remains visible in the history");
  assert.equal(received.evidence.id, fineA.evidence.id);
  assert.equal(received.evidence.source, "fine");
  assert.deepEqual(steps.data.steps.map((step) => step.step_date), [...steps.data.steps.map((step) => step.step_date)].sort(), "history is ordered by event date");
  assert.ok(steps.data.steps.some((step) => step.step_type === "designation" && step.designated_driver_name === "Local Driver A"));
  assert.ok(steps.data.steps.some((step) => step.step_type === "response" && step.response_positive === false));
  assert.ok(steps.data.steps.some((step) => step.step_type === "response" && step.response_positive === true));
  assert.ok(steps.data.steps.some((step) => step.step_type === "payment"));
  assert.ok(steps.data.steps.some((step) => step.step_type === "contestation" && step.note === "m".repeat(2000)));

  const proof = payment.data.step.evidence;
  const proofBase = `/api/fines/${fineA.id}/steps/${payment.data.step.id}/evidence/${proof.id}/content`;
  const opened = await request(proofBase, "GET", manager);
  assert.equal(opened.status, 200, "Manager can open step proof");
  assert.deepEqual(opened.data, pdf, "authorized retrieval returns the uploaded private bytes");
  assert.equal(opened.response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.match(opened.response.headers.get("content-disposition"), /^inline;/);
  const downloaded = await request(`${proofBase}?download=1`, "GET", fleet);
  assert.equal(downloaded.status, 200, "Fleet Manager can download proof");
  assert.deepEqual(downloaded.data, pdf);
  assert.match(downloaded.response.headers.get("content-disposition"), /^attachment;/);
  assert.equal((await request(proofBase, "GET", admin)).status, 200, "Administrator may read proof");
  assert.equal((await request(proofBase, "GET", driver)).status, 403, "Driver cannot retrieve proof");
  assert.equal((await request(proofBase)).status, 401, "anonymous proof retrieval is denied");
  assert.equal((await request(`/api/fines/${randomUUID()}/steps/${payment.data.step.id}/evidence/${proof.id}/content`, "GET", manager)).status, 404, "altered parent fine ID is denied");
  assert.equal((await request(`/api/fines/${fineA.id}/steps/${randomUUID()}/evidence/${proof.id}/content`, "GET", manager)).status, 404, "altered event ID is denied");
  assert.equal((await request(`/api/fines/${fineA.id}/steps/${payment.data.step.id}/evidence/${randomUUID()}/content`, "GET", manager)).status, 404, "altered proof ID is denied");
  assert.equal((await request(`${proofBase}?tenantId=${tenantB}`, "GET", foreignManager)).status, 404, "query tenant spoof cannot redirect proof lookup");
  assert.equal((await request(`/api/fines/${fineA.id}/steps/${payment.data.step.id}/evidence/${proof.id}/content`, "GET", foreignManager)).status, 404, "cross-tenant Manager cannot retrieve proof");
  assert.equal((await request(`/api/fines/${fineB.id}/steps/${payment.data.step.id}/evidence/${proof.id}/content`, "GET", manager)).status, 404, "proof cannot be attached to an altered fine parent");

  const freshManager = await signIn(users[0]);
  const persisted = await request(`/api/fines/${fineA.id}/steps`, "GET", freshManager);
  assert.equal(persisted.status, 200, "timeline persists after a new sign-in");
  assert.equal(persisted.data.steps.length, steps.data.steps.length);
  const persistedMaximum = persisted.data.steps.find((step) => step.id === maximum.data.step.id);
  assert.ok(persistedMaximum, "maximum-size evidence persists in the timeline");
  assert.equal(Number(persistedMaximum.evidence.file_size), maxTestUploadBytes, "maximum evidence size persists after fresh sign-in");
  assert.equal((await request(proofBase, "GET", freshManager)).status, 200, "private evidence persists across sign-in");
  assert.equal((await request(`/api/fines/${fineA.id}`, "GET", freshManager)).data.fine.status, "open", "payment entry does not change the base fine status or initiate payment");

  for (const step of persisted.data.steps.filter((item) => item.evidence.source === "step" && item.evidence.id !== maximum.data.step.evidence.id)) {
    const stepProof = await request(`/api/fines/${fineA.id}/steps/${step.id}/evidence/${step.evidence.id}/content`, "GET", freshManager);
    assert.equal(stepProof.status, 200, `${step.step_type} proof persists after fresh sign-in`);
    assert.equal(stepProof.data.length, Number(step.evidence.file_size));
  }
  const receivedProof = await request(`/api/fines/${fineA.id}/evidence/${fineA.evidence.id}/content`, "GET", freshManager);
  assert.equal(receivedProof.status, 200, "Received history row links to the original fine proof");
  const paidHtml = await request(`/fines/${fineA.id}`, "GET", freshManager);
  assert.ok(/(?:Current status|Statut actuel)[\s\S]{0,250}(?:Paid|Payée)/.test(paidHtml.data.toString()), "timeline shows the derived Paid status");
  assert.match(paidHtml.data.toString(), /Negative response|Réponse négative/);
  assert.match(paidHtml.data.toString(), /Designated driver: Local Driver A|Conducteur désigné : Local Driver A/);

  const databaseRows = await pool.query(
    `SELECT s.step_type, s.step_date::text, s.note, s.response_positive, s.designated_driver_id::text,
       s.proof_document_id::text, s.actor_user_id, e.tenant_id, e.fine_id::text, e.step_id::text,
       e.storage_key, e.file_name, e.file_extension, e.content_type, e.file_size::text
     FROM fine_steps s JOIN fine_step_evidence e
       ON e.id = s.proof_document_id AND e.tenant_id = s.tenant_id AND e.fine_id = s.fine_id AND e.step_id = s.id
     WHERE s.tenant_id = $1 AND s.fine_id = $2 ORDER BY s.step_date, s.created_at, s.id`,
    [tenantA, fineA.id],
  );
  assert.ok(databaseRows.rows.length >= 8, "all user-entered steps have a relational proof row");
  assert.ok(databaseRows.rows.every((row) => row.tenant_id === tenantA && row.fine_id === fineA.id && row.actor_user_id === users[0].id));
  assert.ok(databaseRows.rows.every((row) => row.storage_key.startsWith("fine-step-evidence/")));
  assert.equal(Number(databaseRows.rows.find((row) => row.file_name === "maximum.pdf")?.file_size), maxTestUploadBytes,
    "database metadata retains the inclusive maximum evidence size");
  assert.equal(databaseRows.rows.find((row) => row.step_type === "designation")?.designated_driver_id, driverA);
  assert.equal(databaseRows.rows.find((row) => row.step_type === "payment")?.response_positive, null);

  const invalidIdentity = await request(`/api/fines/${fineA.id}/steps`, "POST", manager, makeStepForm("payment", { extraFields: { fineId: fineB.id, actorUserId: users[1].id } }));
  assert.equal(invalidIdentity.status, 400, "client cannot select another parent or actor");
  const cancelled = await request(`/api/fines/${fineA.id}`, "PATCH", manager, { status: "cancelled" });
  assert.equal(cancelled.status, 200, "existing cancellation state remains available");
  const afterCancel = await request(`/api/fines/${fineA.id}/steps`, "GET", fleet);
  assert.equal(afterCancel.status, 200);
  assert.equal(afterCancel.data.steps.length, persisted.data.steps.length, "cancellation does not hide earlier events");
  assert.equal((await request(`/api/fines/${fineA.id}/steps`, "POST", manager, makeStepForm("contestation"))).status, 409, "cancelled fine remains read-only");
  const html = await request(`/fines/${fineA.id}`, "GET", freshManager);
  assert.equal(html.status, 200);
  assert.match(html.data.toString(), /Fine dossier timeline|Historique de l.amende/);
  assert.match(html.data.toString(), /Cancelled|Annulée/);
  assert.match(html.data.toString(), /Designation|Désignation/);

  process.stdout.write("Fine-step verification passed: Manager-only dated steps; required private proof; designation and positive/negative response data; ordered persistence after re-sign-in; authorized Fleet read; private Tigris open/download; tenant, role, parent/event/file ID, and driver-reference denial; upload/type/date/note boundaries; and retained cancelled history with no transaction or submission.\n");
} finally {
  const files = await pool.query(
    `SELECT storage_key FROM fine_evidence WHERE tenant_id = ANY($1::text[])
     UNION ALL
     SELECT storage_key FROM fine_step_evidence WHERE tenant_id = ANY($1::text[])`,
    [tenants],
  ).catch(() => ({ rows: [] }));
  for (const row of files.rows) await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.storage_key })).catch(() => undefined);
  await pool.query("DELETE FROM fine_steps WHERE tenant_id=ANY($1::text[])", [tenants]);
  await pool.query("DELETE FROM fine_step_evidence WHERE tenant_id=ANY($1::text[])", [tenants]);
  await pool.query("DELETE FROM fine_evidence WHERE tenant_id=ANY($1::text[])", [tenants]);
  await pool.query("DELETE FROM fine WHERE tenant_id=ANY($1::text[])", [tenants]);
  await pool.query("DELETE FROM driver WHERE tenant_id=ANY($1::text[])", [tenants]);
  await pool.query("DELETE FROM vehicle WHERE tenant_id=ANY($1::text[])", [tenants]);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]);
  await pool.query("DELETE FROM tenant WHERE id=ANY($1::text[])", [tenants]);
  await pool.end();
  storage.destroy();
}
