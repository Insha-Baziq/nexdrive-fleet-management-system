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
const users = ["administrator", "fleet_manager", "manager", "driver", "driver", "administrator"].map((role, index) => ({
  role,
  tenant: index === 5 ? tenantB : tenantA,
  name: "Driver paperwork QA " + index,
  email: `driver-paperwork-${runId}-${index}@example.invalid`,
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

const pdf = Buffer.from("%PDF-1.4\nNexDrive temporary private paperwork verification fixture\n%%EOF\n");

async function uploadFile(cookie, parentPath, metadata) {
  const prepared = await request(parentPath, "POST", cookie, {
    name: metadata.name,
    category: metadata.category,
    expiryDate: metadata.expiryDate ?? null,
    ...(metadata.visibleToDriver === undefined ? {} : { visibleToDriver: metadata.visibleToDriver }),
    fileName: metadata.fileName,
    fileSize: pdf.length,
  });
  assert.equal(prepared.status, 201, JSON.stringify(prepared.data));
  const upload = prepared.data.upload;
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append("file", new Blob([pdf], { type: "application/pdf" }), metadata.fileName);
  const uploaded = await fetch(upload.uploadUrl, { method: "POST", body: form });
  assert.ok(uploaded.ok, "Tigris accepts the signed private upload");
  const complete = await request(`${parentPath}/${upload.id}/complete`, "POST", cookie);
  assert.equal(complete.status, 200, JSON.stringify(complete.data));
  return upload.id;
}

async function createVehicle(cookie, registration, name) {
  const created = await request("/api/vehicles", "POST", cookie, {
    registration, make: "Renault", model: name, ownershipType: "owned",
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  return created.data.vehicle.id;
}

const createdVehicles = [];
const createdDrivers = [];
try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Temporary Driver Paperwork QA A'), ($2, 'Temporary Driver Paperwork QA B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({
      body: { name: user.name, email: user.email, password },
      headers: new Headers({ origin }),
    });
    const saved = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2, "emailVerified"=true WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = saved.rows[0].id;
  }
  const [admin, fleet, manager, driver, unassignedDriver, otherAdmin] = await Promise.all(users.map((user) => signIn(user.email)));
  const [vehicleId, nextVehicleId] = await Promise.all([
    createVehicle(admin, `PQA-${runId.slice(0, 6)}-A`, "Clio"),
    createVehicle(admin, `PQA-${runId.slice(0, 6)}-B`, "208"),
  ]);
  createdVehicles.push(vehicleId, nextVehicleId);

  const driverId = randomUUID();
  const siblingDriverId = randomUUID();
  const otherTenantDriverId = randomUUID();
  createdDrivers.push(driverId, siblingDriverId, otherTenantDriverId);
  await pool.query(
    "INSERT INTO driver (id, tenant_id, user_id, full_name) VALUES ($1, $2, $3, 'Assigned QA driver'), ($4, $2, $5, 'Unassigned QA driver'), ($6, $7, NULL, 'Other tenant QA driver')",
    [driverId, tenantA, users[3].id, siblingDriverId, users[4].id, otherTenantDriverId, tenantB],
  );
  const now = new Date();
  await pool.query(
    `INSERT INTO assignment (id, tenant_id, vehicle_id, driver_id, started_at, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5::timestamptz - INTERVAL '2 minutes', $6)`,
    [randomUUID(), tenantA, vehicleId, driverId, now.toISOString(), users[0].id],
  );

  const ownLicenceId = await uploadFile(admin, `/api/drivers/${driverId}/documents`, {
    name: "QA personal licence", category: "driving_licence", expiryDate: "2030-03-14", fileName: "qa-licence.pdf",
  });
  const siblingId = await uploadFile(fleet, `/api/drivers/${siblingDriverId}/documents`, {
    name: "QA sibling identity", category: "identity_document", expiryDate: "2030-03-14", fileName: "qa-sibling.pdf",
  });
  const unassignedId = await uploadFile(admin, `/api/drivers/${siblingDriverId}/documents`, {
    name: "QA unassigned identity", category: "identity_document", expiryDate: "2030-11-22", fileName: "qa-unassigned.pdf",
  });

  const vehicleDocPath = `/api/vehicles/${vehicleId}/documents`;
  const sharedVehicleDocumentId = await uploadFile(fleet, vehicleDocPath, {
    name: "QA driver-shared inspection", category: "inspection", expiryDate: "2030-05-30",
    visibleToDriver: true, fileName: "qa-shared-inspection.pdf",
  });
  const privateVehicleDocumentId = await uploadFile(admin, vehicleDocPath, {
    name: "QA staff-only registration", category: "registration", visibleToDriver: false,
    fileName: "qa-staff-only.pdf",
  });

  const driverDocsPath = `/api/drivers/${driverId}/documents`;
  const ownDocuments = await request(driverDocsPath, "GET", driver);
  assert.equal(ownDocuments.status, 200, "a Driver can list paperwork attached to their linked Driver record");
  assert.deepEqual(new Set(ownDocuments.data.documents.map((item) => item.id)), new Set([ownLicenceId]));
  assert.equal(ownDocuments.data.documents[0].category, "driving_licence");
  assert.equal(ownDocuments.data.documents[0].expiry_date, "2030-03-14");
  const ownContent = await request(`${driverDocsPath}/${ownLicenceId}/content`, "GET", driver);
  assert.equal(ownContent.status, 200, "Driver can open their own administrative document");
  assert.deepEqual(ownContent.data, pdf);
  assert.equal(ownContent.response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal((await request(`/api/drivers/${siblingDriverId}/documents`, "GET", driver)).status, 404, "Driver cannot list another Driver record");
  assert.equal((await request(`/api/drivers/${siblingDriverId}/documents/${siblingId}/content`, "GET", driver)).status, 404, "Driver cannot open another Driver's document");
  assert.equal((await request(`${driverDocsPath}/${siblingId}/content`, "GET", driver)).status, 404, "altered document IDs cannot disclose another Driver's file");
  assert.equal((await request(driverDocsPath, "GET", manager)).status, 200, "Manager can list paperwork in their tenant");
  const managerContent = await request(`${driverDocsPath}/${ownLicenceId}/content`, "GET", manager);
  assert.equal(managerContent.status, 200, "Manager can open paperwork in their tenant");
  assert.deepEqual(managerContent.data, pdf);
  assert.equal((await request(driverDocsPath, "POST", driver, { name: "No", category: "driving_licence", fileName: "no.pdf", fileSize: pdf.length })).status, 403, "Driver self-upload remains disabled");

  const vehicleList = await request(vehicleDocPath, "GET", driver);
  assert.equal(vehicleList.status, 200, "Driver can list documents for their current vehicle");
  assert.deepEqual(new Set(vehicleList.data.documents.map((item) => item.id)), new Set([sharedVehicleDocumentId]));
  const sharedContent = await request(`${vehicleDocPath}/${sharedVehicleDocumentId}/content`, "GET", driver);
  assert.equal(sharedContent.status, 200, "Driver can open a currently assigned vehicle document that was shared");
  assert.deepEqual(sharedContent.data, pdf);
  assert.equal((await request(`${vehicleDocPath}/${privateVehicleDocumentId}/content`, "GET", driver)).status, 404, "Driver cannot open an unshared vehicle document");
  assert.equal((await request(`/api/vehicles/${nextVehicleId}/documents`, "GET", driver)).status, 404, "Driver cannot list documents for another vehicle");

  await pool.query("UPDATE vehicle_document SET visible_to_driver = false WHERE tenant_id = $1 AND id = $2", [tenantA, sharedVehicleDocumentId]);
  assert.equal((await request(vehicleDocPath, "GET", driver)).data.documents.some((item) => item.id === sharedVehicleDocumentId), false, "revoked visibility removes the row on the next request");
  assert.equal((await request(`${vehicleDocPath}/${sharedVehicleDocumentId}/content`, "GET", driver)).status, 404, "revoked visibility immediately denies file access");
  await pool.query("UPDATE vehicle_document SET visible_to_driver = true WHERE tenant_id = $1 AND id = $2", [tenantA, sharedVehicleDocumentId]);

  const freshDriver = await signIn(users[3].email);
  const freshOwnContent = await request(`${driverDocsPath}/${ownLicenceId}/content`, "GET", freshDriver);
  assert.equal(freshOwnContent.status, 200, "personal paperwork is available after a fresh sign-in");
  await pool.query(
    `UPDATE assignment SET ended_at = CURRENT_TIMESTAMP, end_reason = 'Temporary QA reassignment', ended_by_user_id = $3
     WHERE tenant_id = $1 AND vehicle_id = $2 AND driver_id = $4 AND ended_at IS NULL`,
    [tenantA, vehicleId, users[0].id, driverId],
  );
  await pool.query(
    `INSERT INTO assignment (id, tenant_id, vehicle_id, driver_id, started_at, created_by_user_id)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)`,
    [randomUUID(), tenantA, nextVehicleId, driverId, users[0].id],
  );
  assert.equal((await request(vehicleDocPath, "GET", freshDriver)).status, 404, "previous vehicle document list is unavailable after reassignment");
  assert.equal((await request(`${vehicleDocPath}/${sharedVehicleDocumentId}/content`, "GET", freshDriver)).status, 404, "previous vehicle document URL is unavailable after reassignment");

  const unassignedDocsPath = `/api/drivers/${siblingDriverId}/documents`;
  const unassignedDocuments = await request(unassignedDocsPath, "GET", unassignedDriver);
  assert.equal(unassignedDocuments.status, 200, "an unassigned Driver can still see personal paperwork");
  assert.deepEqual(new Set(unassignedDocuments.data.documents.map((item) => item.id)), new Set([siblingId, unassignedId]));
  const unassignedContent = await request(`${unassignedDocsPath}/${unassignedId}/content`, "GET", unassignedDriver);
  assert.equal(unassignedContent.status, 200, "an unassigned Driver can open their own paperwork");
  assert.deepEqual(unassignedContent.data, pdf);
  assert.equal((await request(`/api/vehicles/${vehicleId}/documents`, "GET", unassignedDriver)).status, 404, "an unassigned Driver has no vehicle-document list");

  assert.equal((await request(`/api/drivers/${driverId}/documents`, "GET", otherAdmin)).status, 404, "another tenant cannot list driver paperwork");
  assert.equal((await request(`/api/drivers/${driverId}/documents/${ownLicenceId}/content`, "GET", otherAdmin)).status, 404, "another tenant cannot open driver paperwork");
  assert.equal((await request(`${vehicleDocPath}/${sharedVehicleDocumentId}/content`, "GET", otherAdmin)).status, 404, "another tenant cannot open vehicle paperwork");

  process.stdout.write("Driver paperwork verification passed: own administrative documents persist and open after sign-in; currently assigned, explicitly shared vehicle documents are available; unshared, other-driver, prior-vehicle, and cross-tenant files are denied; revoked visibility takes effect immediately; unassigned Drivers retain only their own paperwork.\n");
} finally {
  const driverFiles = await pool.query(
    "SELECT storage_key, pending_storage_key FROM driver_document WHERE tenant_id = ANY($1::text[])", [tenants],
  ).catch(() => ({ rows: [] }));
  const vehicleFiles = await pool.query(
    "SELECT storage_key, pending_storage_key FROM vehicle_document WHERE tenant_id = ANY($1::text[])", [tenants],
  ).catch(() => ({ rows: [] }));
  for (const row of [...driverFiles.rows, ...vehicleFiles.rows]) {
    for (const key of [row.storage_key, row.pending_storage_key].filter(Boolean)) {
      await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
    }
  }
  await pool.query("DELETE FROM driver_document WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle_document WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM assignment WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM driver WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
  storage.destroy();
}
