import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { isOversizedUploadRejected, maxTestUploadBytes } from "./verify-upload-limits.mjs";

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "TIGRIS_BUCKET", "TIGRIS_ACCESS_KEY_ID", "TIGRIS_SECRET_ACCESS_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Local fine verification needs the app and private Tigris configuration (${missing.join(", ")}).`);

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
].map((user) => ({ ...user, name: `Fine QA ${user.key}`, email: `fine-${runId}-${user.key}@example.invalid` }));
const pdf = Buffer.from("%PDF-1.7\nNexDrive fine evidence fixture\n%%EOF\n");
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
    ["[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>"] ,
    ["word/document.xml", "<document xmlns=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>"] ,
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

function makeFineForm(fileName = "notice.pdf", bytes = pdf, overrides = {}, extraFields = {}) {
  const form = new FormData();
  const fields = {
    vehicleId: overrides.vehicleId ?? vehicleA,
    reference: overrides.reference ?? `FN-${runId.slice(0, 8)}`,
    fineType: overrides.fineType ?? "company",
    infractionAt: overrides.infractionAt ?? "2026-09-25T10:30:00.000Z",
    paymentDeadline: overrides.paymentDeadline ?? "2026-10-25",
    description: overrides.description ?? "Traffic notice recorded for verification.",
    amount: overrides.amount ?? "125.50",
  };
  for (const [key, value] of Object.entries(fields)) if (value !== null) form.set(key, value);
  form.append("evidence", new Blob([bytes], { type: contentTypes[fileName.split(".").at(-1).toLowerCase()] || "application/octet-stream" }), fileName);
  for (const [key, value] of Object.entries(extraFields)) form.set(key, value);
  return form;
}

async function createFine(cookie, fileName, bytes, overrides, extraFields) {
  return request("/api/fines", "POST", cookie, makeFineForm(fileName, bytes, overrides, extraFields));
}

let vehicleA, vehicleB;
try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Temporary Fine QA A'), ($2, 'Temporary Fine QA B')", tenants);
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
    [vehicleA, tenantA, `FA-${runId.slice(0, 6)}-AA`, vehicleB, tenantB, `FB-${runId.slice(0, 6)}-AA`],
  );

  assert.equal((await request("/api/fines")).status, 401, "fine list requires a signed-in account");
  assert.equal((await request("/api/fines", "POST", null, makeFineForm())).status, 401, "fine creation requires a signed-in account");
  assert.equal((await request(`/api/fines/${randomUUID()}`)).status, 401, "fine detail requires a signed-in account");

  const created = await createFine(manager, "notice.pdf", pdf);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const fine = created.data.fine;
  assert.equal(fine.reference, `FN-${runId.slice(0, 8)}`);
  assert.equal(fine.fine_type, "company");
  assert.equal(fine.status, "open");
  assert.equal(fine.payment_deadline, "2026-10-25");
  assert.equal(fine.amount, "125.50");
  assert.equal(fine.evidence.file_name, "notice.pdf");
  assert.equal(JSON.stringify(fine).includes("storage_key"), false, "API never reveals a private bucket key");
  const fineId = fine.id, evidenceId = fine.evidence.id;

  const evidenceRow = await pool.query("SELECT tenant_id, storage_key, file_size, uploaded_by_user_id FROM fine_evidence WHERE fine_id=$1", [fineId]);
  assert.equal(evidenceRow.rows[0].tenant_id, tenantA);
  assert.equal(evidenceRow.rows[0].uploaded_by_user_id, users[2].id);
  assert.match(evidenceRow.rows[0].storage_key, /^fine-evidence\//);
  assert.equal(Number(evidenceRow.rows[0].file_size), pdf.length);

  const list = await request("/api/fines?tenantId=" + tenantB, "GET", manager);
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.fines.map((item) => item.id), [fineId], "query tenant tampering cannot redirect the list");
  assert.equal((await request(`/api/fines/${fineId}`, "GET", manager)).status, 200);
  assert.equal((await request(`/api/fines/${fineId}/evidence/${evidenceId}/content`, "GET", manager)).status, 200);
  assert.equal((await request(`/api/fines/${fineId}/evidence/${evidenceId}/content`, "GET")).status, 401, "direct private evidence URL rejects anonymous access");
  assert.equal((await request(`/api/fines/${randomUUID()}/evidence/${evidenceId}/content`, "GET", manager)).status, 404, "evidence requires the correct parent fine");
  assert.equal((await request(`/api/fines/${fineId}/evidence/${randomUUID()}/content`, "GET", manager)).status, 404, "unknown evidence identifiers are hidden");
  assert.equal((await request(`/api/fines/${fineId}/evidence/${evidenceId}/content?tenantId=${tenantB}`, "GET", foreignAdmin)).status, 404, "another tenant cannot open the guessed evidence URL");
  assert.equal((await request(`/api/fines/${fineId}`, "GET", foreignAdmin)).status, 404, "another tenant cannot read a guessed fine ID");

  const vehicleTamper = await createFine(manager, "foreign.pdf", pdf, { vehicleId: vehicleB, reference: `FOREIGN-${runId.slice(0, 8)}` });
  assert.equal(vehicleTamper.status, 404, "another tenant's vehicle cannot be a fine parent");
  assert.equal((await request("/api/fines", "POST", fleet, makeFineForm("fleet.pdf", pdf, { reference: `FLEET-${runId.slice(0, 8)}` }))).status, 403, "Fleet Manager cannot create a fine");
  assert.equal((await request(`/api/fines/${fineId}`, "PATCH", fleet, { status: "closed" })).status, 403, "Fleet Manager cannot change status");
  assert.equal((await request("/api/fines", "GET", driver)).status, 403, "Driver cannot list organization fines");
  assert.equal((await request(`/api/fines/${fineId}`, "GET", driver)).status, 403, "Driver cannot inspect a fine");
  assert.equal((await request(`/api/fines/${fineId}/evidence/${evidenceId}/content`, "GET", driver)).status, 403, "Driver cannot open fine evidence");
  assert.equal((await request("/api/fines", "POST", driver, makeFineForm())).status, 403, "Driver cannot create a fine");
  assert.equal((await request(`/api/fines/${fineId}`, "PATCH", driver, { status: "closed" })).status, 403, "Driver cannot update a fine");

  for (const [label, fileName, bytes, overrides, extra] of [
    ["tenant spoof", "spoof.pdf", pdf, { reference: `SPOOF-${runId.slice(0, 6)}` }, { tenantId: tenantB }],
    ["unsupported extension", "payload.exe", pdf, { reference: `TYPE-${runId.slice(0, 6)}` }, {}],
    ["mismatched signature", "fake.pdf", png, { reference: `SIGN-${runId.slice(0, 6)}` }, {}],
    ["too large", "large.pdf", Buffer.alloc(15 * 1024 * 1024 + 1, 65), { reference: `SIZE-${runId.slice(0, 6)}` }, {}],
    ["long reference", "long.pdf", pdf, { reference: "R".repeat(101) }, {}],
    ["invalid infraction calendar date", "date.pdf", pdf, { reference: `DATE-${runId.slice(0, 6)}`, infractionAt: "2026-02-30T10:30:00.000Z" }, {}],
    ["missing timezone", "zone.pdf", pdf, { reference: `ZONE-${runId.slice(0, 6)}`, infractionAt: "2026-09-25T10:30" }, {}],
    ["invalid deadline", "deadline.pdf", pdf, { reference: `DEAD-${runId.slice(0, 6)}`, paymentDeadline: "2026-02-30" }, {}],
    ["negative amount", "amount.pdf", pdf, { reference: `AMOUNT-${runId.slice(0, 6)}`, amount: "-1" }, {}],
    ["amount exceeds numeric maximum", "amount2.pdf", pdf, { reference: `AMOUNT2-${runId.slice(0, 6)}`, amount: "10000000000" }, {}],
    ["unsupported type", "type.pdf", pdf, { reference: `TYPE2-${runId.slice(0, 6)}`, fineType: "other" }, {}],
    ["description beyond limit", "description.pdf", pdf, { reference: `DESC-${runId.slice(0, 6)}`, description: "x".repeat(4001) }, {}],
  ]) {
    const rejected = await createFine(manager, fileName, bytes, overrides, extra);
    if (label === "too large") assert.ok(isOversizedUploadRejected(rejected.status), `${label} is rejected (received ${rejected.status})`);
    else assert.equal(rejected.status, 400, `${label} is rejected (received ${rejected.status})`);
  }
  assert.equal((await createFine(manager, "missing.pdf", pdf, { reference: `NOKEY-${runId.slice(0, 6)}` }, { createdBy: users[0].id })).status, 400, "client cannot choose the creator identity");
  assert.equal((await request(`/api/fines/${fineId}`, "PATCH", manager, { status: "closed", reference: "forged" })).status, 400, "status update cannot modify fine fields");
  assert.equal((await request(`/api/fines/${fineId}`, "PATCH", manager, { status: "paid" })).status, 400, "unsupported or payment-triggering statuses are rejected");

  const duplicate = await createFine(manager, "duplicate.pdf", pdf);
  assert.equal(duplicate.status, 409, "duplicate tenant references are rejected cleanly");

  const allowed = [
    ["allowed.png", png], ["allowed.jpg", jpg], ["allowed.jpeg", jpg], ["allowed.docx", makeMinimalDocx()],
  ];
  for (let index = 0; index < allowed.length; index++) {
    const [fileName, bytes] = allowed[index];
    const result = await createFine(manager, fileName, bytes, { reference: `ALLOW-${index}-${runId.slice(0, 6)}` });
    assert.equal(result.status, 201, `${fileName} is accepted with a verified signature`);
  }
  const maximumBytes = Buffer.alloc(maxTestUploadBytes, 0x41);
  pdf.copy(maximumBytes);
  const maximum = await createFine(manager, "maximum.pdf", maximumBytes, { reference: `MAX-${runId.slice(0, 8)}` });
  assert.equal(maximum.status, 201, "the maximum test upload supported by this verification target is accepted");
  const maxAmount = await createFine(manager, "max-amount.pdf", pdf, {
    reference: `AMT-${runId.slice(0, 8)}`, amount: "9999999999.99", description: "x".repeat(4000),
  });
  assert.equal(maxAmount.status, 201, "numeric and description upper boundaries are accepted");

  assert.equal((await request("/api/fines", "PATCH", admin, { status: "closed" })).status, 405, "collection does not expose status mutation");
  const adminFine = await createFine(admin, "admin.pdf", pdf, { reference: `ADMIN-${runId.slice(0, 8)}` });
  assert.equal(adminFine.status, 201, "Administrator retains full tenant access");

  const changed = await request(`/api/fines/${fineId}`, "PATCH", manager, { status: "closed" });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.fine.status, "closed");
  assert.equal(changed.data.fine.reference, fine.reference);
  assert.equal(changed.data.fine.vehicle_id, fine.vehicle_id);
  assert.equal(new Date(changed.data.fine.infraction_at).getTime(), new Date(fine.infraction_at).getTime());
  assert.equal(changed.data.fine.payment_deadline, fine.payment_deadline);
  assert.equal(changed.data.fine.evidence.id, evidenceId);

  const freshManager = await signIn(users[2]);
  const persisted = await request(`/api/fines/${fineId}`, "GET", freshManager);
  assert.equal(persisted.status, 200);
  assert.equal(persisted.data.fine.status, "closed", "status survives a fresh sign-in");
  assert.equal(persisted.data.fine.reference, fine.reference);
  assert.equal(persisted.data.fine.payment_deadline, fine.payment_deadline);
  const content = await request(`/api/fines/${fineId}/evidence/${evidenceId}/content`, "GET", freshManager);
  assert.equal(content.status, 200, "private evidence remains available after a fresh sign-in");
  assert.deepEqual(content.data, pdf);
  assert.equal(content.response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.match(content.response.headers.get("content-disposition"), /^inline;/);
  const downloaded = await request(`/api/fines/${fineId}/evidence/${evidenceId}/content?download=1`, "GET", freshManager);
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.response.headers.get("content-disposition"), /^attachment;/);
  assert.equal((await request(`/api/fines/${fineId}/evidence/${evidenceId}/content`, "GET", fleet)).status, 200, "Fleet Manager may read evidence");

  const databaseRow = await pool.query(
    `SELECT f.tenant_id, f.reference, f.vehicle_id, f.status, f.payment_deadline::text,
      e.storage_key, e.file_name, e.file_size::text
     FROM fine f JOIN fine_evidence e ON e.tenant_id=f.tenant_id AND e.fine_id=f.id WHERE f.id=$1`,
    [fineId],
  );
  assert.deepEqual(databaseRow.rows[0], {
    tenant_id: tenantA, reference: fine.reference, vehicle_id: fine.vehicle_id, status: "closed",
    payment_deadline: fine.payment_deadline, storage_key: evidenceRow.rows[0].storage_key,
    file_name: "notice.pdf", file_size: String(pdf.length),
  });
  process.stdout.write("Fine verification passed: Manager create/update with private Tigris evidence; fresh-sign-in persistence; authorized Fleet read; role, tenant, parent, and direct-file denials; allowed file signatures, configured upload and field boundaries; and no payment action.\n");
} finally {
  const rows = await pool.query("SELECT storage_key FROM fine_evidence WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => ({ rows: [] }));
  for (const row of rows.rows) await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.storage_key })).catch(() => undefined);
  await pool.query("DELETE FROM fine WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
  storage.destroy();
}
