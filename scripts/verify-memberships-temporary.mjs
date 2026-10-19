import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { readFile } from "node:fs/promises";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.DATABASE_URL || !new URL(origin).hostname.match(/^(localhost|127\.0\.0\.1)$/)) throw new Error("Local verification only.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const suffix = randomUUID();
const password = randomBytes(24).toString("base64url");
const emails = [0, 1, 2, 3, 4].map((index) => `membership-${suffix}-${index}@example.invalid`);
const tenants = [];
const driverIds = [];
let vehicleId;
const jars = emails.map(() => new Map());

async function request(path, method = "GET", body, jar, originOverride = origin) {
  const response = await fetch(`${origin}${path}`, {
    method, redirect: "manual", headers: {
      origin: originOverride, ...(body ? { "content-type": "application/json" } : {}),
      ...(jar ? { cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") } : {}),
    }, body: body ? JSON.stringify(body) : undefined,
  });
  if (jar) for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";")[0]; const index = pair.indexOf("="); jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, data, response };
}

async function signIn(index) {
  const result = await request("/api/auth/sign-in/email", "POST", { email: emails[index], password }, jars[index]);
  assert.equal(result.status, 200, `Fixture sign-in succeeds: ${JSON.stringify(result.data)}`);
}

async function markFixtureEmailVerified(index) {
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE email=$1', [emails[index]]);
}

async function organization(index, label) {
  const result = await request("/api/onboarding/create", "POST", { organizationName: `Temporary Membership ${label} ${suffix}`, country: "FR", timezone: "Europe/Paris" }, jars[index]);
  assert.equal(result.status, 201, JSON.stringify(result.data)); tenants.push(result.data.tenantId); return result.data.tenantId;
}
async function issue(index, role, extra = {}) {
  const result = await request("/api/invitations", "POST", { role, ...extra }, jars[index]);
  assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data;
}
async function switchTo(index, tenantId) {
  assert.equal((await request("/api/organizations", "POST", { tenantId }, jars[index])).status, 200);
}

try {
  assert.equal((await request("/api/organizations")).status, 401);
  assert.equal((await request("/api/onboarding/account", "POST", { name: "Invalid", email: "invalid", password })).status, 400);
  assert.equal((await request("/api/onboarding/account", "POST", { name: "Invalid", email: emails[3], password: "short" })).status, 400);
  for (let index = 0; index < 3; index++) {
    assert.equal((await request("/api/onboarding/account", "POST", { name: `Temporary Membership User ${index}`, email: emails[index], password })).status, 201);
    await markFixtureEmailVerified(index);
    await signIn(index);
    assert.equal((await request("/api/organizations", "GET", undefined, jars[index])).data.organizations.length, 0, "Registration creates no membership");
  }
  const a = await organization(0, "A");
  const b = await organization(1, "B");
  const c = await organization(2, "C");
  const userId = (await pool.query('SELECT id FROM "user" WHERE email=$1', [emails[0]])).rows[0].id;
  const driverB = randomUUID(); driverIds.push(driverB);
  await pool.query("INSERT INTO driver(id,tenant_id,full_name) VALUES($1,$2,'Temporary Shared Driver B')", [driverB, b]);
  const invitation = await issue(1, "driver", { email: emails[0], targetDriverId: driverB });
  assert.equal((await request("/signup/join?code=" + encodeURIComponent(invitation.code))).status, 307, "Email link uses ordinary authentication");
  assert.equal((await request("/api/onboarding/invitation", "POST", { code: invitation.code })).status, 200);
  assert.equal((await pool.query("SELECT used_at FROM organization_invitation WHERE id=$1", [invitation.id])).rows[0].used_at, null, "Preview does not accept invitation");
  assert.equal((await request("/api/onboarding/join-existing", "POST", { code: invitation.code }, jars[2])).status, 400, "Recipient binding enforced");
  const accepted = await request("/api/onboarding/join-existing", "POST", { code: invitation.code, role: "administrator", tenantId: a }, jars[0]);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  let listing = (await request("/api/organizations", "GET", undefined, jars[0])).data;
  assert.equal(listing.activeTenantId, b);
  assert.deepEqual(listing.organizations.map((item) => [item.tenantId, item.role]).sort(), [[a, "administrator"], [b, "driver"]].sort());
  assert.equal((await request("/api/organization-users", "GET", undefined, jars[0])).status, 403, "Driver membership cannot inherit administrator role");
  assert.equal((await request("/api/vehicles", "GET", undefined, jars[0])).status, 403);
  assert.equal((await request(`/api/drivers/${driverB}/documents`, "GET", undefined, jars[0])).status, 200, "Driver can read their organization-scoped document list");
  assert.equal((await request("/api/onboarding/join-existing", "POST", { code: invitation.code }, jars[0])).status, 404, "Invitation single use");
  const duplicate = await issue(1, "manager");
  assert.equal((await request("/api/onboarding/join-existing", "POST", { code: duplicate.code }, jars[0])).status, 409, "Another code cannot alter existing role");
  assert.equal((await request("/api/organizations", "POST", { tenantId: c }, jars[0])).status, 403, "Nonmember organization denied");
  assert.equal((await request("/api/organizations", "POST", { tenantId: a }, jars[0], "https://external.invalid")).status, 403, "Cross-origin switch denied");
  await switchTo(0, a);
  const createdVehicle = await request("/api/vehicles", "POST", { registration: "AA-123-AA", make: "Renault", model: "Trafic", ownershipType: "owned", registeredHolder: "", year: "2022", technicalInspectionDate: "2027-01-01", insuranceCompany: "", insuranceExpiryDate: "", bonusMalus: "" }, jars[0]);
  assert.equal(createdVehicle.status, 201, JSON.stringify(createdVehicle.data)); vehicleId = createdVehicle.data.vehicle.id;
  assert.equal((await request(`/api/vehicles/${vehicleId}`, "GET", undefined, jars[1])).status, 404, "Foreign fleet record denied");
  assert.equal((await request(`/api/vehicles/${vehicleId}/documents/${randomUUID()}/content`, "GET", undefined, jars[1])).status, 404, "Foreign private file parent denied");
  const users = (await request("/api/organization-users", "GET", undefined, jars[0])).data.users;
  assert.equal(users.length, 1, "Users list scopes memberships");
  await switchTo(0, b);
  assert.equal((await request(`/api/organization-users/${userId}`, "PATCH", { name: "Driver B Display", role: "driver" }, jars[1])).status, 200);
  assert.equal((await request(`/api/organization-users/${userId}`, "PATCH", { disabled: true }, jars[1])).status, 200);
  assert.equal((await request("/api/vehicles", "GET", undefined, jars[0])).status, 401, "Active suspended membership fails closed");
  assert.equal((await request("/api/organizations", "POST", { tenantId: b }, jars[0])).status, 403);
  await switchTo(0, a);
  assert.equal((await request("/api/organization-users", "GET", undefined, jars[0])).status, 200, "Other organization access survives suspension");
  const membershipA = (await pool.query("SELECT role,display_name,disabled_at FROM organization_membership WHERE user_id=$1 AND tenant_id=$2", [userId, a])).rows[0];
  assert.equal(membershipA.role, "administrator"); assert.equal(membershipA.disabled_at, null); assert.notEqual(membershipA.display_name, "Driver B Display");
  assert.equal((await request(`/api/organization-users/${userId}`, "PATCH", { disabled: false }, jars[1])).status, 200);
  const driverC = randomUUID(); driverIds.push(driverC);
  await pool.query("INSERT INTO driver(id,tenant_id,full_name) VALUES($1,$2,'Temporary Shared Driver C')", [driverC, c]);
  const inviteC = await issue(2, "driver", { email: emails[0], targetDriverId: driverC });
  assert.equal((await request("/api/onboarding/join-existing", "POST", { code: inviteC.code }, jars[0])).status, 200, "Same account can link separate driver records per organization");
  assert.equal((await request(`/api/drivers/${driverB}/documents`, "GET", undefined, jars[0])).status, 404, "Driver document isolation after switch");
  const oldCookie = jars[0].get("nexdrive.organization");
  jars[0].delete("better-auth.session_token");
  await signIn(0);
  listing = (await request("/api/organizations", "GET", undefined, jars[0])).data;
  assert.equal(listing.activeTenantId, a, "Selection from another session is ignored");
  jars[0].set("nexdrive.organization", oldCookie);
  const expired = await issue(1, "manager");
  await pool.query("UPDATE organization_invitation SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=$1", [expired.id]);
  assert.equal((await request("/api/onboarding/join-existing", "POST", { code: expired.code }, jars[0])).status, 404);
  const revoked = await issue(1, "manager");
  await request(`/api/invitations/${revoked.id}`, "DELETE", undefined, jars[1]);
  assert.equal((await request("/api/onboarding/join-existing", "POST", { code: revoked.code }, jars[0])).status, 404);
  for (const index of [3, 4]) {
    assert.equal((await request("/api/onboarding/account", "POST", { name: `Temporary Concurrent Member ${index}`, email: emails[index], password })).status, 201);
    await markFixtureEmailVerified(index);
    await signIn(index);
  }
  const concurrentInvite = await issue(1, "manager");
  const concurrent = await Promise.all([3, 4].map(index => request("/api/onboarding/join-existing", "POST", { code: concurrentInvite.code }, jars[index])));
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 404], "Only one concurrent acceptance consumes a code");
  const beforeMigration = (await pool.query("SELECT * FROM organization_membership WHERE user_id=$1 ORDER BY tenant_id", [userId])).rows;
  await pool.query(await readFile(new URL("../migrations/032_organization_memberships.sql", import.meta.url), "utf8"));
  assert.deepEqual((await pool.query("SELECT * FROM organization_membership WHERE user_id=$1 ORDER BY tenant_id", [userId])).rows, beforeMigration, "Reapplying migration preserves existing memberships");
  assert.equal(Number((await pool.query(`SELECT count(*) FROM pg_constraint WHERE contype='f' AND confrelid='"user"'::regclass AND cardinality(confkey)=2`)).rows[0].count), 0, "Tenant foreign keys reference memberships");
  console.log("Membership verification passed: independent registration, explicit acceptance, role isolation, switching, recipient binding, private file boundaries, scoped suspension/display names, driver links per organization, session-bound selection, expired/revoked/single-use and concurrent invitations, migration reapplication and membership foreign keys.");
} finally {
  await pool.query("DELETE FROM organization_invitation WHERE tenant_id=ANY($1::text[])", [tenants]);
  await pool.query("DELETE FROM driver WHERE id=ANY($1::uuid[])", [driverIds]);
  if (vehicleId) await pool.query("DELETE FROM vehicle WHERE id=$1", [vehicleId]);
  await pool.query('DELETE FROM "user" WHERE email=ANY($1::text[])', [emails]);
  await pool.query("DELETE FROM tenant WHERE id=ANY($1::text[])", [tenants]);
  await pool.end();
}
