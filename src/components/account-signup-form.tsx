"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { rememberInvitation } from "@/lib/invitation-navigation";
import { authClient } from "@/lib/auth-client";
import { postOnboarding } from "@/lib/onboarding-client";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmailVerificationDialog } from "@/components/email-verification-dialog";

export function AccountSignupForm({ invitationCode }: { invitationCode?: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  const fr = locale === "fr";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [verificationWatchToken, setVerificationWatchToken] = useState<string>();
  const [verificationState, setVerificationState] = useState<"sending" | "waiting" | "verified" | "error">("sending");
  const [verificationDialogOpen, setVerificationDialogOpen] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [resendError, setResendError] = useState("");
  useEffect(() => { rememberInvitation(invitationCode); }, [invitationCode]);
  const loginHref = invitationCode ? `/login?invitation=${encodeURIComponent(invitationCode)}` : "/login";

  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (password !== confirmation) { setError(fr ? "Les mots de passe ne correspondent pas." : "Passwords do not match."); return; }
    setBusy(true);
    setPendingVerification(true);
    setVerificationDialogOpen(true);
    setVerificationState("sending");
    let accountCreated = false;
    try {
      await postOnboarding("/api/onboarding/account", { name, email, password, ...(invitationCode ? { invitationCode } : {}) });
      accountCreated = true;
      await startVerificationWatch(password);
    } catch (cause) {
      if (accountCreated) {
        setVerificationState("error");
      } else {
        setPendingVerification(false);
        setVerificationDialogOpen(false);
        setError(fr ? "Impossible de créer le compte. Vérifiez vos informations. Si ce compte existe, connectez-vous." : cause instanceof Error ? cause.message : "Please try again.");
      }
    } finally { setBusy(false); }
  }

  async function startVerificationWatch(passwordValue: string) {
    const response = await fetch("/api/auth/verification-watch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password: passwordValue }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Could not start verification status check.");
    const watch = await response.json() as { token?: string; verified?: boolean };
    if (watch.token) setVerificationWatchToken(watch.token);
    setPassword("");
    setVerificationState(watch.verified ? "verified" : "waiting");
  }

  useEffect(() => {
    if (!verificationDialogOpen || verificationState !== "waiting" || !verificationWatchToken) return;
    let stopped = false;
    let timer: number | undefined;
    const check = async () => {
      try {
        const response = await fetch("/api/auth/verification-watch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: verificationWatchToken }),
          cache: "no-store",
        });
        if (response.ok) {
          const status = await response.json() as { verified?: boolean };
          if (!stopped && status.verified) {
            setVerificationState("verified");
            return;
          }
        }
      } catch { /* Retry while the short-lived status token remains valid. */ }
      if (!stopped) timer = window.setTimeout(() => { void check(); }, 2500);
    };
    timer = window.setTimeout(() => { void check(); }, 2000);
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [verificationDialogOpen, verificationState, verificationWatchToken]);

  useEffect(() => {
    if (!verificationDialogOpen || verificationState !== "verified") return;
    const timer = window.setTimeout(() => router.replace(`${loginHref}${loginHref.includes("?") ? "&" : "?"}verified=1`), 1400);
    return () => window.clearTimeout(timer);
  }, [loginHref, router, verificationDialogOpen, verificationState]);

  async function resendVerification() {
    setResendBusy(true); setVerificationSent(false); setResendError("");
    try {
      const callbackURL = `/login?verified=1${invitationCode ? `&invitation=${encodeURIComponent(invitationCode)}` : ""}`;
      const result = await authClient.sendVerificationEmail({ email: email.trim(), callbackURL });
      if (result.error) throw new Error(result.error.message || "Could not send the verification email.");
      setVerificationSent(true);
    } catch {
      setResendError(fr ? "Impossible d’envoyer l’e-mail. Réessayez dans une minute." : "Could not send the email. Please try again in a minute.");
    } finally { setResendBusy(false); }
  }

  if (pendingVerification) return <>
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">{fr ? "Vérifiez votre adresse e-mail" : "Verify your email address"}</h1>
      <p className="mt-3 text-muted-foreground">{fr ? "Un lien de vérification a été envoyé à " : "A verification link was sent to "}<span className="font-medium text-foreground" data-no-translate>{email}</span>.</p>
    </div>
    <EmailVerificationDialog
      open={verificationDialogOpen}
      onOpenChange={(open) => { if (verificationState === "verified") setVerificationDialogOpen(open); }}
      state={verificationState}
      email={email}
      french={fr}
      busy={resendBusy}
      sent={verificationSent}
      error={resendError || (fr ? "Nous n’avons pas pu démarrer le suivi. Réessayez." : "We couldn’t start verification tracking. Please try again.")}
      onResend={() => { void resendVerification(); }}
      onRetry={() => { void startVerificationWatch(password).catch(() => setVerificationState("error")); }}
      onContinue={() => router.replace(`${loginHref}${loginHref.includes("?") ? "&" : "?"}verified=1`)}
      continueLabel={fr ? "Continuer vers la connexion" : "Continue to sign in"}
    />
  </>;

  return <div>
    <h1 className="text-3xl font-semibold tracking-tight">{fr ? "Créer votre compte" : "Create your account"}</h1>
    <p className="mt-3 text-muted-foreground">{fr ? "Un seul compte pour vos organisations. Vous pourrez ensuite créer ou rejoindre une organisation." : "One account for your organizations. You can create or join an organization afterward."}</p>
    <form onSubmit={submit} className="mt-8 space-y-5">
      <div><Label htmlFor="accountName">{fr ? "Nom complet" : "Full name"}</Label><Input id="accountName" autoComplete="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} className="mt-2 h-12" /></div>
      <div><Label htmlFor="accountEmail">{fr ? "Adresse e-mail" : "Email address"}</Label><Input id="accountEmail" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} className="mt-2 h-12" /></div>
      <div><Label htmlFor="accountPassword">{fr ? "Mot de passe" : "Password"}</Label><Input id="accountPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} aria-describedby="accountPasswordHelp" className="mt-2 h-12" /><p id="accountPasswordHelp" className="mt-2 text-sm text-muted-foreground">{fr ? "8 à 128 caractères" : "8 to 128 characters"}</p></div>
      <div><Label htmlFor="accountConfirmation">{fr ? "Confirmer le mot de passe" : "Confirm password"}</Label><Input id="accountConfirmation" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={busy} className="mt-2 h-12" /></div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={busy} className="h-12 w-full">{busy ? (fr ? "Création…" : "Creating…") : (fr ? "Créer mon compte" : "Create my account")}</Button>
    </form>
    <p className="mt-6 text-center text-sm text-muted-foreground">{fr ? "Vous avez déjà un compte ? " : "Already have an account? "}<Link href={loginHref} className="font-medium text-primary hover:underline">{fr ? "Se connecter" : "Sign in"}</Link></p>
  </div>;
}
