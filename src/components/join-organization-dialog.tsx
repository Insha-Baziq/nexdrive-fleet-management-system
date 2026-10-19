"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/components/locale-provider";
import { postOnboarding } from "@/lib/onboarding-client";
import { reloadOrganizationWorkspace } from "@/lib/invitation-navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function getJoinError(message: string, french: boolean) {
  const normalized = message.toLowerCase();
  if (normalized.includes("verify your email")) return {
    message: french ? "Vérifiez votre adresse e-mail avant de rejoindre cette organisation." : "Verify your email address before joining this organization.",
    verificationRequired: true,
  };
  if (normalized.includes("use the account named") || normalized.includes("invitation was sent to")) return {
    message: french ? "Cette invitation est réservée à une autre adresse e-mail. Connectez-vous avec l’adresse invitée." : "This invitation is reserved for another email address. Sign in with the invited address.",
    verificationRequired: false,
  };
  if (normalized.includes("already belong to this organization")) return {
    message: french ? "Vous êtes déjà membre de cette organisation." : "You already belong to this organization.",
    verificationRequired: false,
  };
  if (normalized.includes("invitation not found") || normalized.includes("invitation code is invalid")) return {
    message: french ? "Ce code est invalide ou expiré." : "This code is invalid or expired.",
    verificationRequired: false,
  };
  return {
    message: french ? "Impossible de rejoindre cette organisation. Réessayez." : "Unable to join this organization. Please try again.",
    verificationRequired: false,
  };
}

export function JoinOrganizationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { locale } = useLocale();
  const french = locale === "fr";
  const { data: session } = authClient.useSession();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  function changeOpen(next: boolean) {
    if (busy && !next) return;
    onOpenChange(next);
    if (!next) {
      setCode("");
      setError("");
      setVerificationRequired(false);
      setVerificationSent(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setVerificationRequired(false);
    setVerificationSent(false);
    try {
      await postOnboarding("/api/onboarding/join-existing", { code: code.trim() });
      changeOpen(false);
      reloadOrganizationWorkspace();
    } catch (cause) {
      const result = getJoinError(cause instanceof Error ? cause.message : "", french);
      setError(result.message);
      setVerificationRequired(result.verificationRequired);
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    const email = session?.user.email;
    if (!email) return;
    setVerificationBusy(true);
    setError("");
    setVerificationSent(false);
    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: `/workspace?invitation=${encodeURIComponent(code.trim())}`,
      });
      if (result.error) throw new Error(result.error.message || "Could not send the verification email.");
      setVerificationSent(true);
    } catch {
      setError(french ? "Impossible d’envoyer l’e-mail de vérification. Réessayez." : "Could not send the verification email. Please try again.");
    } finally {
      setVerificationBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{french ? "Rejoindre une organisation" : "Join an organization"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="joinOrganizationCode">{french ? "Code d’invitation" : "Invitation code"}</Label>
            <Input
              id="joinOrganizationCode"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
              minLength={20}
              maxLength={80}
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setError("");
                setVerificationRequired(false);
                setVerificationSent(false);
              }}
              disabled={busy}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "joinOrganizationError" : undefined}
            />
            {error ? <p id="joinOrganizationError" role="alert" className="text-sm text-destructive">{error}</p> : null}
            {verificationRequired ? <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={() => { void resendVerification(); }} disabled={verificationBusy || verificationSent || !session?.user.email}>
              {verificationBusy ? (french ? "Envoi…" : "Sending…") : verificationSent ? (french ? "E-mail envoyé" : "Verification email sent") : (french ? "Renvoyer l’e-mail de vérification" : "Resend verification email")}
            </Button> : null}
            {verificationSent ? <p role="status" className="text-xs text-muted-foreground">{french ? "Vérifiez votre boîte de réception, puis réessayez avec ce code." : "Check your inbox, then try again with this code."}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={busy}>{french ? "Annuler" : "Cancel"}</Button>
            <Button type="submit" disabled={busy || verificationBusy}>{busy ? (french ? "Rejoindre…" : "Joining…") : (french ? "Rejoindre" : "Join")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
