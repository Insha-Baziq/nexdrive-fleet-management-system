import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { PostgresDialect } from "kysely";
import { pool } from "@/lib/db";
import { emailVerificationEmail, passwordResetEmail, passwordResetRateLimit, passwordResetSettings, sendEmail, type OutgoingEmail } from "@/lib/email";

const baseURL = process.env.BETTER_AUTH_URL;
const secret = process.env.BETTER_AUTH_SECRET;

if (!baseURL || !secret) {
  throw new Error("BETTER_AUTH_URL and BETTER_AUTH_SECRET are required");
}

function createAuth(resetEmailSender?: (message: OutgoingEmail) => Promise<void>) {
  const resetSettings = resetEmailSender ? {
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
      await resetEmailSender(passwordResetEmail({ to: user.email, resetUrl: url, expirationMinutes: 60 }));
    },
  } : passwordResetSettings();

  return betterAuth({
    appName: "NexDrive",
    baseURL,
    secret,
    database: {
      dialect: new PostgresDialect({ pool }),
      type: "postgres",
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      ...resetSettings,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        await (resetEmailSender ?? sendEmail)(emailVerificationEmail({ to: user.email, verificationUrl: url }));
      },
      afterEmailVerification: async (user) => {
        await pool.query(
          'UPDATE "user" SET "emailVerifiedAt"=CURRENT_TIMESTAMP WHERE id=$1',
          [user.id],
        );
      },
    },
    rateLimit: {
      enabled: true,
      customRules: {
        "/request-password-reset": passwordResetRateLimit,
        "/send-verification-email": { window: 60, max: 3 },
        // The local regression suite signs in several isolated fixtures at once.
        // Keep Better Auth's strict default in production while allowing those
        // parallel fixture logins in the development server.
        ...(process.env.NODE_ENV === "production"
          ? {}
          : { "/sign-in/email": { window: 10, max: 1000 } }),
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Only the server-side onboarding routes may create accounts. Better Auth
        // still owns password hashing and the credential account.
        if (ctx.path === "/sign-up/email" && ctx.request && ctx.headers?.get("x-nexdrive-onboarding-key") !== secret) {
          throw new APIError("BAD_REQUEST", {
            code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
            message: "Use NexDrive onboarding to create an account.",
          });
        }
      }),
    },
    user: {
      additionalFields: {
        tenantId: {
          type: "string",
          required: false,
          input: false,
        },
        appRole: {
          type: ["administrator", "fleet_manager", "manager", "driver"],
          required: false,
          input: false,
        },
      },
    },
  });
}

export const auth = createAuth();

// The administrator-only driver reset path needs delivery success/failure so it
// can audit the attempt. Public reset requests keep the neutral error response.
export function createPasswordResetDeliveryAuth(sender: (message: OutgoingEmail) => Promise<void> = sendEmail) {
  return createAuth(sender);
}
