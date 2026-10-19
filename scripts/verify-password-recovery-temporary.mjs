import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";
import { createEmailSender, passwordResetRateLimit, passwordResetSettings } from "../src/lib/email.ts";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.BETTER_AUTH_SECRET || !process.env.DATABASE_URL) throw new Error("Local environment required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const suffix = randomUUID();
const password = randomBytes(24).toString("base64url");
const updatedPassword = randomBytes(24).toString("base64url");
const email = `password-reset-${suffix}@example.invalid`;
const failingEmail = `password-reset-failed-${suffix}@example.invalid`;
const sent = [];
const sender = createEmailSender("nexdrive@example.com", {
  async sendMail(message) { sent.push(message); return { accepted: [message.to] }; },
});

function createTestAuth(testSender) {
  return betterAuth({
    baseURL: origin,
    secret: process.env.BETTER_AUTH_SECRET,
    database: { dialect: new PostgresDialect({ pool }), type: "postgres" },
    emailAndPassword: { enabled: true, autoSignIn: false, ...passwordResetSettings(testSender) },
    rateLimit: { enabled: true, customRules: { "/request-password-reset": passwordResetRateLimit } },
  });
}

const auth = createTestAuth(sender);
const authWithFailingTransport = createTestAuth(createEmailSender("nexdrive@example.com", {
  async sendMail() { throw new Error("test-only SMTP diagnostic that must not reach the response"); },
}));

async function request(instance, path, method = "GET", body, ip = "198.51.100.10") {
  const response = await instance.handler(new Request(new URL(path, origin), {
    method,
    headers: {
      origin,
      "x-forwarded-for": ip,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  }));
  const data = await response.json().catch(() => null);
  return { status: response.status, data, location: response.headers.get("location") };
}

function requestReset(instance, targetEmail) {
  return instance.api.requestPasswordReset({
    body: { email: targetEmail, redirectTo: new URL("/reset-password", origin).toString() },
    headers: new Headers({ origin }),
  });
}

function tokenFromCapturedEmail(index) {
  const link = sent[index]?.text.match(/https?:\/\/\S+/)?.[0];
  assert.ok(link, "the fake transport should receive a reset URL");
  return new URL(link);
}

try {
  const createdUser = await auth.api.signUpEmail({ body: { name: "Temporary Reset User", email, password }, headers: new Headers({ origin }) });
  assert.ok(createdUser?.user?.id, "temporary test account should be created");
  const createdRow = await pool.query('SELECT id FROM "user" WHERE email=$1', [email]);
  assert.equal(createdRow.rows[0]?.id, createdUser.user.id, "temporary account should be visible through the shared database pool");
  const known = await requestReset(auth, email);
  assert.equal(known.status, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, email);

  const unknown = await requestReset(auth, `missing-${suffix}@example.invalid`);
  assert.equal(unknown.status, true);
  assert.deepEqual(unknown.data, known.data, "known and unknown addresses must receive the same response");
  assert.equal(sent.length, 1, "unknown addresses must not produce an email");

  const link = tokenFromCapturedEmail(0);
  const redirect = await request(auth, `${link.pathname}${link.search}`);
  assert.equal(redirect.status, 302);
  const finalUrl = new URL(redirect.location, origin);
  assert.equal(finalUrl.pathname, "/reset-password");
  const token = finalUrl.searchParams.get("token");
  assert.ok(token);

  const reset = await request(auth, "/api/auth/reset-password", "POST", { token, newPassword: updatedPassword }, "198.51.100.13");
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  const reused = await request(auth, "/api/auth/reset-password", "POST", { token, newPassword: password }, "198.51.100.14");
  assert.equal(reused.status, 400, "a reset token must be single use");
  const newPasswordSignIn = await request(auth, "/api/auth/sign-in/email", "POST", { email, password: updatedPassword }, "198.51.100.15");
  assert.equal(newPasswordSignIn.status, 200, "the new password should work");
  const oldPasswordSignIn = await request(auth, "/api/auth/sign-in/email", "POST", { email, password }, "198.51.100.16");
  assert.notEqual(oldPasswordSignIn.status, 200, "the previous password must stop working");

  await requestReset(auth, email);
  const expiredLink = tokenFromCapturedEmail(1);
  const row = await pool.query(
    'SELECT id FROM verification WHERE identifier LIKE $1 AND value=$2 ORDER BY "createdAt" DESC LIMIT 1',
    [`reset-password:%`, (await pool.query('SELECT id FROM "user" WHERE email=$1', [email])).rows[0].id],
  );
  assert.ok(row.rows[0]?.id);
  await pool.query('UPDATE verification SET "expiresAt"=CURRENT_TIMESTAMP - INTERVAL \'1 second\' WHERE id=$1', [row.rows[0].id]);
  const expiredRedirect = await request(auth, `${expiredLink.pathname}${expiredLink.search}`);
  assert.equal(expiredRedirect.status, 302);
  assert.equal(new URL(expiredRedirect.location, origin).searchParams.get("error"), "INVALID_TOKEN");

  await authWithFailingTransport.api.signUpEmail({ body: { name: "Temporary SMTP Failure", email: failingEmail, password }, headers: new Headers({ origin }) });
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  let failedDeliveryRequest;
  try {
    failedDeliveryRequest = await requestReset(authWithFailingTransport, failingEmail);
  } finally {
    console.error = originalError;
  }
  assert.equal(failedDeliveryRequest.status, true, "mail failure should preserve the neutral response");
  assert.deepEqual(logged, ["Password reset email delivery failed. EMAIL_SEND_FAILED"]);
  assert.doesNotMatch(JSON.stringify(failedDeliveryRequest), /test-only SMTP diagnostic|password-reset-failed|token/i);

  const rateIp = "198.51.100.19";
  for (let count = 0; count < passwordResetRateLimit.max; count += 1) {
    const limited = await request(auth, "/api/auth/request-password-reset", "POST", { email: `missing-${suffix}@example.invalid`, redirectTo: "/reset-password" }, rateIp);
    assert.equal(limited.status, 200, `request ${count + 1} should stay under the configured limit`);
  }
  const blocked = await request(auth, "/api/auth/request-password-reset", "POST", { email: `missing-${suffix}@example.invalid`, redirectTo: "/reset-password" }, rateIp);
  assert.equal(blocked.status, 429, "the reset endpoint should enforce its per-IP request limit");

  process.stdout.write("Password recovery verification passed: actual Better Auth request/callback/reset routes, neutral unknown-address and SMTP-failure responses, configured rate limit, token expiry and single use, and password change.\n");
} finally {
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [[email, failingEmail]]).catch(() => undefined);
  await pool.end();
}
