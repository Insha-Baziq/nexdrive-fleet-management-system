"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accountDestination, rememberInvitation } from "@/lib/invitation-navigation";
import { completedVerificationAttemptKey, pendingVerificationAttemptKey } from "@/lib/verification-status";
import { EmailVerificationDialog } from "@/components/email-verification-dialog";

export function LoginForm({ invitationCode, verificationAttempt: initialVerificationAttempt }: { invitationCode?: string; verificationAttempt?: string } = {}) {
  const router = useRouter();
  const { locale } = useLocale();
  const french = locale === "fr";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verificationAttempt, setVerificationAttempt] = useState<string | undefined>(initialVerificationAttempt);
  const [verificationDialogOpen, setVerificationDialogOpen] = useState(false);
  const [verificationState, setVerificationState] = useState<"sending" | "waiting" | "verified" | "error">("waiting");
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const [verificationWatchToken, setVerificationWatchToken] = useState<string | undefined>();
  useEffect(() => { rememberInvitation(invitationCode); }, [invitationCode]);

  useEffect(() => {
    if (!verificationDialogOpen || verificationState !== "waiting" || !verificationAttempt) return;
    let stopped = false;
    let timer: number | undefined;
    const checkVerification = async () => {
      if (localStorage.getItem(completedVerificationAttemptKey(verificationAttempt)) === verificationAttempt) {
        localStorage.removeItem(completedVerificationAttemptKey(verificationAttempt));
        localStorage.removeItem(pendingVerificationAttemptKey);
        setPassword("");
        setVerificationState("verified");
        return;
      }
      if (!verificationWatchToken) return;
      try {
        const response = await fetch("/api/auth/verification-watch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: verificationWatchToken }),
          cache: "no-store",
        });
        if (!response.ok) return;
        const status = await response.json() as { verified?: boolean };
        if (!stopped && status.verified) {
          localStorage.removeItem(pendingVerificationAttemptKey);
          setPassword("");
          setVerificationState("verified");
          return;
        }
      } catch {
        // Continue checking; the signed token expires after ten minutes.
      }
      if (!stopped) timer = window.setTimeout(() => { void checkVerification(); }, 2500);
    };
    void checkVerification();
    window.addEventListener("storage", checkVerification);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("storage", checkVerification);
    };
  }, [verificationAttempt, verificationDialogOpen, verificationState, verificationWatchToken]);

  function verificationCallbackUrl(attempt: string) {
    const query = new URLSearchParams({ verified: "1", verificationAttempt: attempt });
    if (invitationCode) query.set("invitation", invitationCode);
    return `/login?${query.toString()}`;
  }

  async function sendVerification(attempt: string) {
    if (!email.trim()) {
      setVerificationError(french ? "Saisissez votre adresse e-mail." : "Enter your email address first.");
      setVerificationState("error");
      return;
    }
    setVerificationBusy(true);
    setVerificationSent(false);
    setVerificationError("");
    setVerificationState("sending");
    try {
      const callbackURL = verificationCallbackUrl(attempt);
      const result = await authClient.sendVerificationEmail({ email: email.trim(), callbackURL });
      if (result.error) throw new Error(result.error.message || "Could not send the verification email.");
      setVerificationSent(true);
      setVerificationState("waiting");
    } catch {
      setVerificationError(french ? "Impossible d’envoyer l’e-mail. Réessayez dans une minute." : "Could not send the email. Please try again in a minute.");
      setVerificationState("error");
    } finally {
      setVerificationBusy(false);
    }
  }

  async function resendVerification() {
    const attempt = verificationAttempt ?? crypto.randomUUID();
    setVerificationAttempt(attempt);
    localStorage.setItem(pendingVerificationAttemptKey, attempt);
    await sendVerification(attempt);
  }

  async function startVerificationWatch(emailAddress: string, passwordValue: string) {
    try {
      const response = await fetch("/api/auth/verification-watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: emailAddress, password: passwordValue }),
        cache: "no-store",
      });
      if (!response.ok) return;
      const result = await response.json() as { token?: string; verified?: boolean };
      if (result.token) setVerificationWatchToken(result.token);
      if (result.verified) setVerificationState("verified");
    } catch {
      // The same-browser callback signal remains available if status polling cannot start.
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      const attempt = crypto.randomUUID();
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (result.error) {
        const unverified = result.error.code === "EMAIL_NOT_VERIFIED";
        if (unverified) {
          setPassword("");
          setVerificationAttempt(attempt);
          localStorage.setItem(pendingVerificationAttemptKey, attempt);
          setVerificationState("sending");
          setVerificationSent(false);
          setVerificationError("");
          setVerificationDialogOpen(true);
          void startVerificationWatch(email.trim(), password);
          void sendVerification(attempt);
        } else {
          setError(result.error.code === "ACCOUNT_SUSPENDED"
            ? (french ? "Ce compte est suspendu. Contactez votre administrateur." : "This account is suspended. Contact your administrator.")
            : (french ? "Connexion impossible. Vérifiez votre adresse e-mail et votre mot de passe." : "We couldn’t sign you in. Check your email and password."));
        }
        return;
      }
      router.replace(accountDestination(invitationCode));
      router.refresh();
    } catch {
      setError(french ? "La connexion est temporairement indisponible. Réessayez." : "Sign-in is temporarily unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function closeVerificationDialog(open: boolean) {
    setVerificationDialogOpen(open);
    if (!open && verificationState === "verified") setVerificationState("waiting");
  }

  return (
    <form method="post" className="login-form mt-14 flex flex-col gap-7" onSubmit={onSubmit}>
      <div className="space-y-2.5">
        <Label htmlFor="email" className="text-[15px] font-semibold text-foreground">
          {french ? "Adresse e-mail" : "Email address"}
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={french ? "nom@entreprise.fr" : "name@company.com"}
          disabled={busy}
          className="h-14 rounded-md border-input bg-background px-5 text-base text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/20"
        />
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {locale === "fr" ? "Mot de passe oublié ?" : "Forgot password?"}
          </Link>
        </div>
      </div>
      <div className="space-y-2.5">
        <Label htmlFor="password" className="text-[15px] font-semibold text-foreground">
          {french ? "Mot de passe" : "Password"}
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={french ? "Saisissez votre mot de passe" : "Enter your password"}
          disabled={busy}
          className="h-14 rounded-md border-input bg-background px-5 text-base text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/20"
        />
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={busy}
        className="mt-1 h-14 w-full rounded-md bg-primary text-base font-semibold text-primary-foreground shadow-none hover:bg-primary/90 focus-visible:ring-ring/30"
      >
        {busy ? (french ? "Connexion…" : "Signing in…") : (french ? "Se connecter" : "Sign in")}
      </Button>
      <EmailVerificationDialog
        open={verificationDialogOpen}
        onOpenChange={(open) => { void closeVerificationDialog(open); }}
        state={verificationState}
        email={email}
        french={french}
        busy={verificationBusy}
        sent={verificationSent}
        error={verificationError}
        onResend={() => { void resendVerification(); }}
        onContinue={() => { void closeVerificationDialog(false); }}
        continueLabel={french ? "Retour à la connexion" : "Back to sign in"}
      />
    </form>
  );
}
