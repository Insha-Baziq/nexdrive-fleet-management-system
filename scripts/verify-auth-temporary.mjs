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
  { name: "Administrator Verification", role: "administrator", tenant: tenantA },
  { name: "Fleet Manager Verification", role: "fleet_manager", tenant: tenantA },
  { name: "Manager Verification", role: "manager", tenant: tenantA },
  { name: "Driver Verification", role: "driver", tenant: tenantA },
  { name: "Other Tenant Administrator", role: "administrator", tenant: tenantB },
].map((user, index) => ({ ...user, email: `auth-${runId}-${index}@example.invalid` }));
const publicEmail = `public-signup-${runId}@example.invalid`;

async function request(path, method = "GET", cookie, body, redirect = "manual") {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json", origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect,
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, data, response };
}
async function signIn(email) {
  const result = await request("/api/auth/sign-in/email", "POST", null, { email, password });
  assert.equal(result.status, 200, `sign-in failed for ${email}`);
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "sign-in did not return a session cookie");
  return cookie;
}

try {
  const anonymousWorkspace = await request("/workspace");
  assert.ok([307, 308].includes(anonymousWorkspace.status), "anonymous workspace access redirects to login");
  assert.ok(anonymousWorkspace.response.headers.get("location")?.endsWith("/login"));

  const publicSignUp = await request("/api/auth/sign-up/email", "POST", null, {
    name: "Public Signup Attempt", email: publicEmail, password,
  });
  assert.equal(publicSignUp.status, 400);
  assert.equal(publicSignUp.data.code, "EMAIL_PASSWORD_SIGN_UP_DISABLED", "public registration stays disabled");

  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Temporary Auth Verification A'), ($2, 'Temporary Auth Verification B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const result = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2 WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = result.rows[0].id;
  }

  const cookies = await Promise.all(users.map((user) => signIn(user.email)));
  for (const [index, cookie] of cookies.entries()) {
    const expected = users[index];
    const session = await request("/api/auth/get-session", "GET", cookie);
    assert.equal(session.status, 200);
    assert.equal(session.data.user.id, expected.id);
    assert.equal(session.data.user.tenantId, expected.tenant, "session retains the user's own tenant");
    assert.equal(session.data.user.appRole, expected.role, "session retains the assigned role");
    const workspace = await request(`/workspace?tenantId=${tenantB}&appRole=administrator`, "GET", cookie);
    if (expected.role === "driver") {
      assert.ok([307, 308].includes(workspace.status), "Driver is routed to the personal workspace");
      assert.ok(workspace.response.headers.get("location")?.endsWith("/my-vehicle"));
      const personalWorkspace = await request("/my-vehicle?tenantId=" + tenantB + "&appRole=administrator", "GET", cookie);
      assert.equal(personalWorkspace.status, 200);
      assert.ok(personalWorkspace.data.includes("My Vehicle"));
      assert.ok(
        personalWorkspace.data.includes("not linked to a driver record") ||
          personalWorkspace.data.includes("pas encore associé à un dossier conducteur"),
        "unlinked Driver sees the setup guidance in the rendered locale",
      );
    } else {
      assert.equal(workspace.status, 200, `role ${expected.role} reaches its authenticated workspace`);
      assert.ok(workspace.data.includes(expected.name));
      assert.ok(!workspace.data.includes("Account setup needed"));
    }
  }

  const freshAdmin = await signIn(users[0].email);
  const freshSession = await request("/api/auth/get-session", "GET", freshAdmin);
  assert.equal(freshSession.data.user.tenantId, tenantA, "fresh sign-in resolves the persisted tenant");
  assert.equal(freshSession.data.user.appRole, "administrator");
  const signOut = await request("/api/auth/sign-out", "POST", freshAdmin, {});
  assert.ok([200, 204].includes(signOut.status), "authenticated user can sign out");
  const afterSignOut = await request("/workspace", "GET", freshAdmin);
  assert.ok([307, 308].includes(afterSignOut.status), "signed-out session cannot retain workspace access");
  const clearedSession = await request("/api/auth/get-session", "GET", freshAdmin);
  assert.ok(clearedSession.data === null || !clearedSession.data.user, "signed-out cookie has no active session");

  process.stdout.write("Authentication verification passed: anonymous and public-signup denial, all four organization roles, session-bound tenant/role despite query tampering, refresh and fresh-sign-in persistence, and sign-out.\n");
} finally {
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [[...users.map((user) => user.email), publicEmail]]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
}
