"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/components/locale-provider";
import { postOnboarding } from "@/lib/onboarding-client";
import { PENDING_INVITATION_KEY, reloadOrganizationWorkspace } from "@/lib/invitation-navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Invitation = { organizationName: string; role: string; email: string | null };
const roles: Record<string, [string, string]> = { administrator: ["Administrateur", "Administrator"], fleet_manager: ["Responsable de flotte", "Fleet Manager"], manager: ["Gestionnaire", "Manager"], driver: ["Conducteur", "Driver"] };

export function InvitationConfirmation() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { locale } = useLocale();
  const fr = locale === "fr";
  const parameter = params.get("invitation");
  const [code, setCode] = useState("");
  const [invite, setInvite] = useState<Invitation | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const invitedEmail = invite?.email?.toLowerCase() ?? null;
  const signedInEmail = session?.user.email.toLowerCase() ?? null;
  const wrongAccount = Boolean(invitedEmail && signedInEmail && invitedEmail !== signedInEmail);
  const needsVerification = Boolean(invitedEmail && signedInEmail && invitedEmail === signedInEmail && !session?.user.emailVerified);

  useEffect(() => {
    if (pathname !== "/workspace" && pathname !== "/my-vehicle") return;
    const pending = parameter || sessionStorage.getItem(PENDING_INVITATION_KEY);
    if (!pending) return;
    let active = true;
    postOnboarding<Invitation>("/api/onboarding/invitation", { code: pending })
      .then((result) => { if (active) { setCode(pending); setInvite(result); setError(""); setOpen(true); } })
      .catch(() => { if (active) { setCode(pending); setInvite(null); setOpen(true); setError(fr ? "Cette invitation est invalide, déjà utilisée ou expirée." : "This invitation is invalid, already used, or expired."); } });
    return () => { active = false; };
  }, [pathname, parameter, fr]);

  function dismiss() {
    if (busy) return;
    sessionStorage.removeItem(PENDING_INVITATION_KEY);
    setOpen(false);
    const remaining = new URLSearchParams(params.toString()); remaining.delete("invitation");
    router.replace(`${pathname}${remaining.size ? `?${remaining}` : ""}`);
  }

  async function accept() {
    setBusy(true); setError("");
    try {
      await postOnboarding("/api/onboarding/join-existing", { code });
      sessionStorage.removeItem(PENDING_INVITATION_KEY);
      reloadOrganizationWorkspace();
    } catch (cause) { setError(fr ? "Impossible de rejoindre cette organisation. Vérifiez l’adresse e-mail de votre compte et votre invitation. Si vous êtes déjà membre, utilisez le menu du compte." : cause instanceof Error ? cause.message : "Unable to join. Please try again."); setBusy(false); }
  }

  async function sendVerification() {
    if (!session?.user.email) return;
    setVerificationBusy(true); setError(""); setVerificationSent(false);
    try {
      const result = await authClient.sendVerificationEmail({
        email: session.user.email,
        callbackURL: `/workspace?invitation=${encodeURIComponent(code)}`,
      });
      if (result.error) throw new Error(result.error.message || "Could not send the verification email.");
      setVerificationSent(true);
    } catch (cause) {
      setError(fr ? "Impossible d’envoyer l’e-mail de vérification. Réessayez dans une minute." : cause instanceof Error ? cause.message : "Could not send the verification email.");
    } finally { setVerificationBusy(false); }
  }

  async function switchAccount() {
    setBusy(true); setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message || "Could not sign out.");
      sessionStorage.removeItem(PENDING_INVITATION_KEY);
      router.replace(`/login?invitation=${encodeURIComponent(code)}`);
      router.refresh();
    } catch (cause) {
      setError(fr ? "Impossible de changer de compte. Réessayez." : cause instanceof Error ? cause.message : "Could not switch accounts.");
      setBusy(false);
    }
  }

  return <Dialog open={open} onOpenChange={(value) => { if (!value) dismiss(); }}>
    <DialogContent showCloseButton={!busy} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
      <DialogHeader><DialogTitle className="break-words pr-8">{invite ? (fr ? `Rejoindre ${invite.organizationName} ?` : `Join ${invite.organizationName}?`) : (fr ? "Votre invitation" : "Your invitation")}</DialogTitle>
        <DialogDescription>{fr ? "Vous choisissez de rejoindre cette organisation avec votre compte NexDrive." : "Choose whether to join this organization with your NexDrive account."}</DialogDescription></DialogHeader>
      {invite ? <div className="rounded-lg border bg-muted/40 p-4"><p className="font-medium" data-no-translate>{invite.organizationName}</p><p className="mt-1 text-muted-foreground">{fr ? "Votre rôle : " : "Your role: "}{roles[invite.role]?.[fr ? 0 : 1] ?? invite.role}</p>{invite.email ? <p className="mt-2 text-sm text-muted-foreground">{fr ? "Invitation réservée à " : "Invitation for "}<span data-no-translate>{invite.email}</span></p> : null}</div> : !error ? <p role="status">{fr ? "Vérification…" : "Checking…"}</p> : null}
      {wrongAccount ? <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <p>{fr ? "Cette invitation est réservée à" : "This invitation was sent to"} <span className="font-medium" data-no-translate>{invite?.email}</span>. {fr ? "Vous êtes connecté avec" : "You are signed in as"} <span className="font-medium" data-no-translate>{session?.user.email}</span>.</p>
        <Button type="button" variant="outline" onClick={() => { void switchAccount(); }} disabled={busy}>{fr ? "Changer de compte" : "Switch account"}</Button>
      </div> : null}
      {needsVerification ? <div className="space-y-3 rounded-lg border bg-muted/40 p-4 text-sm">
        <p>{fr ? "Confirmez que cette adresse e-mail vous appartient avant de rejoindre l’organisation." : "Verify that you own this email address before joining the organization."}</p>
        <Button type="button" variant="outline" onClick={() => { void sendVerification(); }} disabled={verificationBusy || verificationSent}>{verificationBusy ? (fr ? "Envoi…" : "Sending…") : verificationSent ? (fr ? "E-mail envoyé" : "Verification email sent") : (fr ? "Envoyer l’e-mail de vérification" : "Send verification email")}</Button>
        {verificationSent ? <p role="status" className="text-muted-foreground">{fr ? "Consultez votre boîte de réception, puis ouvrez le lien pour revenir à cette invitation." : "Check your inbox and open the link to return to this invitation."}</p> : null}
      </div> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter><Button variant="outline" onClick={dismiss} disabled={busy}>{fr ? "Pas maintenant" : "Not now"}</Button><Button onClick={accept} disabled={busy || verificationBusy || sessionPending || !invite || !session?.user || wrongAccount || needsVerification}>{busy ? (fr ? "Inscription…" : "Joining…") : (fr ? "Rejoindre l’organisation" : "Join organization")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
