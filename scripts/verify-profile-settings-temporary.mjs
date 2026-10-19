import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) throw new Error("Local environment required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const suffix = randomUUID();
const email = `profile-settings-${suffix}@example.invalid`;
const oldPassword = randomBytes(24).toString("base64url");
const newPassword = randomBytes(24).toString("base64url");
let testIp = 90;

function nextIp() {
  testIp = (testIp % 200) + 1;
  return `198.51.100.${testIp}`;
}

async function request(path, method = "GET", body, cookie, originHeader = origin) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(method === "GET" ? {} : { origin: originHeader }),
      "x-forwarded-for": nextIp(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

async function signIn(password) {
  const result = await request("/api/auth/sign-in/email", "POST", { email, password });
  assert.equal(result.status, 200, `sign-in failed: ${JSON.stringify(result.data)}`);
  assert.ok(result.cookie);
  return result.cookie;
}

try {
  const created = await request("/api/onboarding/create", "POST", {
    organizationName: `Temporary Profile ${suffix}`, country: "FR", timezone: "Europe/Paris",
    name: "Profile Owner", email, password: oldPassword,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const user = (await pool.query('SELECT id, "tenantId", "emailVerified" FROM "user" WHERE email=$1', [email])).rows[0];
  const userId = user.id;
  const tenantId = user.tenantId;
  assert.ok(tenantId);
  assert.equal(user.emailVerified, false, "organization signup starts with email verification required");
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [userId]);
  const sessionOne = await signIn(oldPassword);
  const sessionTwo = await signIn(oldPassword);

  const renamed = await request("/api/profile", "PATCH", { firstName: "Changed", lastName: "Profile Owner" }, sessionOne);
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal(renamed.data.name, "Changed Profile Owner");
  assert.equal((await request("/api/profile", "PATCH", { firstName: "No", lastName: "Change" }, sessionOne, "https://attacker.invalid")).status, 403);
  assert.equal((await request("/api/profile", "PATCH", { firstName: "No", lastName: "Email", email: "changed@example.invalid" }, sessionOne)).status, 400);
  assert.equal((await request("/api/profile", "PATCH", { firstName: "", lastName: "Name" }, sessionOne)).status, 400);
  const profileRow = await pool.query('SELECT name, email, "tenantId" FROM "user" WHERE id=$1', [userId]);
  assert.equal(profileRow.rows[0].name, "Changed Profile Owner");
  assert.equal(profileRow.rows[0].email, email, "self-service profile edits must not change login email");
  assert.equal(profileRow.rows[0].tenantId, tenantId);

  const wrongPassword = await request("/api/profile/password", "POST", { currentPassword: "wrong-password", newPassword }, sessionOne);
  assert.equal(wrongPassword.status, 400);
  const changedPassword = await request("/api/profile/password", "POST", { currentPassword: oldPassword, newPassword }, sessionOne);
  assert.equal(changedPassword.status, 200, JSON.stringify(changedPassword.data));
  assert.ok(changedPassword.cookie, "password change must return Better Auth's rotated current session cookie");
  const currentSession = changedPassword.cookie;
  assert.equal((await request("/api/organization-users", "GET", undefined, currentSession)).status, 200, "the current session stays active after the change");
  assert.equal((await request("/api/organization-users", "GET", undefined, sessionTwo)).status, 401, "other sessions are revoked");
  const oldSignIn = await request("/api/auth/sign-in/email", "POST", { email, password: oldPassword });
  assert.notEqual(oldSignIn.status, 200, "old password must stop working");
  const newSession = await signIn(newPassword);
  assert.equal((await request("/api/organization-users", "GET", undefined, newSession)).status, 200);

  const page = await fetch(`${origin}/settings/profile`, { headers: { cookie: newSession }, redirect: "manual" });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes("Changed Profile Owner"));
  assert.ok(html.includes(email));
  assert.match(html, /id="profile-email"[^>]*readonly/i);
  process.stdout.write("Profile verification passed: tenant-bound name update, same-origin and input validation, immutable email, current-password confirmation, password replacement, other-session revocation, and read-only email page control.\n");
} finally {
  await pool.query('DELETE FROM "user" WHERE email=$1', [email]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE name LIKE $1", [`Temporary Profile ${suffix}`]).catch(() => undefined);
  await pool.end();
}
