import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error("Local app configuration is required (" + missing.join(", ") + ").");
const storageConfigured = ["TIGRIS_BUCKET", "TIGRIS_ACCESS_KEY_ID", "TIGRIS_SECRET_ACCESS_KEY"].every((name) => Boolean(process.env[name]));
if (!storageConfigured) throw new Error("Tigris private storage is required for vehicle-document verification.");
const origin = process.env.BETTER_AUTH_URL;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const auth = betterAuth({
  baseURL: origin, secret: process.env.BETTER_AUTH_SECRET,
  database: { dialect: new PostgresDialect({ pool }), type: "postgres" },
  emailAndPassword: { enabled: true },
  user: { additionalFields: {
    tenantId: { type: "string", required: false, input: false },
    appRole: { type: ["administrator", "fleet_manager", "manager", "driver"], required: false, input: false },
  } },
});
const storage = storageConfigured ? new S3Client({
  endpoint: process.env.TIGRIS_ENDPOINT || "https://t3.storage.dev",
  region: "auto",
  credentials: { accessKeyId: process.env.TIGRIS_ACCESS_KEY_ID, secretAccessKey: process.env.TIGRIS_SECRET_ACCESS_KEY },
}) : null;
const bucket = process.env.TIGRIS_BUCKET;
const tenantA = randomUUID(), tenantB = randomUUID(), runId = randomUUID();
const tenants = [tenantA, tenantB];
const password = randomBytes(24).toString("base64url");
const users = ["administrator", "fleet_manager", "manager", "driver", "driver", "administrator"].map((role, i) => ({
  role, tenant: i === 5 ? tenantB : tenantA, name: "Document QA " + i,
  email: "document-" + runId + "-" + i + "@example.invalid",
}));

async function request(path, method, cookie, body) {
  const response = await fetch(origin + path, {
    method: method || "GET",
    headers: Object.assign({}, cookie ? { cookie } : {}, body !== undefined ? { "content-type": "application/json", origin } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.arrayBuffer();
  return { status: response.status, data, response };
}
async function signIn(email) {
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    result = await request("/api/auth/sign-in/email", "POST", null, { email, password });
    if (result.status !== 429 || attempt === 2) break;
    const retryAfter = Number(result.response.headers.get("retry-after"));
    await new Promise((resolve) => setTimeout(resolve, Math.max(10_000, Number.isFinite(retryAfter) ? retryAfter * 1_000 : 0)));
  }
  assert.equal(result.status, 200);
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}
async function uploadDocument(cookie, vehicleId, meta, bytes) {
  const prepared = await request("/api/vehicles/" + vehicleId + "/documents", "POST", cookie, {
    name: meta.name, category: meta.category, expiryDate: meta.expiryDate || null,
    visibleToDriver: meta.visibleToDriver, fileName: meta.fileName, fileSize: bytes.length,
  });
  assert.equal(prepared.status, 201, JSON.stringify(prepared.data));
  const upload = prepared.data.upload;
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  const mime = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }[meta.fileName.split(".").at(-1).toLowerCase()];
  form.append("file", new Blob([bytes], { type: mime }), meta.fileName);
  const uploaded = await fetch(upload.uploadUrl, { method: "POST", body: form });
  assert.ok(uploaded.ok, "Tigris upload returned " + uploaded.status);
  assert.equal((await request("/api/vehicles/" + vehicleId + "/documents/" + upload.id + "/complete", "POST", cookie)).status, 200);
  return upload.id;
}
const pdf = Buffer.from("%PDF-1.4\nNexDrive private vehicle document verification fixture\n%%EOF\n");
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
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(value);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const record = Buffer.concat([local, nameBytes, data]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(localOffset, 42);
    centralRecords.push(Buffer.concat([central, nameBytes]));
    localRecords.push(record);
    localOffset += record.length;
  }
  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, end]);
}
let driverId;
try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Document QA A'), ($2, 'Document QA B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const result = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2 WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = result.rows[0].id;
  }
  const signedIn = [];
  for (const user of users) signedIn.push(await signIn(user.email));
  const [admin, fleet, manager, driver, unassignedDriver, otherAdmin] = signedIn;
  const vehicle = (await request("/api/vehicles", "POST", admin, { registration: "DOC-QA-AA", make: "Renault", model: "Clio", ownershipType: "owned" })).data.vehicle.id;
  const sibling = (await request("/api/vehicles", "POST", fleet, { registration: "DOC-QB-AA", make: "Peugeot", model: "208", ownershipType: "owned" })).data.vehicle.id;
  (await request("/api/vehicles", "POST", otherAdmin, { registration: "DOC-QC-AA", make: "Citroen", model: "C3", ownershipType: "owned" }));
  driverId = randomUUID();
  await pool.query("INSERT INTO driver (id, tenant_id, user_id, full_name) VALUES ($1, $2, $3, 'Document QA Driver')", [driverId, tenantA, users[3].id]);
  await pool.query("INSERT INTO assignment (id, tenant_id, vehicle_id, driver_id, started_at, created_by_user_id) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP - INTERVAL '1 minute', $5)", [randomUUID(), tenantA, vehicle, driverId, users[0].id]);

  let staffOnly, shared, insurance, rentalAgreement;
  if (storageConfigured) {
    staffOnly = await uploadDocument(admin, vehicle, { name: "Staff-only registration", category: "registration", fileName: "registration.pdf", visibleToDriver: false }, pdf);
    shared = await uploadDocument(fleet, vehicle, { name: "Shared inspection", category: "inspection", expiryDate: "2027-06-30", fileName: "inspection.pdf", visibleToDriver: true }, pdf);
    insurance = await uploadDocument(admin, vehicle, { name: "Vehicle insurance", category: "insurance", fileName: "insurance.pdf", visibleToDriver: false }, pdf);
    rentalAgreement = await uploadDocument(admin, vehicle, { name: "Rental agreement", category: "rental_agreement", fileName: "rental-agreement.pdf", visibleToDriver: false }, pdf);
  } else {
    staffOnly = randomUUID();
    shared = randomUUID();
    insurance = randomUUID();
    rentalAgreement = randomUUID();
    for (const item of [
      { id: staffOnly, name: "Staff-only registration", category: "registration", fileName: "registration.pdf", visible: false, expiry: null, uploader: users[0].id },
      { id: shared, name: "Shared inspection", category: "inspection", fileName: "inspection.pdf", visible: true, expiry: "2027-06-30", uploader: users[1].id },
      { id: insurance, name: "Vehicle insurance", category: "insurance", fileName: "insurance.pdf", visible: false, expiry: null, uploader: users[0].id },
      { id: rentalAgreement, name: "Rental agreement", category: "rental_agreement", fileName: "rental-agreement.pdf", visible: false, expiry: null, uploader: users[0].id },
    ]) {
      await pool.query(
        `INSERT INTO vehicle_document (id, tenant_id, vehicle_id, name, category, expiry_date,
         visible_to_driver, storage_key, pending_storage_key, file_name, file_extension,
         content_type, file_size, status, created_by_user_id, uploaded_at, upload_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, 'pdf', 'application/pdf', $10,
          'ready', $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 day')`,
        [item.id, tenantA, vehicle, item.name, item.category, item.expiry, item.visible,
          "vehicle-documents/" + randomUUID(), item.fileName, pdf.length, item.uploader],
      );
    }
  }

  const typeFixtures = [
    { fileName: "form.png", bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) },
    { fileName: "photo.jpg", bytes: Buffer.from([0xff, 0xd8, 0xff]) },
    { fileName: "photo.jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff]) },
    { fileName: "registration.docx", bytes: makeMinimalDocx() },
  ];
  const formatDocuments = [];
  for (const fixture of typeFixtures) {
    const id = await uploadDocument(admin, vehicle, {
      name: "Supported " + fixture.fileName, category: "other", fileName: fixture.fileName, visibleToDriver: false,
    }, fixture.bytes);
    formatDocuments.push({ id, bytes: fixture.bytes, fileName: fixture.fileName });
  }
  const freshAdmin = await signIn(users[0].email);
  const metadata = await request("/api/vehicles/" + vehicle + "/documents", "GET", freshAdmin);
  assert.equal(metadata.status, 200);
  assert.deepEqual(new Set(metadata.data.documents.map((item) => item.id)), new Set([staffOnly, shared, insurance, rentalAgreement, ...formatDocuments.map((item) => item.id)]));
  assert.equal(metadata.data.documents.find((item) => item.id === shared).expiry_date, "2027-06-30");
  assert.equal(metadata.data.documents.find((item) => item.id === rentalAgreement).category, "rental_agreement", "rental agreement category persists after a fresh sign-in");
  assert.equal(metadata.data.documents.find((item) => item.id === insurance).category, "insurance", "existing insurance category remains supported");
  for (const item of formatDocuments) assert.ok(metadata.data.documents.some((document) => document.id === item.id && document.file_name === item.fileName), "supported file metadata persists");
  const persisted = await request("/api/vehicles/" + vehicle + "/documents/" + staffOnly + "/content", "GET", freshAdmin);
  if (storageConfigured) {
    assert.equal(persisted.status, 200);
    assert.deepEqual(Buffer.from(persisted.data), pdf);
    for (const item of formatDocuments) {
      const opened = await request("/api/vehicles/" + vehicle + "/documents/" + item.id + "/content", "GET", freshAdmin);
      assert.equal(opened.status, 200, "all approved formats open after a fresh sign-in");
      assert.deepEqual(Buffer.from(opened.data), item.bytes);
    }
    for (const id of [insurance, rentalAgreement]) {
      const opened = await request("/api/vehicles/" + vehicle + "/documents/" + id + "/content", "GET", freshAdmin);
      assert.equal(opened.status, 200, "existing and rental agreement categories open after a fresh sign-in");
      assert.deepEqual(Buffer.from(opened.data), pdf);
    }
  } else {
    assert.equal(persisted.status, 503, "authorized content is unavailable until Tigris is configured");
  }
  assert.equal((await request("/api/vehicles/" + vehicle + "/documents/" + staffOnly + "/content")).status, 401);
  const managerUpload = await request("/api/vehicles/" + vehicle + "/documents", "POST", manager, { name: "No", category: "other", expiryDate: null, visibleToDriver: false, fileName: "no.pdf", fileSize: pdf.length });
  const driverUpload = await request("/api/vehicles/" + vehicle + "/documents", "POST", driver, { name: "No", category: "other", expiryDate: null, visibleToDriver: false, fileName: "no.pdf", fileSize: pdf.length });
  assert.equal(managerUpload.status, 403);
  assert.equal(driverUpload.status, 403);
  const crossTenantUpload = await request("/api/vehicles/" + vehicle + "/documents", "POST", otherAdmin, { name: "No", category: "other", expiryDate: null, visibleToDriver: false, fileName: "no.pdf", fileSize: pdf.length });
  assert.equal(crossTenantUpload.status, 404);
  assert.equal((await request("/api/vehicles/" + vehicle + "/documents", "GET", otherAdmin)).status, 404);
  assert.equal((await request("/api/vehicles/" + vehicle + "/documents/" + staffOnly + "/content", "GET", otherAdmin)).status, 404);
  assert.equal((await request("/api/vehicles/" + sibling + "/documents/" + staffOnly + "/content", "GET", freshAdmin)).status, 404);

  const driverMetadata = await request("/api/vehicles/" + vehicle + "/documents", "GET", driver);
  assert.equal(driverMetadata.status, 200);
  assert.deepEqual(driverMetadata.data.documents.map((item) => item.id), [shared]);
  assert.equal((await request("/api/vehicles/" + vehicle + "/documents/" + staffOnly + "/content", "GET", driver)).status, 404);
  assert.equal((await request("/api/vehicles/" + vehicle + "/documents", "GET", unassignedDriver)).status, 404);
  assert.equal((await request("/api/vehicles/" + vehicle + "/documents/" + shared + "/content", "GET", unassignedDriver)).status, 404);
  const driverContent = await request("/api/vehicles/" + vehicle + "/documents/" + shared + "/content", "GET", driver);
  if (storageConfigured) {
    assert.equal(driverContent.status, 200);
    assert.deepEqual(Buffer.from(driverContent.data), pdf);
  } else {
    assert.equal(driverContent.status, 503, "authorized content is unavailable until Tigris is configured");
  }

  const validDetails = { name: "Boundary document", category: "other", expiryDate: null, visibleToDriver: false, fileName: "boundary.pdf", fileSize: pdf.length };
  const invalidBodies = [
    { ...validDetails, fileName: "unsafe.exe" },
    { ...validDetails, fileName: "macro.docm" },
    { ...validDetails, fileName: "fake.pdf.exe" },
    { ...validDetails, fileName: "" },
    { ...validDetails, fileName: "x".repeat(177) + ".pdf" },
    { ...validDetails, fileSize: 0 },
    { ...validDetails, fileSize: -1 },
    { ...validDetails, fileSize: 1.5 },
    { ...validDetails, fileSize: 15 * 1024 * 1024 + 1 },
    { ...validDetails, category: "employment_contract" },
    { ...validDetails, name: "" },
    { ...validDetails, name: "x".repeat(121) },
    { ...validDetails, expiryDate: "2026-02-30" },
    { ...validDetails, visibleToDriver: "true" },
    { ...validDetails, tenantId: tenantB },
    { ...validDetails, vehicleId: sibling },
  ];
  for (const body of invalidBodies) {
    assert.equal((await request("/api/vehicles/" + vehicle + "/documents", "POST", admin, body)).status, 400, "invalid type, policy, metadata, or forged parent is rejected");
  }
  const maximumRequest = await request("/api/vehicles/" + vehicle + "/documents", "POST", admin, {
    ...validDetails, fileName: "maximum.pdf", fileSize: 15 * 1024 * 1024,
  });
  assert.equal(maximumRequest.status, 201, "exact 15 MiB boundary is accepted");
  await pool.query("DELETE FROM vehicle_document WHERE tenant_id=$1 AND id=$2", [tenantA, maximumRequest.data.upload.id]);  if (storageConfigured) {
    const bad = await request("/api/vehicles/" + vehicle + "/documents", "POST", admin, {
      name: "Bad signature", category: "other", expiryDate: null, visibleToDriver: false, fileName: "fake.pdf", fileSize: 14,
    });
    assert.equal(bad.status, 201);
    const badForm = new FormData();
    for (const [key, value] of Object.entries(bad.data.upload.fields)) badForm.append(key, value);
    badForm.append("file", new Blob(["not-a-pdf-file"], { type: "application/pdf" }), "fake.pdf");
    assert.ok((await fetch(bad.data.upload.uploadUrl, { method: "POST", body: badForm })).ok);
    assert.equal((await request("/api/vehicles/" + vehicle + "/documents/" + bad.data.upload.id + "/complete", "POST", admin)).status, 400);
    assert.equal((await request("/api/vehicles/" + vehicle + "/documents", "GET", admin)).data.documents.some((item) => item.id === bad.data.upload.id), false);
  } else {
    const configuredResponse = await request("/api/vehicles/" + vehicle + "/documents", "POST", admin, {
      name: "Private upload", category: "other", expiryDate: null, visibleToDriver: false, fileName: "valid.pdf", fileSize: pdf.length,
    });
    assert.equal(configuredResponse.status, 503, "valid uploads wait for private storage configuration");
  }

  process.stdout.write(storageConfigured
    ? "Vehicle document verification passed: authorized Tigris upload and retrieval after fresh sign-in; private persistence; type and size validation; and tenant, role, parent, and driver-visibility enforcement.\n"
    : "Vehicle document authorization checks passed. Tigris is not configured, so private upload/content persistence checks were not run.\n");
} finally {
  const rows = await pool.query("SELECT storage_key, pending_storage_key FROM vehicle_document WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => ({ rows: [] }));
  for (const row of rows.rows) {
    for (const key of [row.storage_key, row.pending_storage_key].filter(Boolean)) {
      if (storage) await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
    }
  }
  await pool.query("DELETE FROM vehicle_document WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM assignment WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM driver WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
  storage?.destroy();
}
