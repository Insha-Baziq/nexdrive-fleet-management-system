import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.BETTER_AUTH_SECRET || !process.env.DATABASE_URL) {
  throw new Error("Local auth and database environment is required");
}
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
const runId = randomUUID();
const tenantA = randomUUID(), tenantB = randomUUID();
const tenants = [tenantA, tenantB];
const password = randomBytes(24).toString("base64url");
const users = [
  { role: "administrator", tenant: tenantA, name: "Driver QA Admin" },
  { role: "fleet_manager", tenant: tenantA, name: "Driver QA Fleet" },
  { role: "manager", tenant: tenantA, name: "Driver QA Manager" },
  { role: "driver", tenant: tenantA, name: "Driver QA Candidate" },
  { role: "driver", tenant: tenantA, name: "Driver QA Second Candidate" },
  { role: "administrator", tenant: tenantB, name: "Driver QA Other Tenant Admin" },
  { role: "driver", tenant: tenantB, name: "Driver QA Other Tenant Account" },
].map((user, index) => ({ ...user, email: `driver-record-${runId}-${index}@example.invalid` }));

async function request(path, method = "GET", cookie, body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json", origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, data, response };
}
async function signIn(email) {
  const result = await request("/api/auth/sign-in/email", "POST", null, { email, password });
  assert.equal(result.status, 200, `sign-in failed for ${email}`);
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Driver Records QA A'), ($2, 'Driver Records QA B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const result = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2, "emailVerified"=true WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = result.rows[0].id;
  }
  const [admin, fleet, manager, driverCandidate, , otherAdmin] = await Promise.all(users.slice(0, 6).map((user) => signIn(user.email)));
  const personalDetails = {
    dateOfBirth: "1990-08-15",
    streetNumber: "12 bis",
    streetName: "Rue de la Paix",
    postalCode: "75002",
    city: "Paris",
  };
  const base = {
    fullName: "Unlinked Driver", licenceNumber: "QA-12345", licenceExpiryDate: "2028-02-29",
    userId: null, ...personalDetails,
  };

  assert.equal((await request("/api/drivers", "GET")).status, 401, "anonymous list access is denied");
  assert.equal((await request("/api/drivers", "POST", null, base)).status, 401, "anonymous create is denied");
  assert.equal((await request("/api/drivers", "GET", manager)).status, 200, "Manager can browse the full driver list");
  assert.equal((await request("/api/drivers", "GET", driverCandidate)).status, 403, "Driver cannot browse the full driver list");
  assert.equal((await request("/drivers", "GET", manager)).status, 200, "Manager can open the driver page");
  assert.equal((await request("/api/drivers/import?format=csv", "GET", manager)).status, 200, "Manager can download the driver import template");
  const managerCreated = await request("/api/drivers", "POST", manager, { ...base, fullName: "Manager-created Driver", licenceNumber: "QA-MANAGER-001" });
  assert.equal(managerCreated.status, 201, JSON.stringify(managerCreated.data));
  assert.equal(managerCreated.data.driver.full_name, "Manager-created Driver", "Manager can create driver records");
  assert.equal((await request("/api/drivers", "POST", driverCandidate, base)).status, 403, "Driver cannot create driver records");

  for (const invalid of [
    { ...base, fullName: "   " },
    { ...base, fullName: "x".repeat(161) },
    { ...base, licenceNumber: "x".repeat(81) },
    { ...base, licenceExpiryDate: "2026-02-29" },
    { ...base, dateOfBirth: "2026-02-30" },
    { ...base, dateOfBirth: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) },
    { ...base, streetNumber: "  " },
    { ...base, streetName: "x".repeat(161) },
    { ...base, postalCode: "" },
    { ...base, city: "x".repeat(121) },
    { ...base, tenantId: tenantB },
    { ...base, createdByUserId: users[5].id },
  ]) {
    assert.equal((await request("/api/drivers", "POST", admin, invalid)).status, 400, "invalid or forged driver data is rejected");
  }
  const tooLongEmailLink = await request("/api/drivers", "POST", admin, { ...base, userId: "x".repeat(129) });
  assert.equal(tooLongEmailLink.status, 400, "oversized account IDs are rejected");

  const maxName = { ...base, fullName: "x".repeat(160), licenceNumber: "L".repeat(80) };
  const created = await request("/api/drivers", "POST", admin, maxName);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const driverId = created.data.driver.id;
  assert.equal(created.data.driver.date_of_birth, personalDetails.dateOfBirth);
  assert.equal(created.data.driver.street_number, personalDetails.streetNumber);
  assert.equal(created.data.driver.street_name, personalDetails.streetName);
  assert.equal(created.data.driver.postal_code, personalDetails.postalCode);
  assert.equal(created.data.driver.city, personalDetails.city);
  assert.equal(created.data.driver.full_name.length, 160, "maximum accepted name persists intact");
  assert.equal(created.data.driver.licence_number.length, 80, "maximum accepted licence number persists intact");
  assert.equal(created.data.driver.user_id, null, "driver records may exist without a login");
  assert.equal(created.data.driver.user_email, null);
  assert.equal((await request(`/api/drivers/${driverId}`, "GET", fleet)).status, 200);
  assert.equal((await request(`/api/drivers/${driverId}`, "GET", manager)).status, 200, "Manager can inspect driver details");
  assert.equal((await request(`/drivers/${driverId}`, "GET", manager)).status, 200, "Manager can open the driver detail page");
  assert.equal((await request(`/api/drivers/${driverId}`, "GET", otherAdmin)).status, 404, "another tenant cannot read this driver");
  assert.equal((await request(`/api/drivers/${driverId}`, "PATCH", otherAdmin, base)).status, 404, "another tenant cannot mutate this driver");
  const managerUpdated = await request(`/api/drivers/${driverId}`, "PATCH", manager, { ...base, fullName: "Manager-updated Driver" });
  assert.equal(managerUpdated.status, 200, JSON.stringify(managerUpdated.data));
  assert.equal(managerUpdated.data.driver.full_name, "Manager-updated Driver", "Manager can edit driver records");
  assert.equal((await request(`/api/drivers/${driverId}`, "PATCH", driverCandidate, base)).status, 403);

  const changedDetails = {
    dateOfBirth: "1985-02-03", streetNumber: "4", streetName: "Avenue Victor Hugo",
    postalCode: "69002", city: "Lyon",
  };
  const linked = await request(`/api/drivers/${driverId}`, "PATCH", fleet, {
    ...base, ...changedDetails, fullName: "Linked Driver", userId: users[3].id,
  });
  assert.equal(linked.status, 200, JSON.stringify(linked.data));
  assert.equal(linked.data.driver.user_id, users[3].id);
  assert.equal(linked.data.driver.user_email, users[3].email);
  assert.equal(linked.data.driver.date_of_birth, changedDetails.dateOfBirth);
  assert.equal(linked.data.driver.street_number, changedDetails.streetNumber);
  assert.equal(linked.data.driver.street_name, changedDetails.streetName);
  assert.equal(linked.data.driver.postal_code, changedDetails.postalCode);
  assert.equal(linked.data.driver.city, changedDetails.city);

  const secondRecord = await request("/api/drivers", "POST", admin, { ...base, fullName: "Second Record" });
  assert.equal(secondRecord.status, 201);
  const secondDriverId = secondRecord.data.driver.id;
  assert.equal((await request(`/api/drivers/${secondDriverId}`, "PATCH", admin, { ...base, userId: users[3].id })).status, 400, "one account cannot be linked to multiple records");
  assert.equal((await request(`/api/drivers/${secondDriverId}`, "PATCH", admin, { ...base, userId: users[2].id })).status, 400, "a non-Driver account cannot be linked");
  assert.equal((await request(`/api/drivers/${secondDriverId}`, "PATCH", admin, { ...base, userId: users[6].id })).status, 400, "a cross-tenant account cannot be linked");
  assert.equal((await request(`/api/drivers/${driverId}`, "PATCH", admin, { ...base, fullName: "Forged Driver", driverId: secondDriverId })).status, 400, "a body-supplied parent ID is rejected");

  const unlinked = await request(`/api/drivers/${driverId}`, "PATCH", admin, { ...base, fullName: "Unlinked Again", userId: null });
  assert.equal(unlinked.status, 200);
  assert.equal(unlinked.data.driver.user_id, null);
  assert.equal(unlinked.data.driver.user_email, null);
  const relinked = await request(`/api/drivers/${driverId}`, "PATCH", fleet, { ...base, fullName: "Relinked Driver", userId: users[4].id });
  assert.equal(relinked.status, 200);
  assert.equal(relinked.data.driver.user_email, users[4].email);
  const freshAdmin = await signIn(users[0].email);
  const persisted = await request(`/api/drivers/${driverId}`, "GET", freshAdmin);
  assert.equal(persisted.status, 200);
  assert.equal(persisted.data.driver.full_name, "Relinked Driver", "updated record persists after a new sign-in");
  assert.equal(persisted.data.driver.user_email, users[4].email);
  const list = await request("/api/drivers", "GET", freshAdmin);
  assert.equal(list.status, 200);
  assert.ok(list.data.drivers.some((entry) => entry.id === driverId && entry.user_email === users[4].email));
  assert.equal(list.data.drivers.length, 3, "only persisted records for this tenant are listed");
  assert.deepEqual((await request("/api/drivers", "GET", otherAdmin)).data.drivers, [], "other tenant list is isolated");
  assert.equal((await request(`/api/drivers/${driverId}`, "PATCH", admin, { ...base, fullName: "Invalid Date", licenceExpiryDate: "2027-02-29" })).status, 400);

  const legacyDriverId = randomUUID();
  await pool.query("INSERT INTO driver (id, tenant_id, full_name) VALUES ($1, $2, 'Legacy incomplete driver')", [legacyDriverId, tenantA]);
  const legacyRead = await request(`/api/drivers/${legacyDriverId}`, "GET", freshAdmin);
  assert.equal(legacyRead.status, 200, "legacy driver without the new nullable fields remains readable");
  assert.equal(legacyRead.data.driver.date_of_birth, null);
  const incompleteDetailPage = await request(`/drivers/${legacyDriverId}`, "GET", freshAdmin);
  assert.equal(incompleteDetailPage.status, 200);
  assert.match(incompleteDetailPage.data, /Driver information is incomplete/, "legacy detail page flags missing required information");
  const incompleteListPage = await request("/drivers", "GET", freshAdmin);
  assert.equal(incompleteListPage.status, 200);
  assert.ok(
    /Details incomplete|Informations à compléter/.test(incompleteListPage.data),
    "legacy driver list marks the record for completion in the rendered locale",
  );
  const completedLegacy = await request(`/api/drivers/${legacyDriverId}`, "PATCH", freshAdmin, {
    ...base, fullName: "Legacy driver completed",
  });
  assert.equal(completedLegacy.status, 200, JSON.stringify(completedLegacy.data));
  assert.equal(completedLegacy.data.driver.date_of_birth, personalDetails.dateOfBirth);
  assert.equal(completedLegacy.data.driver.city, personalDetails.city);
  const completedDetailPage = await request(`/drivers/${legacyDriverId}`, "GET", freshAdmin);
  assert.doesNotMatch(completedDetailPage.data, /Driver information is incomplete/, "completed legacy driver no longer shows the incomplete warning");

  process.stdout.write("Driver-record verification passed: required DOB/address validation and persistence, legacy driver completion, create/read/edit, max-length boundaries, optional login, eligible same-tenant Driver linking, duplicate/wrong-role/cross-tenant link denial, unlink/relink persistence, Manager driver access, remaining role authorization, and tenant isolation.\n");
} finally {
  await pool.query("DELETE FROM driver WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
}
