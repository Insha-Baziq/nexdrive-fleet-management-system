import "server-only";
import { randomUUID } from "node:crypto";
import { createPasswordResetDeliveryAuth } from "@/lib/auth";
import { EmailDeliveryError, sendEmail, type OutgoingEmail } from "@/lib/email";
import { pool } from "@/lib/db";
import { OnboardingError } from "@/lib/onboarding";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PasswordResetRequest = (input: {
  body: { email: string; redirectTo: string };
  headers: Headers;
}) => Promise<{ status: boolean; deliveryStatus?: "sent" | "failed" | "not_sent"; errorCode?: string }>;

export function createDriverPasswordResetRequester(sender: (message: OutgoingEmail) => Promise<void>) {
  let deliveryStatus: "sent" | "failed" | null = null;
  let errorCode: string | undefined;
  const trackedAuth = createPasswordResetDeliveryAuth(async (message) => {
    try {
      await sender(message);
      deliveryStatus = "sent";
    } catch (error) {
      deliveryStatus = "failed";
      errorCode = error instanceof EmailDeliveryError ? error.code : "EMAIL_SEND_FAILED";
      throw error;
    }
  });
  return {
    auth: trackedAuth,
    request: async (input: Parameters<PasswordResetRequest>[0]) => {
      deliveryStatus = null;
      errorCode = undefined;
      const result = await trackedAuth.api.requestPasswordReset(input);
      return {
        status: result.status,
        deliveryStatus: deliveryStatus ?? "not_sent",
        errorCode,
      };
    },
  };
}

export async function latestDriverPasswordResetAttempt(tenantId: string, driverId: string) {
  const result = await pool.query<{ attempted_at: Date; delivery_status: "sent" | "failed" }>(
    `SELECT attempted_at, delivery_status FROM driver_password_reset_attempt
     WHERE tenant_id=$1 AND driver_id=$2
     ORDER BY attempted_at DESC, id DESC LIMIT 1`,
    [tenantId, driverId],
  );
  return result.rows[0] ?? null;
}

export async function sendDriverPasswordResetEmail(
  tenantId: string,
  driverId: string,
  actorUserId: string,
  forwardedFor?: string | null,
  requester?: PasswordResetRequest,
  sender?: (message: OutgoingEmail) => Promise<void>,
) {
  if (!uuidPattern.test(driverId)) throw new OnboardingError(404, "Driver not found or no linked account.");
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!baseURL) throw new EmailDeliveryError("EMAIL_NOT_CONFIGURED");
  const user = await pool.query<{ email: string }>(
    `SELECT u.email FROM driver d JOIN "user" u
       ON u.id=d.user_id AND EXISTS (SELECT 1 FROM organization_membership membership WHERE membership.user_id=u.id AND membership.tenant_id=d.tenant_id AND membership.role='driver' AND membership.disabled_at IS NULL)
     WHERE d.id=$1 AND d.tenant_id=$2 AND d.archived_at IS NULL AND d.user_id IS NOT NULL`,
    [driverId, tenantId],
  );
  const email = user.rows[0]?.email;
  if (!email) throw new OnboardingError(404, "Driver not found or no linked account.");

  const attemptId = randomUUID();
  const attempt = await pool.query<{ attempted_at: Date }>(
    `INSERT INTO driver_password_reset_attempt
       (id, tenant_id, driver_id, actor_user_id, delivery_status)
     VALUES ($1,$2,$3,$4,'failed') RETURNING attempted_at`,
    [attemptId, tenantId, driverId, actorUserId],
  );
  const attemptedAt = attempt.rows[0].attempted_at.toISOString();
  const headers = new Headers({ origin: baseURL });
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  try {
    const resetRequest = requester ?? createDriverPasswordResetRequester(sender ?? sendEmail).request;
    const result = await resetRequest({
      body: { email, redirectTo: new URL("/reset-password", baseURL).toString() },
      headers,
    });
    if (!result.status || result.deliveryStatus !== "sent") {
      throw new EmailDeliveryError(result.errorCode === "EMAIL_NOT_CONFIGURED" ? "EMAIL_NOT_CONFIGURED" : "EMAIL_SEND_FAILED");
    }
    await pool.query(
      "UPDATE driver_password_reset_attempt SET delivery_status='sent' WHERE id=$1 AND tenant_id=$2",
      [attemptId, tenantId],
    );
    return { deliveryStatus: "sent" as const, attemptedAt };
  } catch (error) {
    const errorCode = error instanceof EmailDeliveryError ? error.code : "EMAIL_SEND_FAILED";
    console.error("Driver password reset email delivery failed.", errorCode);
    return { deliveryStatus: "failed" as const, attemptedAt, errorCode };
  }
}
