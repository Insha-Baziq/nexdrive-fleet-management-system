import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "TIGRIS_BUCKET", "TIGRIS_ACCESS_KEY_ID", "TIGRIS_SECRET_ACCESS_KEY"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error("Local app and private storage configuration is required (" + missing.join(", ") + ").");

const origin = process.env.BETTER_AUTH_URL;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
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
const users = ["administrator", "fleet_manager", "manager", "driver", "administrator"].map((role, index) => ({
  role,
  tenant: index === 4 ? tenantB : tenantA,
  name: "Driver document QA " + index,
  email: `driver-document-${runId}-${index}@example.invalid`,
}));

async function request(path, method, cookie, body) {
  const response = await fetch(origin + path, {
    method: method || "GET",
    headers: Object.assign({}, cookie ? { cookie } : {}, body !== undefined ? { "content-type": "application/json", origin } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, data, response };
}

async function signIn(email) {
  const result = await request("/api/auth/sign-in/email", "POST", null, { email, password });
  assert.equal(result.status, 200, "temporary user sign-in succeeds");
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

const pdf = Buffer.from("%PDF-1.4\nNexDrive private driver document verification fixture\n%%EOF\n");
const requiredExpiry = "2030-01-01";
async function uploadDocument(cookie, driverId, { name, category, expiryDate, fileName }, bytes = pdf) {
  const prepared = await request(`/api/drivers/${driverId}/documents`, "POST", cookie, {
    name,
    category,
    expiryDate: expiryDate || null,
    fileName,
    fileSize: bytes.length,
  });
  assert.equal(prepared.status, 201, JSON.stringify(prepared.data));
  const upload = prepared.data.upload;
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append("file", new Blob([bytes], { type: "application/pdf" }), fileName);
  const uploaded = await fetch(upload.uploadUrl, { method: "POST", body: form });
  assert.ok(uploaded.ok, "Tigris accepts the signed private upload");
  return upload.id;
}

try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Driver document QA A'), ($2, 'Driver document QA B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({
      body: { name: user.name, email: user.email, password },
      headers: new Headers({ origin }),
    });
    const saved = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2, "emailVerified"=true WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = saved.rows[0].id;
  }
  const [admin, fleet, manager, driver, otherAdmin] = await Promise.all(users.map((user) => signIn(user.email)));
  const driverId = randomUUID();
  const siblingDriverId = randomUUID();
  const otherTenantDriverId = randomUUID();
  await pool.query(
    "INSERT INTO driver (id, tenant_id, user_id, full_name) VALUES ($1, $2, $3, 'QA driver'), ($4, $2, NULL, 'QA sibling driver'), ($5, $6, NULL, 'QA other tenant driver')",
    [driverId, tenantA, users[3].id, siblingDriverId, otherTenantDriverId, tenantB],
  );

  const basePath = `/api/drivers/${driverId}/documents`;
  assert.equal((await request(basePath, "GET", null)).status, 401, "metadata requires a signed-in user");
  assert.equal((await request(`${basePath}/not-a-document/content`, "GET", null)).status, 401, "direct content URL requires a signed-in user");
  assert.equal((await request(basePath, "GET", manager)).status, 200, "Manager can read driver document metadata");
  assert.equal((await request(`${basePath}/00000000-0000-4000-8000-000000000000/content`, "GET", manager)).status, 404, "Manager can reach the protected content lookup");
  assert.equal((await request(basePath, "GET", driver)).status, 200, "Driver may inspect their own linked record paperwork");
  assert.equal((await request(`${basePath}/00000000-0000-4000-8000-000000000000/content`, "GET", driver)).status, 404, "a Driver cannot open an unknown personal document");
  assert.equal((await request(basePath, "POST", driver, { name: "No", category: "driving_licence", fileName: "no.pdf", fileSize: pdf.length })).status, 403, "Driver self-upload remains disabled");
  assert.equal((await request(`/api/drivers/${otherTenantDriverId}/documents`, "GET", admin)).status, 404, "cross-tenant parent is hidden");
  assert.equal((await request(`/api/drivers/${driverId}/documents`, "GET", otherAdmin)).status, 404, "cross-tenant metadata is hidden");
  assert.equal((await request(`${basePath}/00000000-0000-4000-8000-000000000000/content`, "GET", otherAdmin)).status, 404, "cross-tenant direct content URL is denied");
  assert.equal((await request(`/api/drivers/${driverId}/documents`, "POST", otherAdmin, { name: "No", category: "driving_licence", fileName: "no.pdf", fileSize: pdf.length })).status, 404, "other-tenant staff cannot upload to a foreign driver");

  for (const body of [
    { name: "Forged parent", category: "driving_licence", expiryDate: requiredExpiry, fileName: "no.pdf", fileSize: pdf.length, driverId: siblingDriverId },
    { name: "Forged tenant", category: "driving_licence", expiryDate: requiredExpiry, fileName: "no.pdf", fileSize: pdf.length, tenantId: tenantB },
    { name: "Unsupported category", category: "medical", fileName: "no.pdf", fileSize: pdf.length },
    { name: "Unsupported type", category: "driving_licence", expiryDate: requiredExpiry, fileName: "no.exe", fileSize: pdf.length },
    { name: "Too large", category: "driving_licence", expiryDate: requiredExpiry, fileName: "large.pdf", fileSize: 15 * 1024 * 1024 + 1 },
    { name: "Empty file", category: "driving_licence", expiryDate: requiredExpiry, fileName: "empty.pdf", fileSize: 0 },
    { name: "Fractional size", category: "driving_licence", expiryDate: requiredExpiry, fileName: "fraction.pdf", fileSize: 1.5 },
    { name: "x".repeat(121), category: "driving_licence", expiryDate: requiredExpiry, fileName: "name.pdf", fileSize: pdf.length },
    { name: "Bad expiry", category: "driving_licence", expiryDate: "2026-02-30", fileName: "date.pdf", fileSize: pdf.length },
  ]) {
    assert.equal((await request(basePath, "POST", admin, body)).status, 400, "forged fields and invalid document policy are rejected");
  }

  for (const category of ["driving_licence", "identity_document"]) {
    const missingExpiry = await request(basePath, "POST", admin, {
      name: "Missing required expiry", category, expiryDate: null, fileName: "missing-expiry.pdf", fileSize: pdf.length,
    });
    assert.equal(missingExpiry.status, 400, `${category} upload requires an expiry date`);
    assert.match(missingExpiry.data.error, /expiry date is required/i);
  }

  for (const fileName of ["policy.pdf", "policy.png", "policy.jpg", "policy.jpeg", "policy.docx"]) {
    const allowed = await request(basePath, "POST", admin, {
      name: "Allowed " + fileName, category: "driving_licence", expiryDate: requiredExpiry, fileName, fileSize: pdf.length,
    });
    assert.equal(allowed.status, 201, "driver documents follow the approved vehicle document extension policy");
  }
  const maximum = await request(basePath, "POST", admin, {
    name: "Maximum size", category: "driving_licence", expiryDate: requiredExpiry, fileName: "maximum.pdf", fileSize: 15 * 1024 * 1024,
  });
  assert.equal(maximum.status, 201, "driver documents accept exactly 15 MiB");
  const licenceId = await uploadDocument(admin, driverId, {
    name: "QA driving licence", category: "driving_licence", expiryDate: "2027-09-14", fileName: "driving-licence.pdf",
  });
  assert.equal((await request(`/api/drivers/${siblingDriverId}/documents/${licenceId}/complete`, "POST", admin)).status, 404, "an altered parent ID cannot complete an upload");
  assert.equal((await request(`${basePath}/${licenceId}/complete`, "POST", admin)).status, 200, "authorized staff can complete a verified upload");

  const identityId = await uploadDocument(fleet, driverId, {
    name: "QA identity document", category: "identity_document", expiryDate: requiredExpiry, fileName: "identity-card.pdf",
  });
  assert.equal((await request(`${basePath}/${identityId}/complete`, "POST", fleet)).status, 200, "Fleet Manager can upload and complete a driver document");
  assert.equal((await request(`/api/drivers/${siblingDriverId}/documents/${licenceId}/content`, "GET", admin)).status, 404, "an altered parent ID cannot open document content");

  const carteVitaleId = await uploadDocument(admin, driverId, {
    name: "QA Carte Vitale", category: "carte_vitale", expiryDate: null, fileName: "carte-vitale.pdf",
  });
  assert.equal((await request(`${basePath}/${carteVitaleId}/complete`, "POST", admin)).status, 200, "Carte Vitale uploads without an expiry date");

  const contractId = await uploadDocument(manager, driverId, {
    name: "QA driver contract", category: "contract", expiryDate: null, fileName: "driver-contract.pdf",
  });
  assert.equal((await request(`${basePath}/${contractId}/complete`, "POST", manager)).status, 200, "Manager can add and complete a contract document without an expiry date");
  const otherId = await uploadDocument(manager, driverId, {
    name: "QA other document", category: "other", expiryDate: null, fileName: "other.pdf",
  });
  assert.equal((await request(`${basePath}/${otherId}/complete`, "POST", manager)).status, 200, "Manager can add and complete an Other document without an expiry date");
  assert.equal((await request(`${basePath}/${contractId}/content`, "GET", manager)).status, 200, "Manager can open the private contract document");

  await pool.query("UPDATE driver_document SET expiry_date = NULL WHERE tenant_id = $1 AND id = $2", [tenantA, identityId]);

  const bad = await request(basePath, "POST", admin, {
    name: "Bad signature", category: "identity_document", expiryDate: requiredExpiry, fileName: "fake.pdf", fileSize: 14,
  });
  assert.equal(bad.status, 201);
  const badForm = new FormData();
  for (const [key, value] of Object.entries(bad.data.upload.fields)) badForm.append(key, value);
  badForm.append("file", new Blob(["not-a-pdf-file"], { type: "application/pdf" }), "fake.pdf");
  assert.ok((await fetch(bad.data.upload.uploadUrl, { method: "POST", body: badForm })).ok);
  assert.equal((await request(`${basePath}/${bad.data.upload.id}/complete`, "POST", admin)).status, 400, "file signature is checked after upload");

  const freshAdmin = await signIn(users[0].email);
  const metadata = await request(basePath, "GET", freshAdmin);
  assert.equal(metadata.status, 200);
  assert.deepEqual(new Set(metadata.data.documents.map((item) => item.id)), new Set([licenceId, identityId, carteVitaleId, contractId, otherId]));
  assert.equal(metadata.data.documents.find((item) => item.id === licenceId).expiry_date, "2027-09-14");
  assert.equal(metadata.data.documents.find((item) => item.id === identityId).expiry_date, null, "legacy required-category documents with null expiry remain readable");
  assert.equal(metadata.data.documents.find((item) => item.id === carteVitaleId).expiry_date, null, "Carte Vitale expiry is optional");
  assert.equal(metadata.data.documents.find((item) => item.id === contractId).category, "contract");
  assert.equal(metadata.data.documents.find((item) => item.id === contractId).expiry_date, null, "Contract expiry is optional");
  assert.equal(metadata.data.documents.find((item) => item.id === otherId).category, "other");
  assert.equal(metadata.data.documents.find((item) => item.id === otherId).expiry_date, null, "Other category expiry is optional");
  const content = await request(`${basePath}/${licenceId}/content`, "GET", freshAdmin);
  assert.equal(content.status, 200, "authorized staff can reopen the persisted private file after a fresh sign-in");
  assert.deepEqual(content.data, pdf);
  assert.equal(content.response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal((await request(`${basePath}/${licenceId}/content`, "GET")).status, 401, "direct app download URL denies unauthenticated requests");
  assert.equal((await request(`${basePath}/${licenceId}/content`, "GET", driver)).status, 200, "the linked Driver can open their own document after ticket 11");
  assert.deepEqual((await request(`${basePath}/${licenceId}/content`, "GET", driver)).data, pdf);
  assert.equal((await request(`${basePath}/${licenceId}/content`, "GET", otherAdmin)).status, 404, "another tenant cannot open a guessed document URL");
  for (const documentId of [identityId, carteVitaleId]) {
    const legacyOrVitaleContent = await request(`${basePath}/${documentId}/content`, "GET", freshAdmin);
    assert.equal(legacyOrVitaleContent.status, 200, "legacy null-expiry and Carte Vitale files remain accessible after reload");
    assert.deepEqual(legacyOrVitaleContent.data, pdf);
    assert.equal((await request(`${basePath}/${documentId}/content`, "GET", otherAdmin)).status, 404, "another tenant cannot open driver documents");
  }

  const driverDocumentsPage = await request("/my-documents", "GET", driver);
  assert.equal(driverDocumentsPage.status, 200);
  const driverDocumentsHtml = Buffer.from(driverDocumentsPage.data).toString("utf8");
  assert.match(driverDocumentsHtml, /Carte Vitale/);
  assert.match(driverDocumentsHtml, /Contract|Contrat/);
  assert.match(driverDocumentsHtml, /Other|Autre/);
  assert.ok(
    /Expiry date needed|Date d.expiration requise/.test(driverDocumentsHtml),
    "driver paperwork flags a legacy required expiry for correction in the rendered locale",
  );
  const dashboard = await request("/workspace", "GET", freshAdmin);
  assert.equal(dashboard.status, 200);
  assert.match(Buffer.from(dashboard.data).toString("utf8"), /Expiry date required/, "dashboard attention includes the missing legacy expiry");

  const databaseRow = await pool.query(
    "SELECT status, tenant_id, driver_id, storage_key, pending_storage_key FROM driver_document WHERE id = $1",
    [licenceId],
  );
  assert.equal(databaseRow.rows[0].status, "ready");
  assert.equal(databaseRow.rows[0].tenant_id, tenantA);
  assert.equal(databaseRow.rows[0].driver_id, driverId);
  assert.match(databaseRow.rows[0].storage_key, /^driver-documents\//);
  assert.equal(databaseRow.rows[0].pending_storage_key, null);
  process.stdout.write("Driver document verification passed: Manager access and uploads, Contract and Other categories with optional expiry, required expiry for licence and identity documents, optional Carte Vitale expiry, legacy missing-expiry correction alerts with readable files, authorized Tigris upload/retrieval, file type/size enforcement, and denied cross-tenant, altered-parent, forged-tenant, and driver uploads.\n");
} finally {
  const rows = await pool.query(
    "SELECT storage_key, pending_storage_key FROM driver_document WHERE tenant_id = ANY($1::text[])",
    [tenants],
  ).catch(() => ({ rows: [] }));
  for (const row of rows.rows) {
    for (const key of [row.storage_key, row.pending_storage_key].filter(Boolean)) {
      await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
    }
  }
  await pool.query("DELETE FROM driver_document WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM driver WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
  storage.destroy();
}
