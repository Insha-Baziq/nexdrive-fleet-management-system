"use client";

import { useState, type FormEvent } from "react";
import { KeyRound, Mail } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { postOnboarding } from "@/lib/onboarding-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type InvitationState = {
  id: string;
  email: string;
  status: "not_sent" | "sent" | "failed";
  lastAttemptAt: string | null;
  lastSentAt: string | null;
} | null;
type ResetState = { status: "sent" | "failed"; attemptedAt: string } | null;

function timestamp(value: string | null, locale: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "medium", timeStyle: "short",
  }).format(new Date(value));
}

export function DriverAccountControls({
  driverId, driverName, linkedEmail, initialInvitation, initialReset,
}: {
  driverId: string;
  driverName: string;
  linkedEmail: string | null;
  initialInvitation: InvitationState;
  initialReset: ResetState;
}) {
  const { locale } = useLocale();
  const french = locale === "fr";
  const [invitation, setInvitation] = useState(initialInvitation);
  const [reset, setReset] = useState(initialReset);
  const [email, setEmail] = useState(initialInvitation?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sendInvite(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      let invitationId = invitation?.id;
      if (!invitationId) {
        const created = await postOnboarding<{ id: string }>("/api/invitations", {
          role: "driver", email: email.trim(), targetDriverId: driverId,
        });
        invitationId = created.id;
      }
      const response = await fetch(`/api/invitations/${encodeURIComponent(invitationId)}/send`, { method: "POST" });
      const result = await response.json() as {
        emailDeliveryStatus?: "sent" | "failed";
        email?: string;
        errorCode?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? (french ? "Impossible d’envoyer l’invitation." : "Could not send the invitation."));
      setInvitation((current) => ({
        id: invitationId!, email: current?.email ?? email.trim(),
        status: result.emailDeliveryStatus ?? "failed",
        lastAttemptAt: new Date().toISOString(),
        lastSentAt: result.emailDeliveryStatus === "sent" ? new Date().toISOString() : current?.lastSentAt ?? null,
      }));
      if (result.emailDeliveryStatus !== "sent") {
        setError(result.errorCode === "EMAIL_NOT_CONFIGURED"
          ? (french ? "L’envoi des e-mails n’est pas configuré sur le serveur." : "Email delivery is not configured on the server.")
          : (french ? "L’envoi a échoué. Vous pouvez réessayer." : "Delivery failed. You can retry."));
      }
    } catch (cause) {
      setError(french ? "Impossible d’envoyer l’invitation. Vérifiez l’adresse e-mail et réessayez." : cause instanceof Error ? cause.message : "Please try again.");
    } finally { setBusy(false); }
  }

  async function sendReset() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/drivers/${encodeURIComponent(driverId)}/password-reset`, { method: "POST" });
      const result = await response.json() as { deliveryStatus?: "sent" | "failed"; attemptedAt?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? (french ? "Impossible d’envoyer le lien." : "Could not send the reset link."));
      setReset({ status: result.deliveryStatus ?? "failed", attemptedAt: result.attemptedAt ?? new Date().toISOString() });
      if (result.deliveryStatus !== "sent") setError(french ? "L’envoi a échoué. Vérifiez la configuration e-mail puis réessayez." : "Delivery failed. Check email configuration and retry.");
    } catch (cause) {
      setError(french ? "Impossible d’envoyer le lien de réinitialisation. Réessayez." : cause instanceof Error ? cause.message : "Please try again.");
    } finally { setBusy(false); }
  }

  return <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="driver-account-controls-title">
    <div className="flex items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><KeyRound className="size-4" /></div>
      <div className="min-w-0 flex-1">
        <h2 id="driver-account-controls-title" className="text-sm font-semibold text-foreground">{french ? "Compte conducteur" : "Driver account"}</h2>
        {linkedEmail ? <>
          <p className="mt-1 text-sm text-muted-foreground">{french ? "Compte lié à" : "Linked account"}: <span data-no-translate>{linkedEmail}</span></p>
          <Button type="button" variant="outline" className="mt-4" disabled={busy} onClick={() => { void sendReset(); }}>
            <Mail data-icon="inline-start" />{busy ? (french ? "Envoi…" : "Sending…") : (french ? "Envoyer un lien de réinitialisation" : "Email password reset link")}
          </Button>
          {reset ? <p role="status" className="mt-3 text-xs text-muted-foreground">
            {reset.status === "sent" ? (french ? "Dernier lien envoyé" : "Last reset link sent") : (french ? "Dernier envoi échoué" : "Last delivery failed")}
            {timestamp(reset.attemptedAt, locale) ? ` · ${timestamp(reset.attemptedAt, locale)}` : ""}
          </p> : null}
        </> : <>
          {invitation ? <>
            <p className="mt-1 text-sm text-muted-foreground">{french ? "Invitation envoyée à" : "Invitation for"} <span data-no-translate>{invitation.email}</span></p>
            <Button type="button" variant={invitation.status === "failed" ? "default" : "outline"} className="mt-4" disabled={busy} onClick={() => { void sendInvite(); }}>
              <Mail data-icon="inline-start" />{busy ? (french ? "Envoi…" : "Sending…") : invitation.status === "sent" ? (french ? "Renvoyer l’invitation" : "Resend invitation") : (french ? "Envoyer l’invitation" : "Send invitation")}
            </Button>
            <p role="status" className="mt-3 text-xs text-muted-foreground">
              {invitation.status === "sent" ? (french ? "E-mail envoyé" : "Email sent") : invitation.status === "failed" ? (french ? "Dernier envoi échoué" : "Last send failed") : (french ? "E-mail non envoyé" : "Email not sent")}
              {timestamp(invitation.lastAttemptAt, locale) ? ` · ${timestamp(invitation.lastAttemptAt, locale)}` : ""}
            </p>
          </> : <form className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { void sendInvite(event); }}>
            <div className="grid min-w-0 flex-1 gap-2">
              <Label htmlFor="driver-invitation-email">{french ? `E-mail du compte de ${driverName}` : `${driverName}’s account email`}</Label>
              <Input id="driver-invitation-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} placeholder={french ? "nom@exemple.fr" : "name@example.com"} />
            </div>
            <Button type="submit" disabled={busy || !email.trim()}><Mail data-icon="inline-start" />{busy ? (french ? "Envoi…" : "Sending…") : (french ? "Inviter ce conducteur" : "Invite this driver")}</Button>
          </form>}
          <p className="mt-2 text-xs text-muted-foreground">{french ? "L’invitation lie le compte à cette fiche lorsque le conducteur l’accepte." : "The account links to this driver record when the invitation is accepted."}</p>
        </>}
      </div>
    </div>
    {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}
  </section>;
}
