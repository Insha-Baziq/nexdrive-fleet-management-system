import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { isOversizedUploadRejected, maxTestUploadBytes } from "./verify-upload-limits.mjs";

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "TIGRIS_BUCKET", "TIGRIS_ACCESS_KEY_ID", "TIGRIS_SECRET_ACCESS_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Local claim verification needs the app and private Tigris configuration (${missing.join(", ")}).`);

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
  { key: "admin", role: "administrator", tenant: tenantA },
  { key: "fleet", role: "fleet_manager", tenant: tenantA },
  { key: "manager", role: "manager", tenant: tenantA },
  { key: "driver", role: "driver", tenant: tenantA },
  { key: "foreign", role: "administrator", tenant: tenantB },
].map((user) => ({ ...user, name: `Claim QA ${user.key}`, email: `claim-${runId}-${user.key}@example.invalid` }));
const pdf = Buffer.from("%PDF-1.7\nNexDrive claim evidence fixture\n%%EOF\n");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const jpg = Buffer.from([0xff, 0xd8, 0xff]);
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

function makeClaimForm({ vehicleId = vehicleA, incidentDate = "2026-09-25", description = "Rear bumper damage found at the depot.", fileName = "initial-report.pdf", bytes = pdf, omitFile = false } = {}, extraFields = {}) {
  const form = new FormData();
  form.set("vehicleId", vehicleId);
  form.set("incidentDate", incidentDate);
  form.set("description", description);
  if (!omitFile) {
    const extension = fileName.split(".").at(-1).toLowerCase();
    form.append("initialEvidence", new Blob([bytes], { type: contentTypes[extension] || "application/octet-stream" }), fileName);
  }
  for (const [key, value] of Object.entries(extraFields)) form.set(key, value);
  return form;
}

async function createClaim(cookie, options, extraFields) {
  return request("/api/claims", "POST", cookie, makeClaimForm(options, extraFields));
}

let vehicleA, vehicleB;
try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Temporary Claim QA A'), ($2, 'Temporary Claim QA B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2, "emailVerified"=true WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = saved.rows[0].id;
  }
  const [admin, fleet, manager, driver, foreignAdmin] = await Promise.all(users.map(signIn));
  vehicleA = randomUUID(); vehicleB = randomUUID();
  await pool.query(
    `INSERT INTO vehicle (id, tenant_id, registration, make, model, current_mileage)
     VALUES ($1, $2, $3, 'Renault', 'Clio', NULL), ($4, $5, $6, 'Peugeot', '208', NULL)`,
    [vehicleA, tenantA, `CA-${runId.slice(0, 6)}-AA`, vehicleB, tenantB, `CB-${runId.slice(0, 6)}-AA`],
  );

  assert.equal((await request("/api/claims")).status, 401, "claim list requires sign-in");
  assert.equal((await request("/api/claims", "POST", null, makeClaimForm())).status, 401, "claim declaration requires sign-in");
  assert.equal((await request(`/api/claims/${randomUUID()}`)).status, 401, "claim detail requires sign-in");

  const created = await createClaim(manager);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const claim = created.data.claim;
  assert.equal(claim.incident_date, "2026-09-25");
  assert.equal(claim.description, "Rear bumper damage found at the depot.");
  assert.equal(claim.status, "open");
  assert.equal(claim.vehicle_registration, `CA-${runId.slice(0, 6)}-AA`);
  assert.equal(claim.initial_evidence.file_name, "initial-report.pdf");
  assert.equal(Object.hasOwn(claim, "driver_id"), false, "date-only claims do not invent driver attribution");
  assert.equal(JSON.stringify(claim).includes("storage_key"), false, "API never reveals a private object key");
  const claimId = claim.id, evidenceId = claim.initial_evidence.id;

  const evidenceRow = await pool.query(
    "SELECT tenant_id, storage_key, file_size, uploaded_by_user_id FROM claim_evidence WHERE claim_id=$1",
    [claimId],
  );
  assert.equal(evidenceRow.rows[0].tenant_id, tenantA);
  assert.equal(evidenceRow.rows[0].uploaded_by_user_id, users[2].id);
  assert.match(evidenceRow.rows[0].storage_key, /^claim-evidence\//);
  assert.equal(Number(evidenceRow.rows[0].file_size), pdf.length);

  const list = await request(`/api/claims?tenantId=${tenantB}`, "GET", manager);
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.claims.map((item) => item.id), [claimId], "tenant query tampering cannot alter the claim list");
  assert.equal((await request(`/api/claims/${claimId}`, "GET", manager)).status, 200);
  assert.equal((await request(`/api/claims/${claimId}/evidence/${evidenceId}/content`, "GET", manager)).status, 200);
  assert.equal((await request(`/api/claims/${claimId}/evidence/${evidenceId}/content`, "GET")).status, 401, "direct evidence URL rejects anonymous access");
  assert.equal((await request(`/api/claims/${randomUUID()}/evidence/${evidenceId}/content`, "GET", manager)).status, 404, "evidence must belong to the requested claim");
  assert.equal((await request(`/api/claims/${claimId}/evidence/${randomUUID()}/content`, "GET", manager)).status, 404, "unknown evidence identifiers are hidden");
  assert.equal((await request(`/api/claims/${claimId}/evidence/${evidenceId}/content?tenantId=${tenantB}`, "GET", foreignAdmin)).status, 404, "another tenant cannot open a guessed file URL");
  assert.equal((await request(`/api/claims/${claimId}`, "GET", foreignAdmin)).status, 404, "another tenant cannot read a guessed claim ID");

  const content = await request(`/api/claims/${claimId}/evidence/${evidenceId}/content`, "GET", manager);
  assert.equal(content.status, 200);
  assert.deepEqual(content.data, pdf, "private initial evidence is retrieved from Tigris");
  assert.equal(content.response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.match(content.response.headers.get("content-disposition"), /^inline;/);
  const downloaded = await request(`/api/claims/${claimId}/evidence/${evidenceId}/content?download=1`, "GET", manager);
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.response.headers.get("content-disposition"), /^attachment;/);
  assert.equal((await request(`/api/claims/${claimId}/evidence/${evidenceId}/content`, "GET", fleet)).status, 200, "Fleet Manager can read protected initial evidence");
  assert.equal((await request(`/api/claims?tenantId=${tenantA}`, "GET", fleet)).status, 200, "Fleet Manager can read claims");
  assert.equal((await request(`/api/claims/${claimId}`, "GET", fleet)).status, 200);

  const forbiddenCreate = await createClaim(fleet, { fileName: "fleet.pdf" });
  assert.equal(forbiddenCreate.status, 403, "Fleet Manager cannot create claims");
  assert.equal((await request(`/api/claims/${claimId}`, "PATCH", fleet, { status: "closed" })).status, 405, "ticket 16 exposes no claim update workflow");
  assert.equal((await request("/api/claims", "GET", driver)).status, 403, "Driver cannot list organization claims");
  assert.equal((await request(`/api/claims/${claimId}`, "GET", driver)).status, 403, "Driver cannot inspect claims");
  assert.equal((await request(`/api/claims/${claimId}/evidence/${evidenceId}/content`, "GET", driver)).status, 403, "Driver cannot open claim evidence");
  assert.equal((await createClaim(driver)).status, 403, "Driver cannot declare a claim");
  assert.equal((await createClaim(admin)).status, 201, "Administrator retains full tenant access");

  assert.equal((await createClaim(manager, { vehicleId: vehicleB, fileName: "cross-tenant.pdf" })).status, 404, "another tenant's vehicle cannot be a claim parent");
  assert.equal((await createClaim(manager, undefined, { tenantId: tenantB })).status, 400, "client cannot choose a tenant");
  assert.equal((await createClaim(manager, undefined, { createdByUserId: users[0].id })).status, 400, "client cannot choose the creator");
  assert.equal((await createClaim(manager, undefined, { driverId: randomUUID() })).status, 400, "client cannot invent a driver association");
  assert.equal((await request(`/api/claims/${claimId}/evidence/${evidenceId}/content?vehicleId=${vehicleB}`, "GET", manager)).status, 200, "altered URL parent data cannot change the authorized claim/evidence pair");

  for (const [label, options, extra] of [
    ["unsupported extension", { fileName: "report.exe" }, {}],
    ["mismatched signature", { fileName: "fake.pdf", bytes: png }, {}],
    ["zero byte file", { fileName: "empty.pdf", bytes: Buffer.alloc(0) }, {}],
    ["oversized file", { fileName: "large.pdf", bytes: Buffer.alloc(15 * 1024 * 1024 + 1, 65) }, {}],
    ["invalid calendar date", { incidentDate: "2026-02-30" }, {}],
    ["date format with an assumed time", { incidentDate: "2026-09-25T12:00:00Z" }, {}],
    ["malformed date", { incidentDate: "2026-9-5" }, {}],
    ["blank description", { description: "   " }, {}],
    ["description beyond limit", { description: "x".repeat(4001) }, {}],
    ["missing evidence", { omitFile: true }, {}],
    ["unknown status field", {}, { status: "closed" }],
  ]) {
    const rejected = await createClaim(manager, options, extra);
    if (label === "oversized file") assert.ok(isOversizedUploadRejected(rejected.status), `${label} is rejected (received ${rejected.status})`);
    else assert.equal(rejected.status, 400, `${label} is rejected (received ${rejected.status})`);
  }

  for (const [index, [fileName, bytes]] of [
    ["allowed.png", png], ["allowed.jpg", jpg], ["allowed.jpeg", jpg], ["allowed.docx", makeMinimalDocx()],
  ].entries()) {
    const allowed = await createClaim(manager, { fileName, bytes, description: `Allowed file boundary ${index}.` });
    assert.equal(allowed.status, 201, `${fileName} is accepted after content verification`);
  }
  const exactMaximum = Buffer.alloc(maxTestUploadBytes, 0x41);
  pdf.copy(exactMaximum);
  const maximum = await createClaim(manager, { fileName: "maximum.pdf", bytes: exactMaximum, description: "x".repeat(4000) });
  assert.equal(maximum.status, 201, "the maximum test upload and 4,000 description characters are accepted");
  assert.equal(maximum.data.claim.description.length, 4000);
  assert.equal((await createClaim(manager, { incidentDate: "2024-02-29" })).status, 201, "valid leap-day incident dates are accepted");

  const freshManager = await signIn(users[2]);
  const persisted = await request(`/api/claims/${claimId}`, "GET", freshManager);
  assert.equal(persisted.status, 200);
  assert.equal(persisted.data.claim.incident_date, "2026-09-25", "claim persists after fresh sign-in");
  assert.equal(persisted.data.claim.initial_evidence.file_name, "initial-report.pdf");
  assert.deepEqual((await request(`/api/claims/${claimId}/evidence/${evidenceId}/content`, "GET", freshManager)).data, pdf, "initial evidence persists privately after fresh sign-in");
  const page = await request(`/claims/${claimId}`, "GET", freshManager);
  assert.equal(page.status, 200);
  assert.match(page.data.toString(), /Claim details|Claim detail/);
  assert.match(page.data.toString(), /Incident date/);
  assert.match(page.data.toString(), /Initial evidence/);
  assert.doesNotMatch(page.data.toString(), /Noon|12:00|Recorded driver from assignment history/);

  const databaseRow = await pool.query(
    `SELECT c.tenant_id, c.vehicle_id, c.incident_date::text, c.description, c.status,
      e.storage_key, e.file_name, e.file_size::text
     FROM claim c JOIN claim_evidence e ON e.tenant_id=c.tenant_id AND e.claim_id=c.id WHERE c.id=$1`,
    [claimId],
  );
  assert.deepEqual(databaseRow.rows[0], {
    tenant_id: tenantA, vehicle_id: vehicleA, incident_date: "2026-09-25", description: "Rear bumper damage found at the depot.", status: "open",
    storage_key: evidenceRow.rows[0].storage_key, file_name: "initial-report.pdf", file_size: String(pdf.length),
  });
  process.stdout.write("Claim verification passed: date-only Manager declaration; private initial evidence in Tigris; durable list/detail and fresh-sign-in retrieval; Fleet read-only access; Driver/anonymous/tenant/parent denial; and file/date/description boundary checks.");
} finally {
  const rows = await pool.query("SELECT storage_key FROM claim_evidence WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => ({ rows: [] }));
  for (const row of rows.rows) await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.storage_key })).catch(() => undefined);
  await pool.query("DELETE FROM claim WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
  storage.destroy();
}
