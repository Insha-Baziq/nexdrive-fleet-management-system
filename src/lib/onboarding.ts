import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { auth, createPasswordResetDeliveryAuth } from "@/lib/auth";
import { APIError } from "better-auth/api";
import { pool } from "@/lib/db";
import type { AppRole } from "@/lib/organization-session";
import { buildInvitationUrl, EmailDeliveryError, organizationInvitationEmail, sendEmail, type OutgoingEmail } from "@/lib/email";

export class OnboardingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type InvitationRow = {
  id: string; tenant_id: string; email: string | null; role: AppRole;
  name: string; expires_at: Date; used_at: Date | null; revoked_at: Date | null;
  target_driver_id: string | null;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const inviteRoles: AppRole[] = ["administrator", "fleet_manager", "manager", "driver"];

function requiredText(value: unknown, label: string, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new OnboardingError(400, `Enter a valid ${label}.`);
  }
  return value.trim();
}

function emailAddress(value: unknown) {
  const email = requiredText(value, "email address", 254).toLowerCase();
  if (!emailPattern.test(email)) throw new OnboardingError(400, "Enter a valid email address.");
  return email;
}

function passwordText(value: unknown) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new OnboardingError(400, "Use a password between 8 and 128 characters.");
  }
  return value;
}

function invitationHash(code: string) {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

function newInvitationCode() {
  return randomBytes(32).toString("hex").toUpperCase();
}

type VerificationEmailSender = (message: OutgoingEmail) => Promise<void>;

async function signup(
  name: string,
  email: string,
  password: string,
  callbackURL = "/login?verified=1",
  verificationEmailSender?: VerificationEmailSender,
) {
  const existing = await pool.query('SELECT id FROM "user" WHERE lower(email)=$1', [email]);
  if (existing.rows[0]) throw new OnboardingError(409, "An account with this email already exists. Sign in to continue.");
  const signupAuth = verificationEmailSender ? createPasswordResetDeliveryAuth(verificationEmailSender) : auth;
  let result;
  try { result = await signupAuth.api.signUpEmail({
    body: { name, email, password, callbackURL },
    headers: new Headers({
      origin: process.env.BETTER_AUTH_URL!,
      "x-nexdrive-onboarding-key": process.env.BETTER_AUTH_SECRET!,
    }),
  }); } catch (error) {
    if (error instanceof APIError && error.body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
      throw new OnboardingError(409, "An account with this email already exists. Sign in to continue.");
    }
    throw error;
  }
  if (!result?.user?.id) throw new OnboardingError(400, "This account could not be created.");
  // Better Auth can return a synthetic duplicate-signup response when automatic
  // sign-in is disabled. Never create a membership for that synthetic identity.
  const registered = await pool.query('SELECT id FROM "user" WHERE id=$1 AND lower(email)=$2', [result.user.id, email]);
  if (!registered.rows[0]) throw new OnboardingError(409, "An account with this email already exists. Sign in to continue.");
  return result.user.id;
}

async function removeIncompleteUser(userId: string | null) {
  if (!userId) return;
  await pool.query('DELETE FROM "user" WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM organization_membership WHERE user_id=$1)', [userId]).catch(() => undefined);
}

export async function registerAccount(input: unknown) {
  if (!input || typeof input !== "object") throw new OnboardingError(400, "Invalid form.");
  const body = input as Record<string, unknown>;
  const email = emailAddress(body.email);
  const name = requiredText(body.name, "full name");
  let callbackURL = "/login?verified=1";
  if (body.invitationCode !== undefined) {
    if (typeof body.invitationCode !== "string" || body.invitationCode.trim().length < 20 || body.invitationCode.trim().length > 80) {
      throw new OnboardingError(400, "This invitation is invalid or expired.");
    }
    const code = body.invitationCode.trim();
    const invite = await findInvitation(code);
    if (invite.email && invite.email !== email) {
      throw new OnboardingError(400, `This invitation is reserved for ${invite.email}. Use that email address to create the account.`);
    }
    callbackURL = `/login?verified=1&invitation=${encodeURIComponent(code)}`;
  }
  await signup(name, email, passwordText(body.password), callbackURL);
  return { success: true, emailVerificationRequired: true };
}

export async function createOrganization(input: unknown, account?: { id: string; name: string }) {
  if (!input || typeof input !== "object") throw new OnboardingError(400, "Invalid form.");
  const body = input as Record<string, unknown>;
  const organizationName = requiredText(body.organizationName, "organization name");
  const name = account?.name ?? requiredText(body.name, "full name");
  const email = account ? "" : emailAddress(body.email);
  const password = account ? "" : passwordText(body.password);
  if (body.country !== "FR" || body.timezone !== "Europe/Paris") {
    throw new OnboardingError(400, "Choose the supported country and time zone.");
  }
  const client = await pool.connect();
  let userId: string | null = null;
  try {
    await client.query("BEGIN");
    const tenantId = randomUUID();
    await client.query(
      "INSERT INTO tenant (id, name, country_code, timezone, currency_code) VALUES ($1,$2,'FR','Europe/Paris','EUR')",
      [tenantId, organizationName],
    );
    userId = account?.id ?? await signup(name, email, password);
    await client.query('INSERT INTO organization_membership(user_id, tenant_id, role, display_name) VALUES($1,$2,$3,$4)',
      [userId, tenantId, "administrator", name]);
    await client.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2 WHERE id=$3 AND "tenantId" IS NULL', [tenantId, "administrator", userId]);
    await client.query("COMMIT");
    return { organizationName, tenantId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (!account) await removeIncompleteUser(userId);
    if (error instanceof OnboardingError) throw error;
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new OnboardingError(409, "An account with this email already exists.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function createPlatformOrganizationUser(
  tenantId: string,
  input: unknown,
  verificationEmailSender?: VerificationEmailSender,
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new OnboardingError(400, "Invalid user form.");
  }
  const body = input as Record<string, unknown>;
  const name = requiredText(body.name, "full name");
  const email = emailAddress(body.email);
  const password = passwordText(body.password);
  if (!inviteRoles.includes(body.role as AppRole)) {
    throw new OnboardingError(400, "Choose a valid organization role.");
  }
  const role = body.role as AppRole;
  const organization = await pool.query<{ name: string }>("SELECT name FROM tenant WHERE id=$1", [tenantId]);
  if (!organization.rows[0]) throw new OnboardingError(404, "Organization not found.");

  const userId = await signup(name, email, password, undefined, verificationEmailSender);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockedOrganization = await client.query<{ name: string }>("SELECT name FROM tenant WHERE id=$1 FOR UPDATE", [tenantId]);
    if (!lockedOrganization.rows[0]) throw new OnboardingError(404, "Organization not found.");
    await client.query(
      "INSERT INTO organization_membership(user_id, tenant_id, role, display_name) VALUES($1,$2,$3,$4)",
      [userId, tenantId, role, name],
    );
    await client.query(
      'UPDATE "user" SET "tenantId"=$1, "appRole"=$2 WHERE id=$3 AND "tenantId" IS NULL',
      [tenantId, role, userId],
    );
    await client.query("COMMIT");
    return { id: userId, name, email, role, emailVerified: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await removeIncompleteUser(userId);
    if (error instanceof OnboardingError) throw error;
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new OnboardingError(409, "An account with this email or organization membership already exists.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function issueInvitation(tenantId: string, actorId: string, input: unknown) {
  if (!input || typeof input !== "object") throw new OnboardingError(400, "Invalid form.");
  const body = input as Record<string, unknown>;
  const email = body.email === undefined ? null : emailAddress(body.email);
  const role = body.role;
  if (!inviteRoles.includes(role as AppRole)) throw new OnboardingError(400, "Choose a valid role.");
  let targetDriverId: string | null = null;
  if (body.targetDriverId !== undefined && body.targetDriverId !== null && body.targetDriverId !== "") {
    if (typeof body.targetDriverId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.targetDriverId)) {
      throw new OnboardingError(400, "Choose a valid driver.");
    }
    if (role !== "driver" || !email) throw new OnboardingError(400, "A driver invitation needs a recipient email address.");
    targetDriverId = body.targetDriverId;
  }
  const code = newInvitationCode();
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (email) {
      const existing = await client.query(
        `SELECT u.id FROM "user" u JOIN organization_membership m ON m.user_id=u.id
         WHERE lower(u.email)=$1 AND m.tenant_id=$2`, [email, tenantId],
      );
      if (existing.rows[0]) throw new OnboardingError(409, "This account already belongs to this organization.");
    }
    if (targetDriverId) {
      const driver = await client.query(
        `SELECT id FROM driver
         WHERE id=$1 AND tenant_id=$2 AND user_id IS NULL AND archived_at IS NULL FOR UPDATE`,
        [targetDriverId, tenantId],
      );
      if (!driver.rows[0]) throw new OnboardingError(409, "This driver is already linked or unavailable.");
    }
    await client.query(
      `INSERT INTO organization_invitation
        (id, tenant_id, email, role, code_hash, code_ciphertext, created_by_user_id, expires_at, target_driver_id)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,CURRENT_TIMESTAMP + INTERVAL '7 days',$7)`,
      [id, tenantId, email, role, invitationHash(code), actorId, targetDriverId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { id, code, email, role, targetDriverId, expiresInDays: 7 };
}

export async function listInvitations(tenantId: string) {
  const result = await pool.query<{
    id: string; email: string | null; role: AppRole; created_at: Date; expires_at: Date; copyable: boolean;
    email_delivery_status: "not_sent" | "sent" | "failed";
    email_last_attempt_at: Date | null; email_last_sent_at: Date | null;
    target_driver_id: string | null; target_driver_name: string | null;
  }>(
    `SELECT i.id, i.email, i.role, i.created_at, i.expires_at,
       (i.email IS NULL) AS copyable, i.email_delivery_status,
       i.email_last_attempt_at, i.email_last_sent_at, i.target_driver_id,
       d.full_name AS target_driver_name
     FROM organization_invitation i
     LEFT JOIN driver d ON d.id=i.target_driver_id AND d.tenant_id=i.tenant_id
     WHERE i.tenant_id=$1 AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>CURRENT_TIMESTAMP
     ORDER BY i.created_at DESC`,
    [tenantId],
  );
  return result.rows;
}

export async function listInvitableDrivers(tenantId: string) {
  const result = await pool.query<{ id: string; full_name: string }>(
    `SELECT id, full_name FROM driver
     WHERE tenant_id=$1 AND user_id IS NULL AND archived_at IS NULL
     ORDER BY full_name ASC, id ASC`,
    [tenantId],
  );
  return result.rows;
}

export type InvitationEmailSender = (message: OutgoingEmail) => Promise<void>;

type InvitationEmailRow = {
  id: string;
  email: string | null;
  role: AppRole;
  name: string;
  expires_at: Date;
  code_hash: string;
};

export async function sendInvitationEmail(
  tenantId: string,
  invitationId: string,
  sender: InvitationEmailSender = sendEmail,
  suppliedCode?: unknown,
) {
  const client = await pool.connect();
  let invitation: InvitationEmailRow | undefined;
  let code: string;
  try {
    await client.query("BEGIN");
    const result = await client.query<InvitationEmailRow>(
      `SELECT i.id, i.email, i.role, i.expires_at, i.code_hash, t.name
       FROM organization_invitation i JOIN tenant t ON t.id=i.tenant_id
       WHERE i.id=$1 AND i.tenant_id=$2 AND i.used_at IS NULL AND i.revoked_at IS NULL
         AND i.expires_at>CURRENT_TIMESTAMP FOR UPDATE OF i`,
      [invitationId, tenantId],
    );
    invitation = result.rows[0];
    if (!invitation) throw new OnboardingError(404, "Invitation not found or expired.");
    if (!invitation.email) throw new OnboardingError(409, "Add a recipient email address by creating a new invitation.");
    if (suppliedCode === undefined) {
      code = newInvitationCode();
    } else {
      if (typeof suppliedCode !== "string" || suppliedCode.trim().length < 20 || suppliedCode.trim().length > 80) {
        throw new OnboardingError(400, "This invitation code is invalid.");
      }
      code = suppliedCode.trim().toUpperCase();
      if (invitation.code_hash !== invitationHash(code)) {
        throw new OnboardingError(409, "This invitation has changed. Refresh the invitation and try again.");
      }
    }
    await client.query(
      `UPDATE organization_invitation
       SET code_hash=$3, code_ciphertext=NULL, email_delivery_status='failed', email_last_attempt_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND tenant_id=$2`,
      [invitationId, tenantId, invitationHash(code)],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const deliveryCode = (error: unknown) => error instanceof EmailDeliveryError ? error.code : "EMAIL_SEND_FAILED";
  try {
    const expirationDays = Math.max(1, Math.ceil((new Date(invitation.expires_at).getTime() - Date.now()) / 86_400_000));
    await sender(organizationInvitationEmail({
      to: invitation.email!,
      organizationName: invitation.name,
      role: invitation.role,
      invitationUrl: buildInvitationUrl(code),
      expirationDays,
    }));
    await pool.query(
      `UPDATE organization_invitation SET email_delivery_status='sent', email_last_sent_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND tenant_id=$2`,
      [invitationId, tenantId],
    );
    return { emailDeliveryStatus: "sent" as const, emailLastAttemptAt: new Date().toISOString() };
  } catch (error) {
    const code = deliveryCode(error);
    console.error("Invitation email delivery failed.", code);
    // The row is marked failed before SMTP starts, so a database error after send
    // cannot incorrectly report a successful delivery.
    return { emailDeliveryStatus: "failed" as const, emailLastAttemptAt: new Date().toISOString(), errorCode: code };
  }
}

export async function rotateInvitationCode(tenantId: string, invitationId: string) {
  const client = await pool.connect();
  const code = newInvitationCode();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ email: string | null }>(
      `SELECT email FROM organization_invitation
       WHERE id=$1 AND tenant_id=$2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP
       FOR UPDATE`,
      [invitationId, tenantId],
    );
    if (!result.rows[0]) throw new OnboardingError(404, "Invitation not found or expired.");
    if (result.rows[0].email) throw new OnboardingError(409, "Email invitations must be resent to generate a fresh link.");
    await client.query(
      "UPDATE organization_invitation SET code_hash=$3, code_ciphertext=NULL WHERE id=$1 AND tenant_id=$2",
      [invitationId, tenantId, invitationHash(code)],
    );
    await client.query("COMMIT");
    return code;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeInvitation(tenantId: string, actorId: string, invitationId: string) {
  const result = await pool.query(
    `UPDATE organization_invitation SET revoked_at=CURRENT_TIMESTAMP, revoked_by_user_id=$3
     WHERE id=$1 AND tenant_id=$2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP
     RETURNING id`,
    [invitationId, tenantId, actorId],
  );
  if (!result.rowCount) throw new OnboardingError(404, "Invitation not found or expired.");
}

async function findInvitation(code: unknown, lockClient?: { query: typeof pool.query }) {
  if (typeof code !== "string" || code.trim().length < 20 || code.trim().length > 80) {
    throw new OnboardingError(404, "Invitation not found or expired.");
  }
  const db = lockClient ?? pool;
  const result = await db.query<InvitationRow>(
    `SELECT i.id, i.tenant_id, i.email, i.role, i.expires_at, i.used_at, i.revoked_at,
       i.target_driver_id, t.name
     FROM organization_invitation i JOIN tenant t ON t.id=i.tenant_id
     WHERE i.code_hash=$1 ${lockClient ? "FOR UPDATE OF i" : ""}`,
    [invitationHash(code)],
  );
  const invite = result.rows[0];
  if (!invite || invite.used_at || invite.revoked_at || new Date(invite.expires_at).getTime() <= Date.now()) {
    throw new OnboardingError(404, "Invitation not found or expired.");
  }
  return invite;
}

export async function previewInvitation(code: unknown) {
  const invite = await findInvitation(code);
  return { organizationName: invite.name, role: invite.role, email: invite.email };
}

export async function joinWithNewAccount(input: unknown) {
  void input;
  throw new OnboardingError(409, "Create your account, verify your email, and sign in before accepting an invitation.");
}

export async function joinWithExistingAccount(userId: string, userEmail: string, _legacyTenantId: string | null | undefined, code: unknown) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const invite = await findInvitation(code, client);
    if (invite.email && invite.email !== userEmail.toLowerCase()) throw new OnboardingError(400, "Use the account named on the invitation.");
    // Serialize acceptance by the same account, including different codes for
    // the same organization. Role and tenant always come from the locked invite.
    const user = await client.query<{ name: string; email: string; email_verified: boolean }>(
      'SELECT name, email, "emailVerified" AS email_verified FROM "user" WHERE id=$1 FOR UPDATE',
      [userId],
    );
    if (!user.rows[0]) throw new OnboardingError(401, "Sign in required.");
    if (user.rows[0].email.toLowerCase() !== userEmail.toLowerCase()) throw new OnboardingError(401, "Your sign-in has changed. Sign in again.");
    if (invite.email && invite.email !== user.rows[0].email.toLowerCase()) {
      throw new OnboardingError(403, `This invitation was sent to ${invite.email}. Sign in with that account.`);
    }
    if (invite.email && !user.rows[0].email_verified) {
      throw new OnboardingError(403, "Verify your email address before accepting this invitation.");
    }
    const member = await client.query('SELECT user_id FROM organization_membership WHERE user_id=$1 AND tenant_id=$2', [userId, invite.tenant_id]);
    if (member.rows[0]) throw new OnboardingError(409, "You already belong to this organization. Contact its administrator if your access is suspended.");
    await client.query('INSERT INTO organization_membership(user_id, tenant_id, role, display_name) VALUES($1,$2,$3,$4)',
      [userId, invite.tenant_id, invite.role, user.rows[0].name]);
    await client.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2 WHERE id=$3 AND "tenantId" IS NULL', [invite.tenant_id, invite.role, userId]);
    await linkInvitationDriver(client, invite, userId);
    await client.query(
      "UPDATE organization_invitation SET used_at=CURRENT_TIMESTAMP, accepted_by_user_id=$1 WHERE id=$2",
      [userId, invite.id],
    );
    await client.query("COMMIT");
    return { organizationName: invite.name, tenantId: invite.tenant_id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function linkInvitationDriver(client: { query: typeof pool.query }, invite: InvitationRow, userId: string) {
  if (!invite.target_driver_id) return;
  if (invite.role !== "driver") throw new OnboardingError(409, "This driver invitation is invalid.");
  const linked = await client.query(
    `UPDATE driver SET user_id=$3, updated_at=CURRENT_TIMESTAMP
     WHERE id=$1 AND tenant_id=$2 AND user_id IS NULL AND archived_at IS NULL
     RETURNING id`,
    [invite.target_driver_id, invite.tenant_id, userId],
  );
  if (!linked.rowCount) throw new OnboardingError(409, "This driver is already linked or unavailable.");
}
