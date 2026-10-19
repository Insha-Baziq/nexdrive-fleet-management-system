import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "TIGRIS_BUCKET", "TIGRIS_ACCESS_KEY_ID", "TIGRIS_SECRET_ACCESS_KEY"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error("Local app and private storage configuration is required for archive verification.");
const origin = process.env.BETTER_AUTH_URL;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const auth = betterAuth({
  baseURL: origin, secret: process.env.BETTER_AUTH_SECRET,
  database: { dialect: new PostgresDialect({ pool }), type: "postgres" },
  emailAndPassword: { enabled: true },
  user: { additionalFields: {
    tenantId: { type: "string", required: false, input: false },
    appRole: { type: ["administrator", "fleet_manager", "manager", "driver"], required: false, input: false },
  } },
});
const storage = new S3Client({
  endpoint: process.env.TIGRIS_ENDPOINT || "https://t3.storage.dev", region: "auto",
  credentials: { accessKeyId: process.env.TIGRIS_ACCESS_KEY_ID, secretAccessKey: process.env.TIGRIS_SECRET_ACCESS_KEY },
});
const bucket = process.env.TIGRIS_BUCKET;
const runId = randomUUID();
const tenantA = randomUUID(), tenantB = randomUUID();
const driverRequiredFields = {
  dateOfBirth: "1990-08-15", streetNumber: "12 bis", streetName: "Rue de la Paix", postalCode: "75002", city: "Paris",
};
const tenants = [tenantA, tenantB];
const password = randomBytes(24).toString("base64url");
const users = [
  { role: "administrator", tenant: tenantA, name: "Archive Administrator" },
  { role: "fleet_manager", tenant: tenantA, name: "Archive Fleet Manager" },
  { role: "manager", tenant: tenantA, name: "Archive Manager" },
  { role: "driver", tenant: tenantA, name: "Archive Driver" },
  { role: "administrator", tenant: tenantB, name: "Archive Other Tenant" },
].map((user, index) => ({ ...user, email: `archive-${runId}-${index}@example.invalid` }));
const vehicleRegistration = `AR${runId.slice(0, 7).toUpperCase()}A`;
const secondVehicleRegistration = `AR${runId.slice(0, 7).toUpperCase()}B`;
const raceVehicleRegistration = `AR${runId.slice(0, 7).toUpperCase()}C`;
const raceDriverName = `Archive Race ${runId.slice(0, 8)}`;
const pdf = Buffer.from("%PDF-1.4\nNexDrive archive retention test\n%%EOF\n");

async function request(path, method = "GET", cookie, body) {
  const response = await fetch(origin + path, {
    method,
    headers: Object.assign({}, cookie ? { cookie } : {}, body !== undefined ? { "content-type": "application/json", origin } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json()
    : path.includes("/content") ? await response.arrayBuffer() : await response.text();
  return { status: response.status, data, response };
}

async function signIn(email) {
  const result = await request("/api/auth/sign-in/email", "POST", null, { email, password });
  assert.equal(result.status, 200);
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

async function uploadDocument(cookie, route, details) {
  const prepared = await request(route, "POST", cookie, {
    name: details.name, category: details.category, expiryDate: details.expiryDate ?? null,
    ...(details.visibleToDriver === undefined ? {} : { visibleToDriver: details.visibleToDriver }),
    fileName: "retention.pdf", fileSize: pdf.length,
  });
  assert.equal(prepared.status, 201, JSON.stringify(prepared.data));
  const upload = prepared.data.upload;
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append("file", new Blob([pdf], { type: "application/pdf" }), "retention.pdf");
  const uploaded = await fetch(upload.uploadUrl, { method: "POST", body: form });
  assert.ok(uploaded.ok, `Tigris upload returned ${uploaded.status}`);
  assert.equal((await request(`${route}/${upload.id}/complete`, "POST", cookie)).status, 200);
  return upload.id;
}

const startedAt = new Date(Date.now() - 15 * 60_000).toISOString();
let fixtureSetupStarted = false;
try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Archive QA A'), ($2, 'Archive QA B')", tenants);
  fixtureSetupStarted = true;
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2, "emailVerified"=true WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = saved.rows[0].id;
  }
  const [admin, fleet, manager, driver, otherAdmin] = await Promise.all(users.map((user) => signIn(user.email)));
  const suffix = runId.slice(0, 6).toUpperCase();
  const vehicle = (await request("/api/vehicles", "POST", admin, { registration: vehicleRegistration, make: "Renault", model: "Clio", ownershipType: "owned" })).data.vehicle.id;
  const otherVehicle = (await request("/api/vehicles", "POST", otherAdmin, { registration: `OTH${suffix}A`, make: "Peugeot", model: "208", ownershipType: "owned" })).data.vehicle.id;
  const siblingVehicle = (await request("/api/vehicles", "POST", fleet, { registration: secondVehicleRegistration, make: "Citroën", model: "C3", ownershipType: "owned" })).data.vehicle.id;
  const driverRecord = (await request("/api/drivers", "POST", fleet, { fullName: `Archive Driver ${suffix}`, userId: users[3].id, ...driverRequiredFields })).data.driver.id;
  const otherDriver = (await request("/api/drivers", "POST", otherAdmin, { fullName: `Other Archive ${suffix}`, ...driverRequiredFields })).data.driver.id;
  const siblingDriver = (await request("/api/drivers", "POST", fleet, { fullName: `Archive Sibling ${suffix}`, ...driverRequiredFields })).data.driver.id;

  const vehicleDocumentId = await uploadDocument(admin, `/api/vehicles/${vehicle}/documents`, {
    name: "Archived vehicle record", category: "registration", visibleToDriver: false,
  });
  const driverDocumentId = await uploadDocument(fleet, `/api/drivers/${driverRecord}/documents`, {
    name: "Archived driver record", category: "identity_document", expiryDate: "2030-03-14",
  });
  const assignment = await request("/api/assignments", "POST", admin, { vehicleId: vehicle, driverId: driverRecord, startedAt });
  assert.equal(assignment.status, 201);
  const assignmentId = assignment.data.assignment.id;

  assert.equal((await request(`/api/vehicles/${vehicle}/archive`, "POST")).status, 401, "anonymous archive is denied");
  assert.equal((await request(`/api/vehicles/${vehicle}/archive`, "POST", manager)).status, 403, "Manager archive is denied");
  assert.equal((await request(`/api/drivers/${driverRecord}/archive`, "POST", driver)).status, 403, "Driver archive is denied");
  assert.equal((await request(`/api/vehicles/${vehicle}/archive`, "POST", otherAdmin)).status, 404, "cross-tenant vehicle ID is hidden");
  assert.equal((await request(`/api/drivers/${driverRecord}/archive`, "POST", otherAdmin)).status, 404, "cross-tenant driver ID is hidden");
  assert.equal((await request(`/api/vehicles/${otherVehicle}/archive`, "POST", admin)).status, 404, "altered cross-tenant vehicle parent is hidden");
  assert.equal((await request(`/api/drivers/${otherDriver}/archive`, "POST", fleet)).status, 404, "altered cross-tenant driver parent is hidden");
  assert.equal((await request("/api/vehicles/not-a-uuid/archive", "POST", admin)).status, 404);
  assert.equal((await request(`/api/vehicles/${vehicle}/archive`, "POST", admin)).status, 409, "an active assignment blocks vehicle archive");
  assert.equal((await request(`/api/drivers/${driverRecord}/archive`, "POST", fleet)).status, 409, "an active assignment blocks driver archive");

  const journalEntry = await request(`/api/assignments/history/${assignmentId}`, "GET", manager);
  assert.equal(journalEntry.status, 200);
  const endRoute = `/api/assignments/history/${assignmentId}/end`;
  assert.equal((await request(endRoute, "POST", manager, { endedAt: new Date().toISOString(), reason: "Denied role" })).status, 403);
  assert.equal((await request(endRoute, "POST", driver, { endedAt: new Date().toISOString(), reason: "Denied role" })).status, 403);
  assert.equal((await request(endRoute, "POST", otherAdmin, { endedAt: new Date().toISOString(), reason: "Wrong tenant" })).status, 404);
  assert.equal((await request(endRoute, "POST", fleet, { endedAt: new Date(Date.now() + 5 * 60_000).toISOString(), reason: "Future" })).status, 400);
  assert.equal((await request(endRoute, "POST", fleet, { endedAt: startedAt, reason: "Before or equal to start" })).status, 400);
  assert.equal((await request(endRoute, "POST", fleet, { endedAt: new Date().toISOString(), reason: "  " })).status, 400);
  assert.equal((await request(endRoute, "POST", fleet, { endedAt: new Date().toISOString(), reason: "x".repeat(501) })).status, 400);
  assert.equal((await request(endRoute, "POST", fleet, { endedAt: new Date().toISOString(), reason: "Close vehicle return", tenantId: tenantB })).status, 400,
    "caller-supplied tenant fields are rejected");
  const endedAt = new Date().toISOString();
  assert.equal((await request(endRoute, "POST", fleet, { endedAt, reason: "Vehicle returned" })).status, 200,
    "Fleet Manager can end an assignment with a required reason");
  assert.equal((await request(endRoute, "POST", admin, { endedAt, reason: "Try to end twice" })).status, 409);
  const journal = await request("/api/assignments/history", "GET", manager);
  const ended = journal.data.assignments.find((entry) => entry.id === assignmentId);
  assert.ok(ended?.ended_at);
  assert.equal(ended.end_reason, "Vehicle returned");
  const endingActor = await pool.query("SELECT ended_by_user_id FROM assignment WHERE tenant_id=$1 AND id=$2", [tenantA, assignmentId]);
  assert.equal(endingActor.rows[0].ended_by_user_id, users[1].id, "ending actor is retained in the assignment row");

  assert.equal((await request(`/api/vehicles/${vehicle}/archive`, "POST", admin)).status, 200);
  assert.equal((await request(`/api/drivers/${driverRecord}/archive`, "POST", fleet)).status, 200);
  assert.equal((await request(`/api/vehicles/${vehicle}/archive`, "POST", admin)).status, 409, "duplicate archive is explicit");
  const managerRestore = await request(`/api/drivers/${driverRecord}/restore`, "POST", manager);
  assert.equal(managerRestore.status, 200, "Manager can restore a driver record");
  assert.equal(managerRestore.data.driver.archived, false);
  assert.equal((await request(`/api/drivers/${driverRecord}/archive`, "POST", manager)).status, 200,
    "Manager can archive a driver record before the archived-record retention checks");
  assert.equal((await request(`/api/drivers/${driverRecord}/restore`, "POST", otherAdmin)).status, 404);

  const freshAdmin = await signIn(users[0].email);
  const activeVehicles = await request("/api/vehicles", "GET", freshAdmin);
  const archivedVehicles = await request("/api/vehicles?view=archived", "GET", freshAdmin);
  const activeDrivers = await request("/api/drivers", "GET", freshAdmin);
  const archivedDrivers = await request("/api/drivers?view=archived", "GET", freshAdmin);
  assert.ok(!activeVehicles.data.vehicles.some((item) => item.id === vehicle));
  assert.ok(archivedVehicles.data.vehicles.some((item) => item.id === vehicle && item.archived_at));
  assert.ok(!activeDrivers.data.drivers.some((item) => item.id === driverRecord));
  assert.ok(archivedDrivers.data.drivers.some((item) => item.id === driverRecord && item.archived_at));
  assert.equal((await request("/api/vehicles?view=archived", "GET", manager)).status, 403);
  assert.equal((await request("/api/drivers?view=invalid", "GET", freshAdmin)).status, 400);
  assert.equal((await request("/api/drivers?view=archived", "GET", driver)).status, 403);
  assert.equal((await request(`/api/vehicles/${vehicle}`, "PATCH", freshAdmin, { registration: `AR${suffix}Z`, make: "Renault", model: "Clio", ownershipType: "owned", year: null, technicalInspectionDate: null, insuranceCompany: null, insuranceExpiryDate: null, bonusMalus: null })).status, 404,
    "archived core records cannot be edited until restored");
  assert.equal((await request(`/api/vehicles/${vehicle}/documents`, "POST", freshAdmin, {
    name: "No new archive upload", category: "other", expiryDate: null, visibleToDriver: false, fileName: "x.pdf", fileSize: pdf.length,
  })).status, 409, "new vehicle documents are blocked while archived");
  assert.equal((await request(`/api/drivers/${driverRecord}/documents`, "POST", fleet, {
    name: "No new archive upload", category: "identity_document", expiryDate: "2030-03-14", fileName: "x.pdf", fileSize: pdf.length,
  })).status, 409, "new driver documents are blocked while archived");

  const vehicleDetail = await request(`/vehicles/${vehicle}?view=archived`, "GET", freshAdmin);
  const driverDetail = await request(`/drivers/${driverRecord}?view=archived`, "GET", freshAdmin);
  assert.equal(vehicleDetail.status, 200, "archived vehicle details remain available to staff");
  assert.equal(driverDetail.status, 200, "archived driver details remain available to staff");
  assert.ok(vehicleDetail.data.includes("Archived"));
  assert.ok(driverDetail.data.includes("Archived"));
  const retainedVehicleDocuments = await request(`/api/vehicles/${vehicle}/documents`, "GET", freshAdmin);
  const retainedDriverDocuments = await request(`/api/drivers/${driverRecord}/documents`, "GET", freshAdmin);
  assert.equal(retainedVehicleDocuments.status, 200);
  assert.ok(retainedVehicleDocuments.data.documents.some((document) => document.id === vehicleDocumentId));
  assert.equal(retainedDriverDocuments.status, 200);
  assert.ok(retainedDriverDocuments.data.documents.some((document) => document.id === driverDocumentId));
  assert.deepEqual(Buffer.from((await request(`/api/vehicles/${vehicle}/documents/${vehicleDocumentId}/content`, "GET", freshAdmin)).data), pdf,
    "vehicle document bytes remain readable after archive");
  assert.deepEqual(Buffer.from((await request(`/api/drivers/${driverRecord}/documents/${driverDocumentId}/content`, "GET", freshAdmin)).data), pdf,
    "driver document bytes remain readable after archive");
  assert.equal((await request(`/api/vehicles/${siblingVehicle}/documents/${vehicleDocumentId}/content`, "GET", freshAdmin)).status, 404,
    "altered parent ID does not expose archived vehicle files");
  assert.equal((await request(`/api/drivers/${siblingDriver}/documents/${driverDocumentId}/content`, "GET", freshAdmin)).status, 404,
    "altered parent ID does not expose archived driver files");

  const workspace = await request("/my-vehicle", "GET", driver);
  assert.equal(workspace.status, 200);
  assert.ok(workspace.data.includes("Votre dossier conducteur n’est pas complet"), "archived linked drivers lose Driver workspace access");
  assert.equal((await request("/api/assignments", "POST", freshAdmin, { vehicleId: vehicle, driverId: siblingDriver, startedAt: new Date(Date.now() + 2_000).toISOString() })).status, 409,
    "archived vehicles cannot be assigned even with an altered request");
  assert.equal((await request("/api/assignments", "POST", freshAdmin, { vehicleId: siblingVehicle, driverId: driverRecord, startedAt: new Date(Date.now() + 2_000).toISOString() })).status, 409,
    "archived drivers cannot be assigned even with an altered request");

  assert.equal((await request(`/api/vehicles/${vehicle}/restore`, "POST", fleet)).status, 200);
  assert.equal((await request(`/api/drivers/${driverRecord}/restore`, "POST", admin)).status, 200);
  assert.ok((await request("/api/vehicles", "GET", admin)).data.vehicles.some((item) => item.id === vehicle));
  assert.ok((await request("/api/drivers", "GET", fleet)).data.drivers.some((item) => item.id === driverRecord));
  assert.deepEqual(Buffer.from((await request(`/api/vehicles/${vehicle}/documents/${vehicleDocumentId}/content`, "GET", admin)).data), pdf,
    "restoring a record leaves its private document intact");

  // Archive and assignment creation share a tenant transaction lock. Exactly one may win.
  const raceVehicle = (await request("/api/vehicles", "POST", admin, { registration: raceVehicleRegistration, make: "Dacia", model: "Jogger", ownershipType: "owned" })).data.vehicle.id;
  const raceDriver = (await request("/api/drivers", "POST", fleet, { fullName: raceDriverName, ...driverRequiredFields })).data.driver.id;
  const raceStartedAt = new Date(Date.now() - 2 * 60_000).toISOString();
  const race = await Promise.all([
    request(`/api/vehicles/${raceVehicle}/archive`, "POST", admin),
    request("/api/assignments", "POST", fleet, { vehicleId: raceVehicle, driverId: raceDriver, startedAt: raceStartedAt }),
  ]);
  assert.equal(race.filter((result) => result.status >= 200 && result.status < 300).length, 1, "archive and new assignment cannot both succeed");
  assert.ok(race.some((result) => result.status === 409), "one side of the archive/assignment race is rejected");
  const racedArchived = (await pool.query("SELECT archived_at IS NOT NULL AS archived FROM vehicle WHERE tenant_id=$1 AND id=$2", [tenantA, raceVehicle])).rows[0].archived;
  const racedActiveAssignment = (await pool.query("SELECT 1 FROM assignment WHERE tenant_id=$1 AND vehicle_id=$2 AND ended_at IS NULL", [tenantA, raceVehicle])).rows.length > 0;
  assert.notEqual(racedArchived && racedActiveAssignment, true, "no archived vehicle retains an active assignment");

  assert.equal((await request("/vehicles?view=archived", "GET", manager)).status, 404, "Manager cannot enumerate archived vehicles");
  assert.equal((await request("/drivers?view=archived", "GET", driver)).status, 404, "Driver cannot enumerate archived drivers");
  process.stdout.write("Record archive verification passed: end-first rule and journal history; soft archive/restore; active versus archived list and picker sources; private document/history retention; race-safe assignments; four-role and cross-tenant boundaries; and mutation denial while archived.\n");
} finally {
  if (fixtureSetupStarted) {
    const vehicleDocuments = await pool.query("SELECT storage_key, pending_storage_key FROM vehicle_document WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => ({ rows: [] }));
    const driverDocuments = await pool.query("SELECT storage_key, pending_storage_key FROM driver_document WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => ({ rows: [] }));
    for (const row of [...vehicleDocuments.rows, ...driverDocuments.rows]) {
      for (const key of [row.storage_key, row.pending_storage_key].filter(Boolean)) {
        await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});
      }
    }
    await pool.query("DELETE FROM assignment WHERE tenant_id = ANY($1::text[])", [tenants]);
    await pool.query("DELETE FROM vehicle_document WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => {});
    await pool.query("DELETE FROM driver_document WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => {});
    await pool.query("DELETE FROM driver WHERE tenant_id = ANY($1::text[])", [tenants]);
    await pool.query("DELETE FROM vehicle WHERE tenant_id = ANY($1::text[])", [tenants]);
    await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]);
    await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [tenants]);
  }
  storage.destroy();
  await pool.end();
}
