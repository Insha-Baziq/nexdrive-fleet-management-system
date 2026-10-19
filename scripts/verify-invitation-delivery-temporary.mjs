import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { PostgresDialect } from "kysely";
import { pool } from "../src/lib/db.ts";
import { issueInvitation, joinWithExistingAccount, joinWithNewAccount, OnboardingError, previewInvitation, rotateInvitationCode, sendInvitationEmail } from "../src/lib/onboarding.ts";
import { createEmailSender } from "../src/lib/email.ts";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.BETTER_AUTH_SECRET || !process.env.DATABASE_URL) throw new Error("Local environment required");
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(origin).hostname)) throw new Error("Local verification only.");
const fixtureAuth = betterAuth({
  baseURL: origin,
  secret: process.env.BETTER_AUTH_SECRET,
  database: { dialect: new PostgresDialect({ pool }), type: "postgres" },
  emailAndPassword: { enabled: true, autoSignIn: false },
});

const suffix = randomUUID();
const tenantId = randomUUID();
const otherTenantId = randomUUID();
const actorId = `feedback-admin-${suffix}`;
const codeRecipient = `invite-code-${suffix}@example.invalid`;
const newDriverEmail = `invite-new-${suffix}@example.invalid`;
const existingDriverEmail = `invite-existing-${suffix}@example.invalid`;
const wrongDriverEmail = `invite-wrong-${suffix}@example.invalid`;
const password = randomBytes(24).toString("base64url");
const driverIds = [randomUUID(), randomUUID(), randomUUID()];
const messages = [];
const sender = createEmailSender("nexdrive@example.com", {
  async sendMail(message) { messages.push(message); return { accepted: [message.to] }; },
});

async function addDriver(id, tenant) {
  await pool.query(
    `INSERT INTO driver (id, tenant_id, full_name, licence_number, licence_expiry_date)
     VALUES ($1,$2,$3,NULL,NULL)`,
    [id, tenant, `Temporary invitation driver ${id.slice(0, 5)}`],
  );
}

try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1,$2),($3,$4)", [
    tenantId, `Temporary invitation ${suffix}`, otherTenantId, `Other invitation ${suffix}`,
  ]);
  await addDriver(driverIds[0], tenantId);
  await addDriver(driverIds[1], tenantId);
  await addDriver(driverIds[2], otherTenantId);

  const emailInvite = await issueInvitation(tenantId, actorId, { email: `controlled-${suffix}@example.invalid`, role: "manager" });
  const sent = await sendInvitationEmail(tenantId, emailInvite.id, sender, emailInvite.code);
  assert.equal(sent.emailDeliveryStatus, "sent");
  assert.equal(messages[0].to, `controlled-${suffix}@example.invalid`);
  assert.equal(messages[0].subject, "Invitation à rejoindre NexDrive — Temporary invitation " + suffix);
  const link = new URL(messages[0].text.match(/https?:\/\/\S+/)?.[0]);
  assert.equal(link.origin, new URL(process.env.INVITATION_PUBLIC_URL || "https://nexdrive-three.vercel.app").origin);
  assert.equal(link.pathname, "/login");
  assert.equal(link.searchParams.get("invitation"), emailInvite.code);
  const sentRow = await pool.query(
    "SELECT email_delivery_status, email_last_attempt_at, email_last_sent_at FROM organization_invitation WHERE id=$1",
    [emailInvite.id],
  );
  assert.equal(sentRow.rows[0].email_delivery_status, "sent");
  assert.ok(sentRow.rows[0].email_last_attempt_at);
  assert.ok(sentRow.rows[0].email_last_sent_at);

  const resent = await sendInvitationEmail(tenantId, emailInvite.id, sender);
  assert.equal(resent.emailDeliveryStatus, "sent");
  const resentLink = new URL(messages[1].text.match(/https?:\/\/\S+/)?.[0]);
  const resentCode = resentLink.searchParams.get("invitation");
  assert.ok(resentCode);
  assert.notEqual(resentCode, emailInvite.code, "Resending an email invite must rotate its one-time link.");
  await assert.rejects(previewInvitation(emailInvite.code), (error) => error instanceof OnboardingError && error.status === 404);
  assert.equal((await previewInvitation(resentCode)).email, `controlled-${suffix}@example.invalid`);

  const failedInvite = await issueInvitation(tenantId, actorId, { email: `failure-${suffix}@example.invalid`, role: "manager" });
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(" "));
  let failure;
  try {
    failure = await sendInvitationEmail(tenantId, failedInvite.id, async () => {
      throw new Error(`SMTP diagnostic must stay private: ${failedInvite.email} ${failedInvite.code}`);
    });
  } finally { console.error = originalError; }
  assert.equal(failure.emailDeliveryStatus, "failed");
  assert.equal(failure.errorCode, "EMAIL_SEND_FAILED");
  assert.deepEqual(logs, ["Invitation email delivery failed. EMAIL_SEND_FAILED"]);
  const failedRow = await pool.query(
    "SELECT email_delivery_status, email_last_attempt_at, email_last_sent_at FROM organization_invitation WHERE id=$1",
    [failedInvite.id],
  );
  assert.equal(failedRow.rows[0].email_delivery_status, "failed");
  assert.ok(failedRow.rows[0].email_last_attempt_at);
  assert.equal(failedRow.rows[0].email_last_sent_at, null);
  await assert.rejects(sendInvitationEmail(otherTenantId, emailInvite.id, sender), (error) => error instanceof OnboardingError && error.status === 404);

  const codeInvite = await issueInvitation(tenantId, actorId, { role: "manager" });
  assert.equal(codeInvite.email, null);
  await assert.rejects(sendInvitationEmail(tenantId, codeInvite.id, sender), (error) => error instanceof OnboardingError && error.status === 409);
  const hashOnly = await pool.query("SELECT code_hash, code_ciphertext FROM organization_invitation WHERE id=$1", [codeInvite.id]);
  assert.ok(hashOnly.rows[0].code_hash);
  assert.equal(hashOnly.rows[0].code_ciphertext, null);
  const rotatedCode = await rotateInvitationCode(tenantId, codeInvite.id);
  assert.notEqual(rotatedCode, codeInvite.code);
  await assert.rejects(previewInvitation(codeInvite.code), (error) => error instanceof OnboardingError && error.status === 404);
  await assert.rejects(joinWithNewAccount({ code: rotatedCode, name: "Code Recipient", email: codeRecipient, password }),
    (error) => error instanceof OnboardingError && error.status === 409);
  const codeAccount = await fixtureAuth.api.signUpEmail({ body: { name: "Code Recipient", email: codeRecipient, password }, headers: new Headers({ origin }) });
  assert.ok(codeAccount?.user?.id);
  await joinWithExistingAccount(codeAccount.user.id, codeRecipient, null, rotatedCode);
  const joinedCodeAccount = await pool.query('SELECT "tenantId", "appRole" FROM "user" WHERE id=$1', [codeAccount.user.id]);
  assert.equal(joinedCodeAccount.rows[0].tenantId, tenantId);
  assert.equal(joinedCodeAccount.rows[0].appRole, "manager");

  const targetedNew = await issueInvitation(tenantId, actorId, {
    email: newDriverEmail, role: "driver", targetDriverId: driverIds[0],
  });
  const wrongDriverAccount = await fixtureAuth.api.signUpEmail({ body: { name: "Wrong Recipient", email: wrongDriverEmail, password }, headers: new Headers({ origin }) });
  assert.ok(wrongDriverAccount?.user?.id);
  await assert.rejects(joinWithExistingAccount(wrongDriverAccount.user.id, wrongDriverEmail, null, targetedNew.code),
    (error) => error instanceof OnboardingError && error.status === 400);
  const stillUnlinked = await pool.query("SELECT user_id FROM driver WHERE id=$1 AND tenant_id=$2", [driverIds[0], tenantId]);
  assert.equal(stillUnlinked.rows[0].user_id, null);

  const newDriverAccount = await fixtureAuth.api.signUpEmail({ body: { name: "Invited New Driver", email: newDriverEmail, password }, headers: new Headers({ origin }) });
  assert.ok(newDriverAccount?.user?.id);
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [newDriverAccount.user.id]);
  await joinWithExistingAccount(newDriverAccount.user.id, newDriverEmail, null, targetedNew.code);
  const newDriver = await pool.query(
    `SELECT d.user_id, u."tenantId", u."appRole" FROM driver d JOIN "user" u ON u.id=d.user_id WHERE d.id=$1`,
    [driverIds[0]],
  );
  assert.equal(newDriver.rows[0].tenantId, tenantId);
  assert.equal(newDriver.rows[0].appRole, "driver");
  await assert.rejects(joinWithNewAccount({ code: targetedNew.code, name: "Reused", email: newDriverEmail, password }), (error) => error instanceof OnboardingError && error.status === 409);
  await assert.rejects(issueInvitation(tenantId, actorId, { email: `again-${suffix}@example.invalid`, role: "driver", targetDriverId: driverIds[0] }), (error) => error instanceof OnboardingError && error.status === 409);

  const createdExisting = await fixtureAuth.api.signUpEmail({
    body: { name: "Existing Driver", email: existingDriverEmail, password },
    headers: new Headers({ origin }),
  });
  assert.ok(createdExisting?.user?.id);
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [createdExisting.user.id]);
  const targetedExisting = await issueInvitation(tenantId, actorId, {
    email: existingDriverEmail, role: "driver", targetDriverId: driverIds[1],
  });
  await joinWithExistingAccount(createdExisting.user.id, existingDriverEmail, null, targetedExisting.code);
  const linkedExisting = await pool.query(
    `SELECT d.user_id, u."tenantId", u."appRole" FROM driver d JOIN "user" u ON u.id=d.user_id WHERE d.id=$1`,
    [driverIds[1]],
  );
  assert.equal(linkedExisting.rows[0].user_id, createdExisting.user.id);
  assert.equal(linkedExisting.rows[0].tenantId, tenantId);
  assert.equal(linkedExisting.rows[0].appRole, "driver");

  await assert.rejects(issueInvitation(tenantId, actorId, {
    email: `cross-tenant-${suffix}@example.invalid`, role: "driver", targetDriverId: driverIds[2],
  }), (error) => error instanceof OnboardingError && error.status === 409);

  const expired = await issueInvitation(tenantId, actorId, { email: `expired-${suffix}@example.invalid`, role: "manager" });
  await pool.query("UPDATE organization_invitation SET expires_at=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id=$1", [expired.id]);
  await assert.rejects(sendInvitationEmail(tenantId, expired.id, sender), (error) => error instanceof OnboardingError && error.status === 404);
  const revoked = await issueInvitation(tenantId, actorId, { email: `revoked-${suffix}@example.invalid`, role: "manager" });
  await pool.query("UPDATE organization_invitation SET revoked_at=CURRENT_TIMESTAMP WHERE id=$1", [revoked.id]);
  await assert.rejects(sendInvitationEmail(tenantId, revoked.id, sender), (error) => error instanceof OnboardingError && error.status === 404);

  process.stdout.write("Invitation verification passed: fake email delivery and resend rotation, hash-only code storage, verified-account acceptance, recipient binding, driver joins, tenant checks, single use, and expired/revoked protection.\n");
} finally {
  await pool.query("DELETE FROM organization_invitation WHERE tenant_id = ANY($1::text[])", [[tenantId, otherTenantId]]).catch(() => undefined);
  await pool.query("DELETE FROM driver_password_reset_attempt WHERE tenant_id = ANY($1::text[])", [[tenantId, otherTenantId]]).catch(() => undefined);
  await pool.query("DELETE FROM driver WHERE id = ANY($1::uuid[])", [driverIds]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [[codeRecipient, newDriverEmail, existingDriverEmail, wrongDriverEmail]]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [[tenantId, otherTenantId]]).catch(() => undefined);
  await pool.end();
}
