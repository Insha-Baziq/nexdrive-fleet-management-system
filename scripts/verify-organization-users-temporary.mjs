import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { betterAuth } from "better-auth";
import { PostgresDialect } from "kysely";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) throw new Error("Local environment required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const fixtureAuth = betterAuth({
  baseURL: origin, secret: process.env.BETTER_AUTH_SECRET,
  database: { dialect: new PostgresDialect({ pool }), type: "postgres" },
  emailAndPassword: { enabled: true, autoSignIn: false },
  user: { additionalFields: {
    tenantId: { type: "string", required: false, input: false },
    appRole: { type: ["administrator", "fleet_manager", "manager", "driver"], required: false, input: false },
  } },
});
const suffix = randomUUID();
const adminEmail = `users-admin-${suffix}@example.invalid`;
const otherAdminEmail = `users-other-${suffix}@example.invalid`;
const memberEmail = `users-member-${suffix}@example.invalid`;
const existingEmail = `users-existing-${suffix}@example.invalid`;
const unusedEmail = `users-unused-${suffix}@example.invalid`;
const emails = [adminEmail, otherAdminEmail, memberEmail, existingEmail, unusedEmail];
const linkedDriverId = randomUUID();
const tenantIds = [];
const password = randomBytes(24).toString("base64url");
let testIp = 40;

function nextTestIp() {
  testIp = (testIp % 200) + 1;
  return `198.51.100.${testIp}`;
}

async function request(path, method = "GET", body, cookie) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { ...(method === "GET" ? {} : { origin }), "x-forwarded-for": nextTestIp(), ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual",
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data, location: response.headers.get("location"), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

async function signIn(email) {
  const result = await request("/api/auth/sign-in/email", "POST", { email, password });
  assert.equal(result.status, 200, `sign-in failed for ${email}: ${JSON.stringify(result.data)}`);
  assert.ok(result.cookie);
  return result.cookie;
}

async function createOrganization(email, label) {
  const account = await fixtureAuth.api.signUpEmail({
    body: { name: `${label} Administrator`, email, password },
    headers: new Headers({ origin }),
  });
  assert.ok(account?.user?.id);
  const tenantId = randomUUID();
  await pool.query(
    "INSERT INTO tenant(id,name,country_code,timezone,currency_code) VALUES($1,$2,'FR','Europe/Paris','EUR')",
    [tenantId, `Temporary Users ${label} ${suffix}`],
  );
  await pool.query(
    'UPDATE "user" SET "emailVerified"=true,"tenantId"=$2,"appRole"=\'administrator\' WHERE id=$1',
    [account.user.id, tenantId],
  );
  tenantIds.push(tenantId);
  return signIn(email);
}

try {
  assert.equal((await request("/api/organization-users")).status, 401);
  const admin = await createOrganization(adminEmail, "First");
  const otherAdmin = await createOrganization(otherAdminEmail, "Second");

  const scoped = await request(`/api/organization-users?tenantId=${tenantIds[1]}`, "GET", undefined, admin);
  assert.equal(scoped.status, 200);
  assert.deepEqual(scoped.data.users.map((user) => user.email), [adminEmail]);
  assert.ok(!JSON.stringify(scoped.data).includes(otherAdminEmail));
  const otherScoped = await request(`/api/organization-users?tenantId=${tenantIds[0]}`, "GET", undefined, otherAdmin);
  assert.deepEqual(otherScoped.data.users.map((user) => user.email), [otherAdminEmail]);

  const presence = await request("/api/presence", "POST", {}, admin);
  assert.equal(presence.status, 200);
  const present = await request("/api/organization-users", "GET", undefined, admin);
  assert.ok(present.data.users.find((user) => user.email === adminEmail).lastSeenAt);

  assert.equal((await request("/api/invitations", "POST", { role: "owner" }, admin)).status, 400);
  const issued = await request("/api/invitations", "POST", { role: "manager" }, admin);
  assert.equal(issued.status, 201, JSON.stringify(issued.data));
  assert.equal(issued.data.email, null);
  assert.ok(issued.data.code?.length >= 20);
  const list = await request("/api/invitations", "GET", undefined, admin);
  assert.equal(list.status, 200);
  const active = list.data.invitations[0];
  assert.equal(active.email, null);
  assert.equal(active.role, "manager");
  assert.equal(active.copyable, true);
  assert.ok(!JSON.stringify(list.data).includes(issued.data.code));
  const storedCode = await pool.query('SELECT code_hash, code_ciphertext FROM organization_invitation WHERE id=$1', [active.id]);
  assert.ok(storedCode.rows[0].code_hash);
  assert.equal(storedCode.rows[0].code_ciphertext, null, "Invitation codes must remain hash-only at rest.");
  const laterCopy = await request(`/api/invitations/${active.id}/code`, "GET", undefined, admin);
  assert.equal(laterCopy.status, 200);
  assert.notEqual(laterCopy.data.code, issued.data.code, "Revealing a generic invite rotates its single-use code.");
  assert.equal((await request("/api/onboarding/invitation", "POST", { code: issued.data.code })).status, 404);
  assert.equal((await request(`/api/invitations/${active.id}/code`, "GET", undefined, otherAdmin)).status, 404);

  const preview = await request("/api/onboarding/invitation", "POST", { code: laterCopy.data.code });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.email, null);
  assert.equal(preview.data.role, "manager");
  const rejectedUnverifiedJoin = await request("/api/onboarding/join-new", "POST", {
    code: laterCopy.data.code, name: "First Member", email: memberEmail, password, role: "administrator",
  });
  assert.equal(rejectedUnverifiedJoin.status, 409, "Users must verify and sign in before accepting an invitation.");
  await fixtureAuth.api.signUpEmail({ body: { name: "First Member", email: memberEmail, password }, headers: new Headers({ origin }) });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE email=$1', [memberEmail]);
  const member = await signIn(memberEmail);
  const joined = await request("/api/onboarding/join-existing", "POST", { code: laterCopy.data.code }, member);
  assert.equal(joined.status, 200, JSON.stringify(joined.data));
  const joinedUsers = await request("/api/organization-users", "GET", undefined, admin);
  assert.deepEqual(joinedUsers.data.users.map((user) => user.email).sort(), [adminEmail, memberEmail].sort());
  const joinedMember = joinedUsers.data.users.find((user) => user.email === memberEmail);
  assert.equal(joinedMember.role, "manager");
  const editedMember = await request(`/api/organization-users/${joinedMember.id}`, "PATCH", { name: "Updated Member Name", role: "fleet_manager" }, admin);
  assert.equal(editedMember.status, 200, JSON.stringify(editedMember.data));
  assert.deepEqual(editedMember.data, { name: "Updated Member Name", role: "fleet_manager" });
  const editedMemberRow = await pool.query('SELECT m.display_name AS name, u.email, m.role AS "appRole" FROM "user" u JOIN organization_membership m ON m.user_id=u.id WHERE u.id=$1', [joinedMember.id]);
  assert.equal(editedMemberRow.rows[0].name, "Updated Member Name");
  assert.equal(editedMemberRow.rows[0].email, memberEmail, "the edit flow must leave email unchanged");
  assert.equal(editedMemberRow.rows[0].appRole, "fleet_manager");
  assert.equal((await request(`/api/organization-users/${joinedMember.id}`, "PATCH", { name: "Email Attempt", role: "manager", email: "changed@example.invalid" }, admin)).status, 400);
  assert.equal((await request(`/api/organization-users/${joinedMember.id}`, "PATCH", { name: "Cross Tenant", role: "manager" }, otherAdmin)).status, 404);
  const adminId = joinedUsers.data.users.find((user) => user.email === adminEmail).id;
  assert.equal((await request(`/api/organization-users/${adminId}`, "PATCH", { name: "No Self Role Change", role: "fleet_manager" }, admin)).status, 400);
  assert.equal((await request(`/api/invitations/${active.id}/code`, "GET", undefined, admin)).status, 404);
  assert.ok(!(await request("/api/invitations", "GET", undefined, admin)).data.invitations.some((item) => item.id === active.id));
  assert.equal((await request("/api/organization-users", "GET", undefined, member)).status, 403);
  assert.equal((await request("/api/invitations", "POST", { role: "driver" }, member)).status, 403);

  await fixtureAuth.api.signUpEmail({ body: { name: "Existing Member", email: existingEmail, password }, headers: new Headers({ origin }) });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE email=$1', [existingEmail]);
  const existing = await signIn(existingEmail);
  const forExisting = await request("/api/invitations", "POST", { role: "driver" }, admin);
  assert.equal(forExisting.status, 201);
  const joinedExisting = await request("/api/onboarding/join-existing", "POST", { code: forExisting.data.code, role: "administrator" }, existing);
  assert.equal(joinedExisting.status, 200);
  const existingRowAfterJoin = await pool.query('SELECT "tenantId", "appRole" FROM "user" WHERE email=$1', [existingEmail]);
  assert.equal(existingRowAfterJoin.rows[0].tenantId, tenantIds[0]);
  assert.equal(existingRowAfterJoin.rows[0].appRole, "driver");
  const existingUserId = (await pool.query('SELECT id FROM "user" WHERE email=$1', [existingEmail])).rows[0].id;
  await pool.query(
    `INSERT INTO driver (id, tenant_id, full_name, licence_number, licence_expiry_date, user_id)
     VALUES ($1,$2,'Existing Member',NULL,NULL,$3)`,
    [linkedDriverId, tenantIds[0], existingUserId],
  );
  const forbiddenDriverRoleChange = await request(`/api/organization-users/${existingUserId}`, "PATCH", { name: "Existing Member", role: "manager" }, admin);
  assert.equal(forbiddenDriverRoleChange.status, 409);

  const toRevoke = await request("/api/invitations", "POST", { role: "driver" }, admin);
  assert.equal(toRevoke.status, 201);
  const activeRevoke = (await request("/api/invitations", "GET", undefined, admin)).data.invitations.find((item) => item.role === "driver");
  assert.ok(activeRevoke);
  assert.equal((await request(`/api/invitations/${activeRevoke.id}`, "DELETE", undefined, admin)).status, 200);
  assert.equal((await request(`/api/invitations/${activeRevoke.id}/code`, "GET", undefined, admin)).status, 404);
  assert.equal((await request("/api/onboarding/invitation", "POST", { code: toRevoke.data.code })).status, 404);
  assert.ok(!(await request("/api/invitations", "GET", undefined, admin)).data.invitations.some((item) => item.id === activeRevoke.id));

  assert.equal((await request(`/api/organization-users/${joinedMember.id}`, "PATCH", { disabled: "yes" }, admin)).status, 400);
  assert.equal((await request(`/api/organization-users/${joinedMember.id}`, "PATCH", { disabled: true }, member)).status, 403);
  assert.equal((await request(`/api/organization-users/${joinedMember.id}`, "PATCH", { disabled: true }, otherAdmin)).status, 404);
  assert.equal((await request(`/api/organization-users/${joinedUsers.data.users.find((user) => user.email === adminEmail).id}`, "PATCH", { disabled: true }, admin)).status, 400);
  const suspended = await request(`/api/organization-users/${joinedMember.id}`, "PATCH", { disabled: true }, admin);
  assert.equal(suspended.status, 200);
  assert.equal((await request("/api/presence", "POST", {}, member)).status, 401);
  assert.equal((await request("/api/organization-users", "GET", undefined, member)).status, 401);
  const blockedSignIn = await request("/api/auth/sign-in/email", "POST", { email: memberEmail, password });
  assert.equal(blockedSignIn.status, 403, JSON.stringify(blockedSignIn.data));

  const suspendedList = await request("/api/organization-users", "GET", undefined, admin);
  assert.ok(suspendedList.data.users.find((user) => user.id === joinedMember.id).accountDisabledAt);
  assert.equal((await request(`/api/organization-users/${joinedMember.id}`, "PATCH", { disabled: false }, admin)).status, 200);
  const reactivatedMember = await signIn(memberEmail);

  const page = await fetch(`${origin}/settings/users`, { headers: { cookie: admin }, redirect: "manual" });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes(memberEmail));
  assert.ok(!html.includes(otherAdminEmail));
  const deniedPage = await fetch(`${origin}/settings/users`, { headers: { cookie: reactivatedMember }, redirect: "manual" });
  assert.equal(deniedPage.status, 404);
  const legacy = await request("/settings/invitations", "GET", undefined, admin);
  assert.equal(legacy.status, 307);
  assert.equal(legacy.location, "/settings/users");

  process.stdout.write("User access verification passed: tenant-scoped list, activity, hash-only single-use invites, verified-account acceptance, revocation, administrator boundaries, suspension/session invalidation, reactivation, and page guards.\n");
} finally {
  await pool.query("DELETE FROM driver WHERE id=$1", [linkedDriverId]).catch(() => undefined);
  for (const tenantId of tenantIds) await pool.query("DELETE FROM organization_invitation WHERE tenant_id=$1", [tenantId]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [emails]).catch(() => undefined);
  for (const tenantId of tenantIds) await pool.query("DELETE FROM tenant WHERE id=$1", [tenantId]).catch(() => undefined);
  await pool.end();
}
