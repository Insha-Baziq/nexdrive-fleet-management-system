import assert from "node:assert/strict";
import { buildInvitationUrl, createEmailSender, EmailDeliveryError, organizationInvitationEmail, passwordResetEmail, sendEmail, sendPasswordResetEmail } from "../src/lib/email.ts";

const captured = [];
const sender = createEmailSender("nexdrive@example.com", {
  async sendMail(message) { captured.push(message); return { accepted: [message.to] }; },
});

const reset = passwordResetEmail({
  to: "controlled@example.invalid",
  resetUrl: "https://nexdrive.example/reset-password?token=single-use",
  expirationMinutes: 60,
});
await sender(reset);
assert.equal(captured[0].to, "controlled@example.invalid");
assert.equal(captured[0].subject, "Réinitialisation de votre mot de passe");
assert.match(captured[0].text, /single-use/);
assert.match(captured[0].html, /lang="fr"/);

const invitation = organizationInvitationEmail({
  to: "controlled@example.invalid",
  organizationName: "<Client & Co>",
  role: "driver",
  invitationUrl: "https://nexdrive.example/signup/join?code=one-time-code",
  expirationDays: 7,
});
await sender(invitation);
assert.match(captured[1].html, /&lt;Client &amp; Co&gt;/);
assert.match(captured[1].text, /Conducteur/);
assert.match(captured[1].text, /one-time-code/);

const failingSender = createEmailSender("nexdrive@example.com", {
  async sendMail() { throw new Error("SMTP AUTH failed; private transport detail"); },
});
await assert.rejects(failingSender(reset), (error) => {
  assert.ok(error instanceof EmailDeliveryError);
  assert.equal(error.code, "EMAIL_SEND_FAILED");
  assert.doesNotMatch(error.message, /private transport detail/);
  return true;
});

const logged = [];
const originalError = console.error;
console.error = (...args) => logged.push(args.join(" "));
try {
  await sendPasswordResetEmail({ to: "controlled@example.invalid", resetUrl: "https://example.invalid/reset?token=never-log-this" }, failingSender);
} finally {
  console.error = originalError;
}
assert.equal(logged.length, 1);
assert.equal(logged[0], "Password reset email delivery failed. EMAIL_SEND_FAILED");
assert.doesNotMatch(logged[0], /controlled|never-log-this|private transport detail/);

const saved = Object.fromEntries(["GMAIL_SMTP_USER", "GMAIL_SMTP_APP_PASSWORD", "GMAIL_SMTP_FROM"].map((key) => [key, process.env[key]]));
for (const key of Object.keys(saved)) delete process.env[key];
try {
  await assert.rejects(sendEmail(reset), (error) => error instanceof EmailDeliveryError && error.code === "EMAIL_NOT_CONFIGURED");
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const inviteUrl = new URL(buildInvitationUrl("ONE-TIME-CODE"));
assert.equal(inviteUrl.pathname, "/signup/join");
assert.equal(inviteUrl.searchParams.get("code"), "ONE-TIME-CODE");
assert.equal(inviteUrl.origin, new URL(process.env.INVITATION_PUBLIC_URL || "https://nexdrive-three.vercel.app").origin);
const savedPublicUrl = process.env.INVITATION_PUBLIC_URL;
const savedAuthUrl = process.env.BETTER_AUTH_URL;
try {
  delete process.env.INVITATION_PUBLIC_URL;
  process.env.BETTER_AUTH_URL = "http://localhost:3001";
  assert.equal(new URL(buildInvitationUrl("local-test")).origin, "https://nexdrive-three.vercel.app");
  process.env.INVITATION_PUBLIC_URL = "https://fleet.example";
  assert.equal(new URL(buildInvitationUrl("custom-test")).origin, "https://fleet.example");
  for (const invalid of ["http://localhost:3001", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://user:password@fleet.example", "invalid"]) {
    process.env.INVITATION_PUBLIC_URL = invalid;
    assert.throws(() => buildInvitationUrl("test"), EmailDeliveryError);
  }
} finally {
  if (savedPublicUrl === undefined) delete process.env.INVITATION_PUBLIC_URL; else process.env.INVITATION_PUBLIC_URL = savedPublicUrl;
  if (savedAuthUrl === undefined) delete process.env.BETTER_AUTH_URL; else process.env.BETTER_AUTH_URL = savedAuthUrl;
}
process.stdout.write("Email verification passed: French reset/invitation templates, safe HTML, fake delivery success/failure, missing Gmail configuration, and configured-origin invitation links.\n");
