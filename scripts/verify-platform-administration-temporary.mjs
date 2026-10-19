import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { PostgresDialect } from "kysely";
import { createPlatformOrganizationUser } from "../src/lib/onboarding.ts";
import { deletePlatformOrganization } from "../src/lib/platform-administration.ts";
import { pool } from "../src/lib/db.ts";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET
  || !/^(localhost|127\.0\.0\.1)$/.test(new URL(origin).hostname)
  || new URL(origin).port !== "3000") {
  throw new Error("Local V1 development on port 3000 is required.");
}

const fixtureAuth = betterAuth({
  baseURL: origin,
  secret: process.env.BETTER_AUTH_SECRET,
  database: { dialect: new PostgresDialect({ pool }), type: "postgres" },
  emailAndPassword: { enabled: true, autoSignIn: false },
  user: { additionalFields: {
    tenantId: { type: "string", required: false, input: false },
    appRole: { type: ["administrator", "fleet_manager", "manager", "driver"], required: false, input: false },
  } },
});

const suffix = randomUUID();
const password = randomBytes(24).toString("base64url");
const emails = {
  platform: `platform-${suffix}@example.invalid`,
  regular: `regular-${suffix}@example.invalid`,
  noOrganization: `no-organization-${suffix}@example.invalid`,
  organizationMember: `organization-member-${suffix}@example.invalid`,
  crossOrganization: `cross-organization-${suffix}@example.invalid`,
  createdMember: `created-member-${suffix}@example.invalid`,
  secondPlatformAdmin: `second-platform-admin-${suffix}@example.invalid`,
  finalPlatformAdmin: `final-platform-admin-${suffix}@example.invalid`,
};
const accountIds = [];
const tenants = [];
let platformCookie;

async function request(path, method = "GET", body, cookie) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(method === "GET" ? {} : { origin, "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* Server-rendered pages are HTML. */ }
  const cookieHeader = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie");
  return {
    status: response.status,
    text,
    json,
    location: response.headers.get("location"),
    cookie: cookieHeader?.split(";")[0],
  };
}

async function createFixtureAccount(email, name) {
  const result = await fixtureAuth.api.signUpEmail({
    body: { name, email, password },
    headers: new Headers({ origin }),
  });
  assert.ok(result?.user?.id, "The isolated test account should be created.");
  accountIds.push(result.user.id);
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [result.user.id]);
  return result.user.id;
}

async function signIn(email) {
  const result = await request("/api/auth/sign-in/email", "POST", { email, password });
  assert.equal(result.status, 200, "A verified local test account should sign in.");
  assert.ok(result.cookie, "Sign-in should return a session cookie.");
  return result.cookie;
}

async function createOrganization(name) {
  const result = await request("/api/platform/organizations", "POST", { organizationName: name }, platformCookie);
  assert.equal(result.status, 201, `Platform organization creation should work: ${result.text}`);
  tenants.push({ id: result.json.organization.id, name });
  return result.json.organization.id;
}

async function addMembership(userId, tenantId, role, name) {
  await pool.query(
    `INSERT INTO organization_membership(user_id, tenant_id, role, display_name)
     VALUES($1,$2,$3,$4)`,
    [userId, tenantId, role, name],
  );
}

try {
  const [platformId, regularId, noOrganizationId, organizationMemberId, crossOrganizationId, secondPlatformAdminId, finalPlatformAdminId] = await Promise.all([
    createFixtureAccount(emails.platform, "Temporary Platform Administrator"),
    createFixtureAccount(emails.regular, "Temporary Organization Administrator"),
    createFixtureAccount(emails.noOrganization, "Temporary User Without Organization"),
    createFixtureAccount(emails.organizationMember, "Temporary Organization Member"),
    createFixtureAccount(emails.crossOrganization, "Temporary Multi Organization User"),
    createFixtureAccount(emails.secondPlatformAdmin, "Temporary Platform Administrator Two"),
    createFixtureAccount(emails.finalPlatformAdmin, "Temporary Platform Administrator Three"),
  ]);
  await pool.query(
    "INSERT INTO platform_administrator(user_id) VALUES($1),($2),($3)",
    [platformId, secondPlatformAdminId, finalPlatformAdminId],
  );
  platformCookie = await signIn(emails.platform);

  const login = await request("/platform/login");
  assert.equal(login.status, 200);
  assert.equal((login.text.match(/type="email"/g) ?? []).length, 1);
  assert.equal((login.text.match(/type="password"/g) ?? []).length, 1);
  assert.doesNotMatch(login.text, /forgot password|sign up|create organization/i);

  assert.equal((await request("/platform")).location, "/platform/login");
  assert.equal((await request("/platform/users")).location, "/platform/login");
  assert.equal((await request("/api/platform/access")).status, 401);
  assert.equal((await request("/api/platform/organizations", "POST", { organizationName: "Unauthenticated" })).status, 401);
  assert.equal((await request("/api/platform/organizations", "GET", undefined, platformCookie)).status, 200);
  assert.equal((await request("/api/platform/access", "GET", undefined, platformCookie)).status, 200);

  const targetName = `Platform Target ${suffix}`;
  const secondName = `Platform Second ${suffix}`;
  const targetTenantId = await createOrganization(targetName);
  const secondTenantId = await createOrganization(secondName);
  await addMembership(regularId, targetTenantId, "administrator", "Temporary Organization Administrator");
  await addMembership(organizationMemberId, targetTenantId, "manager", "Temporary Organization Member");
  await addMembership(crossOrganizationId, targetTenantId, "manager", "Temporary Multi Organization User");
  await addMembership(crossOrganizationId, secondTenantId, "fleet_manager", "Temporary Multi Organization User");

  const regularCookie = await signIn(emails.regular);
  assert.equal((await request("/api/platform/access", "GET", undefined, regularCookie)).status, 403);
  const regularPage = await request("/platform", "GET", undefined, regularCookie);
  assert.equal(regularPage.location, "/workspace");
  const regularCreate = await request("/api/platform/organizations", "POST", { organizationName: "Must Be Denied" }, regularCookie);
  assert.equal(regularCreate.status, 403);
  assert.equal((await request(`/platform/organizations/${targetTenantId}`, "GET", undefined, regularCookie)).location, "/workspace");

  const emptyOrganization = await request(`/platform/organizations/${targetTenantId}`, "GET", undefined, platformCookie);
  assert.equal(emptyOrganization.status, 200);
  assert.match(emptyOrganization.text, new RegExp(targetName));
  assert.match(emptyOrganization.text, /Users/);
  const globalUsers = await request("/platform/users", "GET", undefined, platformCookie);
  assert.equal(globalUsers.status, 200);
  for (const email of [emails.platform, emails.noOrganization, emails.regular, emails.organizationMember]) {
    assert.ok(globalUsers.text.includes(email), `Global Users should include ${email}, including accounts without an organization.`);
  }
  assert.match(globalUsers.text, /No organization/);

  const createdEmails = [];
  const createdUser = await createPlatformOrganizationUser(targetTenantId, {
    name: "Temporary Platform Created Driver",
    email: emails.createdMember,
    role: "driver",
    password,
  }, async (message) => { createdEmails.push(message.to); });
  accountIds.push(createdUser.id);
  assert.equal(createdUser.role, "driver");
  assert.equal(createdUser.emailVerified, false);
  assert.deepEqual(createdEmails, [emails.createdMember]);
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [createdUser.id]);
  await addMembership(createdUser.id, secondTenantId, "manager", "Temporary Platform Created Driver");

  const orgApi = await request("/api/platform/organizations", "GET", undefined, platformCookie);
  const organization = orgApi.json.organizations.find((item) => item.id === targetTenantId);
  assert.ok(organization);
  assert.ok(organization.users.some((user) => user.email === emails.createdMember && user.role === "driver"));
  assert.ok(organization.users.some((user) => user.email === emails.crossOrganization));

  const detail = await request(`/platform/organizations/${targetTenantId}`, "GET", undefined, platformCookie);
  for (const value of [emails.regular, emails.organizationMember, emails.crossOrganization, emails.createdMember, "Create user", "Delete account"]) {
    assert.ok(detail.text.includes(value), `Organization detail should show ${value}.`);
  }
  const createUserDenied = await request(`/api/platform/organizations/${targetTenantId}/users`, "POST", {
    name: "Unauthorized", email: `unauthorized-${suffix}@example.invalid`, role: "manager", password,
  });
  assert.equal(createUserDenied.status, 401);
  const createUserInvalid = await request(`/api/platform/organizations/${targetTenantId}/users`, "POST", {
    name: "Invalid Role", email: `invalid-role-${suffix}@example.invalid`, role: "owner", password,
  }, platformCookie);
  assert.equal(createUserInvalid.status, 400);

  const vehicleId = randomUUID();
  const driverId = randomUUID();
  const assignmentId = randomUUID();
  await pool.query(
    `INSERT INTO vehicle(id, tenant_id, registration, make, model) VALUES($1,$2,$3,'Test','Vehicle')`,
    [vehicleId, targetTenantId, `TEST-${suffix.slice(0, 8)}`],
  );
  await pool.query(
    `INSERT INTO driver(id, tenant_id, user_id, full_name, licence_number, licence_expiry_date)
     VALUES($1,$2,$3,'Temporary Platform Created Driver',NULL,NULL)`,
    [driverId, targetTenantId, createdUser.id],
  );
  await pool.query(
    `INSERT INTO assignment(id, tenant_id, vehicle_id, driver_id, started_at, created_by_user_id)
     VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP,$5)`,
    [assignmentId, targetTenantId, vehicleId, driverId, createdUser.id],
  );

  const wrongAccountDelete = await request(`/api/platform/users/${createdUser.id}`, "DELETE", { email: `${emails.createdMember}.wrong` }, platformCookie);
  assert.equal(wrongAccountDelete.status, 400);
  assert.equal((await pool.query('SELECT 1 FROM "user" WHERE id=$1', [createdUser.id])).rowCount, 1);
  const deletedAccount = await request(`/api/platform/users/${createdUser.id}`, "DELETE", { email: emails.createdMember }, platformCookie);
  assert.equal(deletedAccount.status, 200, deletedAccount.text);
  const tombstone = await pool.query('SELECT name, email, "emailVerified", "accountDisabledAt" FROM "user" WHERE id=$1', [createdUser.id]);
  assert.equal(tombstone.rows[0]?.name, "Deleted account");
  assert.notEqual(tombstone.rows[0]?.email, emails.createdMember);
  assert.equal(tombstone.rows[0]?.emailVerified, false);
  assert.ok(tombstone.rows[0]?.accountDisabledAt);
  assert.equal((await pool.query('SELECT 1 FROM "account" WHERE "userId"=$1', [createdUser.id])).rowCount, 0);
  assert.equal((await pool.query('SELECT 1 FROM "session" WHERE "userId"=$1', [createdUser.id])).rowCount, 0);
  assert.equal((await pool.query("SELECT 1 FROM driver WHERE id=$1 AND user_id IS NULL", [driverId])).rowCount, 1);
  assert.equal((await pool.query("SELECT 1 FROM assignment WHERE id=$1", [assignmentId])).rowCount, 1);
  const actor = await pool.query(
    `SELECT m.display_name, m.disabled_at, a.created_by_user_id
     FROM assignment a JOIN organization_membership m
       ON m.user_id=a.created_by_user_id AND m.tenant_id=a.tenant_id
     WHERE a.id=$1`,
    [assignmentId],
  );
  assert.equal(actor.rows[0]?.display_name, "Deleted account");
  assert.ok(actor.rows[0]?.disabled_at);
  assert.equal(actor.rows[0]?.created_by_user_id, createdUser.id);
  const afterAccountDeleteDetail = await request(`/platform/organizations/${targetTenantId}`, "GET", undefined, platformCookie);
  assert.ok(!afterAccountDeleteDetail.text.includes(emails.createdMember));
  const afterAccountDeleteGlobal = await request("/platform/users", "GET", undefined, platformCookie);
  assert.ok(!afterAccountDeleteGlobal.text.includes(emails.createdMember));

  const selfDelete = await request(`/api/platform/users/${platformId}`, "DELETE", { email: emails.platform }, platformCookie);
  assert.equal(selfDelete.status, 409);
  const secondAdminId = secondPlatformAdminId;
  const deletedSecondAdmin = await request(`/api/platform/users/${secondAdminId}`, "DELETE", { email: emails.secondPlatformAdmin }, platformCookie);
  assert.equal(deletedSecondAdmin.status, 200);
  const finalAdminDelete = await request(`/api/platform/users/${finalPlatformAdminId}`, "DELETE", { email: emails.finalPlatformAdmin }, platformCookie);
  assert.equal(finalAdminDelete.status, 200, finalAdminDelete.text);
  assert.ok(Number((await pool.query("SELECT count(*)::int AS count FROM platform_administrator")).rows[0].count) >= 1,
    "Deleting a platform administrator must leave the pre-existing local administrator grant intact.");

  const wrongOrganizationDelete = await request(`/api/platform/organizations/${targetTenantId}`, "DELETE", { organizationName: `${targetName} wrong` }, platformCookie);
  assert.equal(wrongOrganizationDelete.status, 400);
  assert.equal((await pool.query("SELECT 1 FROM tenant WHERE id=$1", [targetTenantId])).rowCount, 1);
  const deletedOrganization = await request(`/api/platform/organizations/${targetTenantId}`, "DELETE", { organizationName: targetName }, platformCookie);
  assert.equal(deletedOrganization.status, 200, deletedOrganization.text);
  tenants.splice(tenants.findIndex((tenant) => tenant.id === targetTenantId), 1);
  assert.equal((await pool.query("SELECT 1 FROM assignment WHERE tenant_id=$1", [targetTenantId])).rowCount, 0);
  assert.equal((await pool.query("SELECT 1 FROM organization_membership WHERE tenant_id=$1", [targetTenantId])).rowCount, 0);
  assert.equal((await pool.query("SELECT 1 FROM tenant WHERE id=$1", [targetTenantId])).rowCount, 0);
  for (const id of [regularId, noOrganizationId, organizationMemberId, crossOrganizationId]) {
    assert.equal((await pool.query('SELECT 1 FROM "user" WHERE id=$1', [id])).rowCount, 1, "Organization deletion must retain accounts.");
  }
  assert.equal((await pool.query("SELECT 1 FROM organization_membership WHERE user_id=$1 AND tenant_id=$2", [crossOrganizationId, secondTenantId])).rowCount, 1);
  assert.equal((await pool.query("SELECT 1 FROM organization_membership WHERE user_id=$1 AND tenant_id=$2", [createdUser.id, secondTenantId])).rowCount, 1);

  const retainedAccountLogin = await request("/api/auth/sign-in/email", "POST", { email: emails.organizationMember, password });
  assert.equal(retainedAccountLogin.status, 200, "Organization deletion must preserve sign-in credentials.");
  const retainedWorkspace = await request("/workspace", "GET", undefined, retainedAccountLogin.cookie);
  assert.equal(retainedWorkspace.status, 200);

  process.stdout.write("Focused platform administration verification passed: platform login and guards, organization and global user pages, user creation, account deletion safeguards and audit history, organization deletion and account retention.\n");
} finally {
  for (const tenant of [...tenants].reverse()) {
    await deletePlatformOrganization(tenant.id, tenant.name).catch(() => undefined);
  }
  if (accountIds.length) {
    await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [accountIds]).catch(() => undefined);
  }
  await pool.end();
}
