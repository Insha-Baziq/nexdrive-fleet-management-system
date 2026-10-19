import "server-only";
import { createTransport } from "nodemailer";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailTransport = {
  sendMail(message: OutgoingEmail & { from: string }): Promise<unknown>;
};

export const passwordResetRateLimit = { window: 60, max: 3 } as const;

export class EmailDeliveryError extends Error {
  constructor(public readonly code: "EMAIL_NOT_CONFIGURED" | "EMAIL_SEND_FAILED") {
    super(code === "EMAIL_NOT_CONFIGURED"
      ? "L’envoi des e-mails n’est pas configuré."
      : "L’envoi de l’e-mail a échoué. Réessayez plus tard.");
    this.name = "EmailDeliveryError";
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

export function createEmailSender(from: string, transport: EmailTransport) {
  return async (message: OutgoingEmail) => {
    try {
      await transport.sendMail({ ...message, from });
    } catch {
      // Do not expose SMTP diagnostics, which can contain addresses or transport details.
      throw new EmailDeliveryError("EMAIL_SEND_FAILED");
    }
  };
}

function configuredGmailSender() {
  const user = process.env.GMAIL_SMTP_USER?.trim();
  const password = process.env.GMAIL_SMTP_APP_PASSWORD?.replace(/\s+/g, "");
  const from = process.env.GMAIL_SMTP_FROM?.trim();
  if (!user || !password || !from) throw new EmailDeliveryError("EMAIL_NOT_CONFIGURED");

  const transport = createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: password },
  });
  return createEmailSender(from, transport);
}

export async function sendEmail(message: OutgoingEmail) {
  return configuredGmailSender()(message);
}

export async function sendPasswordResetEmail(
  input: { to: string; resetUrl: string },
  sender: (message: OutgoingEmail) => Promise<void> = sendEmail,
) {
  try {
    await sender(passwordResetEmail({ ...input, expirationMinutes: 60 }));
  } catch (error) {
    const code = error instanceof EmailDeliveryError ? error.code : "EMAIL_SEND_FAILED";
    // Reset requests always return the same response to protect account privacy.
    console.error("Password reset email delivery failed.", code);
  }
}

export function passwordResetSettings(sender: (message: OutgoingEmail) => Promise<void> = sendEmail) {
  return {
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
      await sendPasswordResetEmail({ to: user.email, resetUrl: url }, sender);
    },
  };
}

function htmlEmail(title: string, intro: string, actionLabel: string, actionUrl: string, note: string) {
  const introHtml = escapeHtml(intro).replace(/\r?\n/g, "<br>");
  const safeActionUrl = escapeHtml(actionUrl);
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f6f5;font-family:Arial,Helvetica,sans-serif;color:#17202b;-webkit-text-size-adjust:100%;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f3f6f5;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #e3eae7;border-radius:14px;">
            <tr>
              <td align="center" style="padding:34px 28px 12px;">
                <p style="margin:0;text-align:center;font-size:23px;line-height:30px;font-weight:700;letter-spacing:-0.7px;color:#17202b;">
                  <span style="color:#176957;letter-spacing:-4px;margin-right:8px;">//</span>NexDrive
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:14px 36px 0;">
                <h1 style="margin:0;text-align:center;font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.4px;color:#17202b;">${escapeHtml(title)}</h1>
                <p style="margin:16px 0 0;text-align:center;font-size:15px;line-height:25px;color:#52615d;">${introHtml}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:26px 24px 24px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                  <tr>
                    <td align="center" bgcolor="#176957" style="border-radius:8px;background-color:#176957;">
                      <a href="${safeActionUrl}" style="display:inline-block;padding:14px 24px;border:1px solid #176957;border-radius:8px;color:#ffffff;text-align:center;text-decoration:none;font-size:15px;line-height:20px;font-weight:700;">${escapeHtml(actionLabel)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 36px 26px;">
                <p style="margin:0;text-align:center;font-size:13px;line-height:21px;color:#687772;">${escapeHtml(note).replace(/\r?\n/g, "<br>")}</p>
                <p style="margin:20px 0 0;text-align:center;font-size:12px;line-height:19px;color:#7c8985;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :</p>
                <p style="margin:6px 0 0;text-align:center;font-size:12px;line-height:19px;word-break:break-all;"><a href="${safeActionUrl}" style="color:#176957;text-decoration:underline;">${safeActionUrl}</a></p>
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0;text-align:center;font-size:12px;line-height:18px;color:#82908b;">NexDrive · Gestion de flotte</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function passwordResetEmail(input: { to: string; resetUrl: string; expirationMinutes: number }): OutgoingEmail {
  const { to, resetUrl, expirationMinutes } = input;
  const title = "Réinitialisation de votre mot de passe";
  const intro = "Une demande de réinitialisation du mot de passe de votre compte NexDrive a été effectuée.";
  const actionLabel = "Choisir un nouveau mot de passe";
  const note = `Ce lien à usage unique expirera dans ${expirationMinutes} minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.`;
  return {
    to,
    subject: title,
    text: `${title}\n\n${intro}\n\n${actionLabel} : ${resetUrl}\n\n${note}`,
    html: htmlEmail(title, intro, actionLabel, resetUrl, note),
  };
}

export function emailVerificationEmail(input: { to: string; verificationUrl: string }): OutgoingEmail {
  const { to, verificationUrl } = input;
  const title = "Confirmez votre adresse e-mail | Verify your email address";
  const intro = "Confirmez que cette adresse e-mail vous appartient pour sécuriser votre compte NexDrive.\n\nConfirm that you own this email address to secure your NexDrive account.";
  const actionLabel = "Confirmer l’adresse e-mail | Verify email address";
  const note = "Ce lien à usage unique expire dans une heure. Si vous n’avez pas créé ce compte, ignorez cet e-mail.\n\nThis one-time link expires in one hour. If you did not create this account, ignore this email.";
  return {
    to,
    subject: title,
    text: `${title}\n\n${intro}\n\n${actionLabel} : ${verificationUrl}\n\n${note}`,
    html: htmlEmail(title, intro, actionLabel, verificationUrl, note),
  };
}

const roleLabels = {
  administrator: "Administrateur",
  fleet_manager: "Responsable de flotte",
  manager: "Gestionnaire",
  driver: "Conducteur",
} as const;

export function organizationInvitationEmail(input: {
  to: string;
  organizationName: string;
  role: keyof typeof roleLabels;
  invitationUrl: string;
  expirationDays: number;
}): OutgoingEmail {
  const { to, organizationName, role, invitationUrl, expirationDays } = input;
  const title = "Invitation à rejoindre NexDrive";
  const intro = `${organizationName} vous invite à rejoindre son organisation dans NexDrive. Votre rôle sera : ${roleLabels[role]}.`;
  const actionLabel = "Rejoindre l’organisation";
  const note = `Ce lien à usage unique expirera dans ${expirationDays} jours. Il est réservé à cette adresse e-mail.`;
  return {
    to,
    subject: `${title} — ${organizationName}`,
    text: `${title}\n\n${intro}\n\n${actionLabel} : ${invitationUrl}\n\n${note}`,
    html: htmlEmail(title, intro, actionLabel, invitationUrl, note),
  };
}

export function buildInvitationUrl(code: string) {
  const configuredOrigin = process.env.INVITATION_PUBLIC_URL?.trim() || "https://nexdrive-three.vercel.app";
  if (!configuredOrigin) throw new EmailDeliveryError("EMAIL_NOT_CONFIGURED");

  let origin: URL;
  try { origin = new URL(configuredOrigin); }
  catch { throw new EmailDeliveryError("EMAIL_NOT_CONFIGURED"); }
  const isLocal = origin.hostname === "localhost" || origin.hostname === "[::1]" || origin.hostname.startsWith("127.");
  if ((origin.protocol !== "https:" || isLocal) || origin.username || origin.password) {
    throw new EmailDeliveryError("EMAIL_NOT_CONFIGURED");
  }

  const link = new URL("/login", origin.origin);
  link.searchParams.set("invitation", code);
  return link.toString();
}
