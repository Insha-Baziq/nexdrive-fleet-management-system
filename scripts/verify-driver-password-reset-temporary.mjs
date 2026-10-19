import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "../src/lib/db.ts";
import { auth } from "../src/lib/auth.ts";
import { createEmailSender } from "../src/lib/email.ts";
import { createDriverPasswordResetRequester, latestDriverPasswordResetAttempt, sendDriverPasswordResetEmail } from "../src/lib/driver-password-reset.ts";
import { OnboardingError } from "../src/lib/onboarding.ts";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.BETTER_AUTH_SECRET || !process.env.DATABASE_URL) throw new Error("Local environment required");

const suffix = randomUUID();
const tenantId = randomUUID();
const otherTenantId = randomUUID();
const adminEmail = `driver-reset-admin-${suffix}@example.invalid`;
const linkedEmail = `driver-reset-linked-${suffix}@example.invalid`;
const failedEmail = `driver-reset-failed-${suffix}@example.invalid`;
const password = randomBytes(24).toString("base64url");
const changedPassword = randomBytes(24).toString("base64url");
const driverIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const captured = [];
const sender = createEmailSender("nexdrive@example.com", {
  async sendMail(message) { captured.push(message); return { accepted: [message.to] }; },
});
const delivery = createDriverPasswordResetRequester(sender);
const requester = delivery.request;
const failedDelivery = createDriverPasswordResetRequester(createEmailSender("nexdrive@example.com", {
  async sendMail() { throw new Error(`SMTP private diagnostic ${failedEmail}`); },
}));
const failedRequester = failedDelivery.request;

async function addUser(email, name, role, tenant) {
  const created = await auth.api.signUpEmail({ body: { name, email, password }, headers: new Headers({ origin }) });
  assert.ok(created?.user?.id);
  await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2, "emailVerified"=true WHERE id=$3', [tenant, role, created.user.id]);
  return created.user.id;
}

async function addDriver(id, tenant, name, userId = null) {
  await pool.query(
    `INSERT INTO driver (id, tenant_id, full_name, licence_number, licence_expiry_date, user_id)
     VALUES ($1,$2,$3,NULL,NULL,$4)`,
    [id, tenant, name, userId],
  );
}

try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1,$2),($3,$4)", [
    tenantId, `Temporary driver reset ${suffix}`, otherTenantId, `Other driver reset ${suffix}`,
  ]);
  const actorId = await addUser(adminEmail, "Reset Administrator", "administrator", tenantId);
  const linkedId = await addUser(linkedEmail, "Linked Driver", "driver", tenantId);
  const failingId = await addUser(failedEmail, "Failed Delivery Driver", "driver", tenantId);
  await addDriver(driverIds[0], tenantId, "Linked temporary driver", linkedId);
  await addDriver(driverIds[1], tenantId, "Failed delivery temporary driver", failingId);
  await addDriver(driverIds[2], tenantId, "Unlinked temporary driver");
  await addDriver(driverIds[3], otherTenantId, "Other tenant temporary driver");

  const success = await sendDriverPasswordResetEmail(tenantId, driverIds[0], actorId, "198.51.100.91", requester);
  assert.equal(success.deliveryStatus, "sent");
  assert.ok(success.attemptedAt);
  assert.equal(Object.hasOwn(success, "token"), false);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].to, linkedEmail);
  const sentLink = new URL(captured[0].text.match(/https?:\/\/\S+/)?.[0]);
  assert.equal(sentLink.origin, new URL(origin).origin);
  assert.match(sentLink.pathname, /^\/api\/auth\/reset-password\//);
  const sentAudit = await latestDriverPasswordResetAttempt(tenantId, driverIds[0]);
  assert.equal(sentAudit.delivery_status, "sent");
  assert.ok(sentAudit.attempted_at);

  const sentCallback = await delivery.auth.handler(new Request(sentLink, { headers: { origin }, redirect: "manual" }));
  assert.equal(sentCallback.status, 302);
  const callbackTarget = new URL(sentCallback.headers.get("location"), origin);
  const token = callbackTarget.searchParams.get("token");
  assert.ok(token);
  const changed = await delivery.auth.handler(new Request(new URL("/api/auth/reset-password", origin), {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ token, newPassword: changedPassword }),
  }));
  assert.equal(changed.status, 200);
  const newSignIn = await delivery.auth.api.signInEmail({ body: { email: linkedEmail, password: changedPassword }, headers: new Headers({ origin }) });
  assert.ok(newSignIn?.user?.id);

  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(" "));
  let failure;
  try {
    failure = await sendDriverPasswordResetEmail(tenantId, driverIds[1], actorId, "198.51.100.92", failedRequester);
  } finally { console.error = originalError; }
  assert.equal(failure.deliveryStatus, "failed");
  assert.equal(failure.errorCode, "EMAIL_SEND_FAILED");
  assert.equal(JSON.stringify(failure).includes(failedEmail), false);
  assert.equal(logs.length, 2);
  assert.match(logs[0], /ERROR \[Better Auth\]: Failed to run background task: EmailDeliveryError:/);
  assert.equal(logs[1], "Driver password reset email delivery failed. EMAIL_SEND_FAILED");
  assert.doesNotMatch(logs.join(" "), new RegExp(`${failedEmail}|SMTP private diagnostic|reset-password\\?.*token`, "i"));
  const failedAudit = await latestDriverPasswordResetAttempt(tenantId, driverIds[1]);
  assert.equal(failedAudit.delivery_status, "failed");

  await assert.rejects(sendDriverPasswordResetEmail(tenantId, driverIds[2], actorId, undefined, requester),
    (error) => error instanceof OnboardingError && error.status === 404);
  await assert.rejects(sendDriverPasswordResetEmail(tenantId, driverIds[3], actorId, undefined, requester),
    (error) => error instanceof OnboardingError && error.status === 404);
  assert.equal(await latestDriverPasswordResetAttempt(tenantId, driverIds[2]), null);
  assert.equal(await latestDriverPasswordResetAttempt(otherTenantId, driverIds[3]), null);

  process.stdout.write("Driver reset verification passed: tenant-scoped linked-account target, real Better Auth one-use reset link via controlled fake transport, success/failure audit, no token in action result/logs, and unlinked/cross-tenant rejection.\n");
} finally {
  await pool.query("DELETE FROM driver_password_reset_attempt WHERE tenant_id=ANY($1::text[])", [[tenantId, otherTenantId]]).catch(() => undefined);
  await pool.query("DELETE FROM driver WHERE id=ANY($1::uuid[])", [driverIds]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email=ANY($1::text[])', [[adminEmail, linkedEmail, failedEmail]]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id=ANY($1::text[])", [[tenantId, otherTenantId]]).catch(() => undefined);
  await pool.end();
}
