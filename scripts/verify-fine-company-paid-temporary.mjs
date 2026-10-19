import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { isOversizedUploadRejected, maxTestUploadBytes } from "./verify-upload-limits.mjs";

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "TIGRIS_BUCKET", "TIGRIS_ACCESS_KEY_ID", "TIGRIS_SECRET_ACCESS_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Local company-paid marker verification needs the app and private Tigris configuration (${missing.join(", ")}).`);

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
  { key: "admin", role: "administrator", tenant: tenantA },
  { key: "fleet", role: "fleet_manager", tenant: tenantA },
  { key: "driver", role: "driver", tenant: tenantA },
  { key: "foreign_manager", role: "manager", tenant: tenantB },
].map((user) => ({ ...user, name: `Company-paid QA ${user.key}`, email: `company-paid-${runId}-${user.key}@example.invalid` }));
const pdf = Buffer.from("%PDF-1.7\nNexDrive company-paid marker evidence fixture\n%%EOF\n");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const types = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

async function request(path, method = "GET", cookie, body) {
  const isForm = body instanceof FormData;
  const response = await fetch(origin + path, {
    method,
    headers: Object.assign({}, cookie ? { cookie } : {}, body !== undefined && !isForm ? { "content-type": "application/json", origin } : {}),
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    redirect: "manual",
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, data, response };
}

async function signIn(user) {
  const result = await request("/api/auth/sign-in/email", "POST", null, { email: user.email, password });
  assert.equal(result.status, 200, `${user.key} can sign in`);
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

function fineForm(vehicleId, reference, fineType = "driver") {
  const form = new FormData();
  form.set("vehicleId", vehicleId);
  form.set("reference", reference);
  form.set("fineType", fineType);
  form.set("infractionAt", "2026-09-25T10:30:00.000Z");
  form.set("paymentDeadline", "2026-10-25");
  form.set("description", "Ticket 26 temporary verification record.");
  form.set("amount", "125.50");
  form.append("evidence", new Blob([pdf], { type: "application/pdf" }), "notice.pdf");
  return form;
}

function designationForm(driverId) {
  const form = new FormData();
  form.set("stepType", "designation");
  form.set("stepDate", "2026-09-26");
  form.set("designatedDriverId", driverId);
  form.append("evidence", new Blob([pdf], { type: "application/pdf" }), "designation.pdf");
  return form;
}

function markerForm(context = "Company account debit recorded on 18 Sep 2026; bank reference FIN-8042.", fileName = "bank-record.pdf", bytes = pdf) {
  const form = new FormData();
  form.set("context", context);
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  form.append("evidence", new Blob([bytes], { type: types[extension] || "application/octet-stream" }), fileName);
  return form;
}

let vehicleA, vehicleB, driverA, driverB;
const fineIds = [];
try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, $3), ($2, $4)", [tenantA, tenantB, `Temporary Company Paid QA A ${runId}`, `Temporary Company Paid QA B ${runId}`]);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2 WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = saved.rows[0].id;
  }
  const [manager, admin, fleet, driver, foreignManager] = await Promise.all(users.map(signIn));
  vehicleA = randomUUID(); vehicleB = randomUUID(); driverA = randomUUID(); driverB = randomUUID();
  await pool.query(
    `INSERT INTO vehicle (id, tenant_id, registration, make, model, current_mileage)
     VALUES ($1, $2, $3, 'Renault', 'Clio', NULL), ($4, $5, $6, 'Peugeot', '208', NULL)`,
    [vehicleA, tenantA, `CPA-${runId.slice(0, 6)}-AA`, vehicleB, tenantB, `CPB-${runId.slice(0, 6)}-AA`],
  );
  await pool.query(
    `INSERT INTO driver (id, tenant_id, full_name) VALUES ($1, $2, 'Local Driver A'), ($3, $4, 'Foreign Driver B')`,
    [driverA, tenantA, driverB, tenantB],
  );

  const createFine = async (cookie, vehicleId, fineType = "driver") => {
    const response = await request("/api/fines", "POST", cookie, fineForm(vehicleId, `CP-${randomUUID().slice(0, 8)}`, fineType));
    assert.equal(response.status, 201, "parent fine is created for the test");
    fineIds.push(response.data.fine.id);
    return response.data.fine;
  };
  const addDesignation = async (cookie, fine, driverId) => {
    const response = await request(`/api/fines/${fine.id}/steps`, "POST", cookie, designationForm(driverId));
    assert.equal(response.status, 201, "designation fixture is created");
    return response.data.step;
  };

  assert.equal((await request(`/api/fines/${randomUUID()}/company-paid`, "GET")).status, 401, "marker read requires sign in");
  assert.equal((await request(`/api/fines/${randomUUID()}/company-paid`, "POST", null, markerForm())).status, 401, "marker write requires sign in");

  const notDesignated = await createFine(manager, vehicleA);
  assert.deepEqual(await request(`/api/fines/${notDesignated.id}/company-paid`, "GET", manager).then((result) => result.data), { marker: null, canRecord: false });
  assert.equal((await request(`/api/fines/${notDesignated.id}/company-paid`, "POST", manager, markerForm())).status, 409, "driver fine is ineligible until a designation is recorded");

  const eligible = await createFine(manager, vehicleA);
  await addDesignation(manager, eligible, driverA);
  const companyFine = await createFine(manager, vehicleA, "company");
  await addDesignation(manager, companyFine, driverA);
  assert.equal((await request(`/api/fines/${companyFine.id}/company-paid`, "POST", manager, markerForm())).status, 409, "company-type fine is ineligible despite any designation");
  const cancelledFine = await createFine(manager, vehicleA);
  await addDesignation(manager, cancelledFine, driverA);
  assert.equal((await request(`/api/fines/${cancelledFine.id}`, "PATCH", manager, { status: "cancelled" })).status, 200, "cancelled-state fixture is set");
  assert.equal((await request(`/api/fines/${cancelledFine.id}/company-paid`, "POST", manager, markerForm())).status, 409, "cancelled fine is ineligible");

  assert.deepEqual(await request(`/api/fines/${eligible.id}/company-paid`, "GET", manager).then((result) => result.data), { marker: null, canRecord: true }, "Manager sees the eligible action after designation");
  for (const [cookie, label] of [[admin, "Administrator"], [fleet, "Fleet Manager"], [driver, "Driver"]]) {
    assert.equal((await request(`/api/fines/${eligible.id}/company-paid`, "POST", cookie, markerForm())).status, 403, `${label} cannot create this marker`);
  }
  assert.equal((await request(`/api/fines/${eligible.id}/company-paid`, "GET", driver)).status, 403, "Driver cannot read organization marker data");
  assert.equal((await request(`/api/fines/not-a-uuid/company-paid`, "GET", manager)).status, 404, "malformed fine IDs are hidden");

  for (const [label, form] of [
    ["missing context", markerForm("   ")],
    ["context above 2,000 characters", markerForm("x".repeat(2001))],
    ["control character in context", markerForm("context\u0007bell")],
    ["missing required proof", (() => { const value = new FormData(); value.set("context", "Required context."); return value; })()],
    ["unsupported extension", markerForm("Required context.", "bank.exe")],
    ["mismatched signature", markerForm("Required context.", "not-a-pdf.pdf", png)],
    ["empty proof", markerForm("Required context.", "empty.pdf", Buffer.alloc(0))],
    ["proof over configured test boundary", markerForm("Required context.", "too-large.pdf", Buffer.alloc(maxTestUploadBytes + 1, 65))],
  ]) {
    const invalid = await request(`/api/fines/${eligible.id}/company-paid`, "POST", manager, form);
    if (label === "proof over configured test boundary") assert.ok(isOversizedUploadRejected(invalid.status), `${label} is rejected (received ${invalid.status})`);
    else assert.equal(invalid.status, 400, `${label} is rejected (received ${invalid.status})`);
  }
  const duplicateContext = markerForm(); duplicateContext.append("context", "duplicate");
  assert.equal((await request(`/api/fines/${eligible.id}/company-paid`, "POST", manager, duplicateContext)).status, 400, "duplicate form fields are rejected");
  const spoof = markerForm(); spoof.set("fineId", fineIds.at(-1)); spoof.set("tenantId", tenantB); spoof.set("recordedByUserId", users[1].id);
  assert.equal((await request(`/api/fines/${eligible.id}/company-paid`, "POST", manager, spoof)).status, 400, "request cannot supply tenant, parent, or actor identity");

  const saved = await request(`/api/fines/${eligible.id}/company-paid`, "POST", manager, markerForm());
  assert.equal(saved.status, 201, "Manager can record an eligible marker with context and proof");
  const marker = saved.data.marker;
  assert.equal(marker.context, "Company account debit recorded on 18 Sep 2026; bank reference FIN-8042.");
  assert.equal(marker.evidence.file_name, "bank-record.pdf");
  assert.equal(JSON.stringify(saved.data).includes("storage_key"), false, "the API does not expose private storage keys");
  assert.equal((await request(`/api/fines/${eligible.id}/company-paid`, "POST", manager, markerForm())).status, 409, "a fine can receive only one marker");
  assert.deepEqual(await request(`/api/fines/${eligible.id}/company-paid`, "GET", fleet).then((result) => result.data.marker), marker, "Fleet Manager may read saved marker metadata");
  assert.equal((await request(`/api/fines/${eligible.id}/company-paid`, "GET", admin)).status, 200, "Administrator can read the marker");
  assert.equal((await request(`/api/fines/${eligible.id}/company-paid`, "GET", manager).then((result) => result.data.canRecord)), false, "recorded marker hides the action");

  const proofPath = `/api/fines/${eligible.id}/company-paid/evidence/${marker.evidence.id}/content`;
  const opened = await request(proofPath, "GET", manager);
  assert.equal(opened.status, 200, "Manager may open private proof");
  assert.deepEqual(opened.data, pdf, "authorized open returns the original private bytes");
  assert.equal(opened.response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.match(opened.response.headers.get("content-disposition"), /^inline;/);
  const downloaded = await request(`${proofPath}?download=1`, "GET", fleet);
  assert.equal(downloaded.status, 200, "Fleet Manager may download private proof");
  assert.deepEqual(downloaded.data, pdf);
  assert.match(downloaded.response.headers.get("content-disposition"), /^attachment;/);
  assert.equal((await request(proofPath, "GET", admin)).status, 200, "Administrator can read private proof");
  assert.equal((await request(proofPath, "GET", driver)).status, 403, "Driver cannot open fine marker proof");
  assert.equal((await request(proofPath)).status, 401, "anonymous proof retrieval is denied");
  assert.equal((await request(`/api/fines/${fineIds.at(-1)}/company-paid/evidence/${marker.evidence.id}/content`, "GET", manager)).status, 404, "altered parent fine ID cannot retrieve proof");
  assert.equal((await request(`/api/fines/${eligible.id}/company-paid/evidence/${randomUUID()}/content`, "GET", manager)).status, 404, "altered proof ID is denied");
  assert.equal((await request(`/api/fines/${eligible.id}/company-paid/evidence/${marker.evidence.id}/content`, "GET", foreignManager)).status, 404, "cross-tenant Manager cannot retrieve private proof");
  assert.equal((await request(`/api/fines/${eligible.id}/company-paid`, "GET", foreignManager)).status, 404, "cross-tenant Manager cannot read marker metadata");
  assert.equal((await request(`/api/fines/${eligible.id}/company-paid`, "POST", foreignManager, markerForm())).status, 404, "cross-tenant Manager cannot write to a guessed fine");

  const foreignFine = await createFine(foreignManager, vehicleB);
  await addDesignation(foreignManager, foreignFine, driverB);
  const foreignMarker = await request(`/api/fines/${foreignFine.id}/company-paid`, "POST", foreignManager, markerForm("Other tenant record.", "foreign.pdf"));
  assert.equal(foreignMarker.status, 201, "second tenant gets an independent marker fixture");
  const foreignProofPath = `/api/fines/${foreignFine.id}/company-paid/evidence/${foreignMarker.data.marker.evidence.id}/content`;
  assert.equal((await request(`/api/fines/${foreignFine.id}/company-paid`, "GET", manager)).status, 404, "tenant A cannot read another tenant marker by ID");
  assert.equal((await request(`/api/fines/${foreignFine.id}/company-paid`, "POST", manager, markerForm())).status, 404, "tenant A cannot add a marker to another tenant fine");
  assert.equal((await request(foreignProofPath, "GET", manager)).status, 404, "tenant A cannot open another tenant proof");

  const freshManager = await signIn(users[0]);
  const persisted = await request(`/api/fines/${eligible.id}/company-paid`, "GET", freshManager);
  assert.equal(persisted.status, 200, "marker metadata persists after a fresh sign-in");
  assert.deepEqual(persisted.data.marker, marker);
  assert.equal((await request(proofPath, "GET", freshManager)).status, 200, "private proof persists across sign-in");
  const html = await request(`/fines/${eligible.id}`, "GET", freshManager);
  assert.equal(html.status, 200);
  assert.match(html.data.toString(), /Company paid despite designation|Paiement par l.entreprise malgré la désignation/);
  assert.match(html.data.toString(), /Manually recorded for internal reference|Saisie manuelle à titre de référence interne/);
  assert.match(html.data.toString(), /does not process or confirm payment|ne traite ni ne confirme les paiements/);
  assert.match(html.data.toString(), /not a legal conclusion|ne constitue pas une conclusion juridique/);
  assert.match(html.data.toString(), /Company account debit recorded on 18 Sep 2026; bank reference FIN-8042\./);
  assert.match(html.data.toString(), /bank-record\.pdf/);
  assert.match(html.data.toString(), /Designated driver: Local Driver A|Conducteur désigné : Local Driver A/);
  assert.equal(html.data.toString().includes("Record marker"), false, "existing marker cannot be submitted twice from UI");

  const row = await pool.query(
    `SELECT m.tenant_id, m.fine_id::text, m.context, m.recorded_by_user_id,
       e.storage_key, e.file_name, e.file_extension, e.content_type, e.file_size::text
     FROM fine_company_paid_markers m JOIN fine_company_paid_marker_evidence e
       ON e.id = m.proof_document_id AND e.tenant_id = m.tenant_id AND e.fine_id = m.fine_id AND e.marker_id = m.id
     WHERE m.id = $1`,
    [marker.id],
  );
  assert.equal(row.rows.length, 1);
  assert.equal(row.rows[0].tenant_id, tenantA);
  assert.equal(row.rows[0].fine_id, eligible.id);
  assert.equal(row.rows[0].context, marker.context);
  assert.equal(row.rows[0].recorded_by_user_id, users[0].id);
  assert.ok(row.rows[0].storage_key.startsWith("fine-company-paid-evidence/"));
  assert.equal(row.rows[0].file_name, "bank-record.pdf");

  const boundaryFine = await createFine(manager, vehicleA);
  await addDesignation(manager, boundaryFine, driverA);
  const maxBytes = Buffer.alloc(maxTestUploadBytes, 0x41);
  pdf.copy(maxBytes);
  const maxSaved = await request(`/api/fines/${boundaryFine.id}/company-paid`, "POST", manager, markerForm("x".repeat(2000), "maximum.pdf", maxBytes));
  assert.equal(maxSaved.status, 201, "2,000 context characters and the maximum test proof upload are accepted");
  assert.equal(maxSaved.data.marker.context.length, 2000);

  const htmlFleet = await request(`/fines/${eligible.id}`, "GET", fleet);
  assert.equal(htmlFleet.status, 200, "Fleet Manager can see the fine dossier");
  assert.match(htmlFleet.data.toString(), /Company paid despite designation|Paiement par l.entreprise malgré la désignation/);
  assert.match(htmlFleet.data.toString(), /bank-record\.pdf/);
  assert.equal(htmlFleet.data.toString().includes("Record marker"), false, "Fleet Manager has no write action");

  process.stdout.write(`Ticket 26 verifier passed: Manager-only marker after driver-fine designation; cancelled, company-type, and undesignated fine denial; context/private proof persistence; Fleet read; authorized Tigris open/download; tenant, role, altered-parent/proof, and driver denial; required fields, 2,000 character/${maxTestUploadBytes / (1024 * 1024)} MiB test boundary, signature/type and oversized-file rejection; internal-only/no-payment/no-legal-conclusion UI; and fixture cleanup.\n`);
} finally {
  const files = await pool.query(
    `SELECT storage_key FROM fine_evidence WHERE tenant_id = ANY($1::text[])
     UNION ALL SELECT storage_key FROM fine_step_evidence WHERE tenant_id = ANY($1::text[])
     UNION ALL SELECT storage_key FROM fine_company_paid_marker_evidence WHERE tenant_id = ANY($1::text[])`,
    [tenants],
  ).catch(() => ({ rows: [] }));
  for (const row of files.rows) await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.storage_key })).catch(() => undefined);
  await pool.query("DELETE FROM fine WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM driver WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
  storage.destroy();
}
