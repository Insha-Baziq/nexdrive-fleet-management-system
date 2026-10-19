import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.BETTER_AUTH_SECRET || !process.env.DATABASE_URL) throw new Error("Local environment required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const suffix = randomUUID();
const adminEmail = `onboarding-admin-${suffix}@example.invalid`;
const newEmail = `onboarding-new-${suffix}@example.invalid`;
const existingEmail = `onboarding-existing-${suffix}@example.invalid`;
const directEmail = `onboarding-direct-${suffix}@example.invalid`;
const emails = [adminEmail, newEmail, existingEmail, directEmail];
const password = randomBytes(24).toString("base64url");
let tenantId;

async function request(path, method = "GET", body, cookie) {
  const response = await fetch(`${origin}${path}`, {
    method, headers: { ...(body === undefined ? {} : { "content-type": "application/json", origin }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual",
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

async function signIn(email) {
  const result = await request("/api/auth/sign-in/email", "POST", { email, password });
  assert.equal(result.status, 200, `sign-in failed for ${email}`);
  assert.ok(result.cookie);
  return result.cookie;
}

async function markFixtureEmailVerified(email) {
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE email=$1', [email]);
}

try {
  const direct = await request("/api/auth/sign-up/email", "POST", { name: "Direct", email: directEmail, password });
  assert.equal(direct.status, 400);
  assert.equal(direct.data.code, "EMAIL_PASSWORD_SIGN_UP_DISABLED");

  const created = await request("/api/onboarding/create", "POST", {
    organizationName: `Temporary Onboarding ${suffix}`, country: "FR", timezone: "Europe/Paris",
    name: "Onboarding Administrator", email: adminEmail, password,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const admin = await pool.query('SELECT "tenantId", "appRole", "emailVerified" FROM "user" WHERE email=$1', [adminEmail]);
  assert.equal(admin.rows[0]?.appRole, "administrator");
  assert.equal(admin.rows[0]?.emailVerified, false, "new organization administrator must verify their email before sign-in");
  tenantId = admin.rows[0].tenantId;
  assert.ok(tenantId);
  const unverifiedAdminLogin = await request("/api/auth/sign-in/email", "POST", { email: adminEmail, password });
  assert.equal(unverifiedAdminLogin.status, 403, "unverified organization administrator cannot sign in");
  await markFixtureEmailVerified(adminEmail);
  const adminCookie = await signIn(adminEmail);

  const duplicate = await request("/api/onboarding/create", "POST", {
    organizationName: `Duplicate Onboarding ${suffix}`, country: "FR", timezone: "Europe/Paris",
    name: "Duplicate Administrator", email: adminEmail, password,
  });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.data));

  const unauthorizedInvite = await request("/api/invitations", "POST", { email: newEmail, role: "manager" });
  assert.equal(unauthorizedInvite.status, 401);
  const issued = await request("/api/invitations", "POST", { email: newEmail, role: "manager" }, adminCookie);
  assert.equal(issued.status, 201, JSON.stringify(issued.data));
  assert.ok(issued.data.code?.length >= 20);
  const preview = await request("/api/onboarding/invitation", "POST", { code: issued.data.code });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.role, "manager");
  assert.equal(preview.data.email, newEmail);

  const wrongEmail = await request("/api/onboarding/account", "POST", {
    invitationCode: issued.data.code, name: "Wrong", email: existingEmail, password,
  });
  assert.equal(wrongEmail.status, 400);
  const legacyJoin = await request("/api/onboarding/join-new", "POST", {
    code: issued.data.code, name: "New Member", email: newEmail, password,
  });
  assert.equal(legacyJoin.status, 409, "a new invitee must register and verify before accepting");
  const registeredNew = await request("/api/onboarding/account", "POST", {
    invitationCode: issued.data.code, name: "New Member", email: newEmail, password,
  });
  assert.equal(registeredNew.status, 201, JSON.stringify(registeredNew.data));
  assert.equal(registeredNew.data.emailVerificationRequired, true);
  const unverifiedNewLogin = await request("/api/auth/sign-in/email", "POST", { email: newEmail, password });
  assert.equal(unverifiedNewLogin.status, 403, "new invitee cannot sign in before verification");
  await markFixtureEmailVerified(newEmail);
  const managerCookie = await signIn(newEmail);
  const joinedNew = await request("/api/onboarding/join-existing", "POST", { code: issued.data.code }, managerCookie);
  assert.equal(joinedNew.status, 200, JSON.stringify(joinedNew.data));
  const managerSession = await request("/api/auth/get-session", "GET", undefined, managerCookie);
  assert.equal(managerSession.data.user.tenantId, tenantId);
  assert.equal(managerSession.data.user.appRole, "manager");
  const managerInvite = await request("/api/invitations", "POST", { email: existingEmail, role: "driver" }, managerCookie);
  assert.equal(managerInvite.status, 403);
  const used = await request("/api/onboarding/invitation", "POST", { code: issued.data.code });
  assert.equal(used.status, 404);

  const registeredExisting = await request("/api/onboarding/account", "POST", {
    name: "Existing Member", email: existingEmail, password,
  });
  assert.equal(registeredExisting.status, 201, JSON.stringify(registeredExisting.data));
  await markFixtureEmailVerified(existingEmail);
  const existingCookie = await signIn(existingEmail);
  const existingInvite = await request("/api/invitations", "POST", { email: existingEmail, role: "driver" }, adminCookie);
  assert.equal(existingInvite.status, 201, JSON.stringify(existingInvite.data));
  const joinedExisting = await request("/api/onboarding/join-existing", "POST", { code: existingInvite.data.code }, existingCookie);
  assert.equal(joinedExisting.status, 200, JSON.stringify(joinedExisting.data));
  const existingSession = await request("/api/auth/get-session", "GET", undefined, existingCookie);
  assert.equal(existingSession.data.user.tenantId, tenantId);
  assert.equal(existingSession.data.user.appRole, "driver");
  const secondJoin = await request("/api/onboarding/join-existing", "POST", { code: existingInvite.data.code }, existingCookie);
  assert.equal(secondJoin.status, 404);
  process.stdout.write("Onboarding verification passed: direct signup guard, organization/admin creation, required email verification, scoped invitations, new and existing account registration and joins, email binding, role boundary, and one-use codes.\n");
} finally {
  await pool.query("DELETE FROM organization_invitation WHERE tenant_id=$1", [tenantId]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [emails]).catch(() => undefined);
  if (tenantId) await pool.query("DELETE FROM tenant WHERE id=$1", [tenantId]).catch(() => undefined);
  await pool.end();
}
