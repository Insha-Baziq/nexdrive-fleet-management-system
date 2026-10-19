"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const field = "mt-2 h-12 w-full rounded-md border-input bg-background px-4 text-base text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/20";

export function ForgotPasswordForm() {
  const { locale } = useLocale();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const french = locale === "fr";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
      if (result.error) {
        setError(result.error.status === 429
          ? (french ? "Trop de demandes. Réessayez dans une minute." : "Too many requests. Try again in a minute.")
          : (french ? "La demande n’a pas pu être envoyée. Réessayez." : "The request could not be sent. Please try again."));
        return;
      }
      setSubmitted(true);
    } catch {
      setError(french ? "La demande n’a pas pu être envoyée. Réessayez." : "The request could not be sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <Link href="/login" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
      {french ? "Retour à la connexion" : "Back to sign in"}
    </Link>
    <h1 className="mt-10 text-3xl font-semibold tracking-[-0.05em] text-foreground">
      {french ? "Mot de passe oublié" : "Forgot your password?"}
    </h1>
    <p className="mt-3 text-muted-foreground">
      {french ? "Saisissez l’adresse e-mail de votre compte NexDrive." : "Enter the email address for your NexDrive account."}
    </p>
    {submitted ? <p className="mt-8 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-relaxed text-foreground" role="status">
      {french
        ? "Si cette adresse est associée à un compte, vous recevrez un lien de réinitialisation. Vérifiez votre boîte de réception."
        : "If this address belongs to an account, you’ll receive a password reset link. Check your inbox."}
    </p> : <form onSubmit={submit} className="mt-8 space-y-6">
      <div>
        <Label htmlFor="recoveryEmail">{french ? "Adresse e-mail" : "Email address"}</Label>
        <Input id="recoveryEmail" type="email" required maxLength={254} autoComplete="email" autoFocus disabled={busy} className={field} value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={busy} className="h-12 w-full px-6">
        {busy ? (french ? "Envoi…" : "Sending…") : (french ? "Envoyer le lien" : "Send reset link")}
      </Button>
    </form>}
  </div>;
}

export function ResetPasswordForm({ token, invalid }: { token: string; invalid: boolean }) {
  const router = useRouter();
  const { locale } = useLocale();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const french = locale === "fr";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError(french ? "Les mots de passe ne correspondent pas." : "Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await authClient.resetPassword({ token, newPassword: password });
      if (result.error) {
        setError(french ? "Ce lien est invalide ou a expiré. Demandez un nouveau lien." : "This link is invalid or expired. Request a new one.");
        return;
      }
      setComplete(true);
    } catch {
      setError(french ? "Ce lien est invalide ou a expiré. Demandez un nouveau lien." : "This link is invalid or expired. Request a new one.");
    } finally {
      setBusy(false);
    }
  }

  if (complete) return <div>
    <h1 className="text-3xl font-semibold tracking-[-0.05em] text-foreground">{french ? "Mot de passe modifié" : "Password updated"}</h1>
    <p className="mt-3 text-muted-foreground">{french ? "Vous pouvez maintenant vous connecter avec votre nouveau mot de passe." : "You can now sign in with your new password."}</p>
    <Button className="mt-8 h-12 w-full" onClick={() => router.replace("/login")}>
      {french ? "Retour à la connexion" : "Back to sign in"}
    </Button>
  </div>;

  if (!token || invalid) return <div>
    <h1 className="text-3xl font-semibold tracking-[-0.05em] text-foreground">{french ? "Lien de réinitialisation invalide" : "Invalid reset link"}</h1>
    <p className="mt-3 text-muted-foreground">{french ? "Ce lien est invalide ou a expiré. Demandez un nouveau lien." : "This link is invalid or expired. Request a new one."}</p>
    <Button className="mt-8 h-12 w-full" render={<Link href="/forgot-password" />}>
      {french ? "Demander un nouveau lien" : "Request a new link"}
    </Button>
  </div>;

  return <div>
    <h1 className="text-3xl font-semibold tracking-[-0.05em] text-foreground">{french ? "Choisir un nouveau mot de passe" : "Choose a new password"}</h1>
    <p className="mt-3 text-muted-foreground">{french ? "Le nouveau mot de passe doit contenir entre 8 et 128 caractères." : "Your new password must contain between 8 and 128 characters."}</p>
    <form onSubmit={submit} className="mt-8 space-y-5">
      <div>
        <Label htmlFor="newPassword">{french ? "Nouveau mot de passe" : "New password"}</Label>
        <Input id="newPassword" type="password" required minLength={8} maxLength={128} autoComplete="new-password" autoFocus disabled={busy} className={field} value={password} onChange={(event) => setPassword(event.target.value)} />
      </div>
      <div>
        <Label htmlFor="confirmPassword">{french ? "Confirmer le mot de passe" : "Confirm password"}</Label>
        <Input id="confirmPassword" type="password" required minLength={8} maxLength={128} autoComplete="new-password" disabled={busy} className={field} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={busy} className="h-12 w-full px-6">
        {busy ? (french ? "Enregistrement…" : "Saving…") : (french ? "Modifier le mot de passe" : "Update password")}
      </Button>
    </form>
  </div>;
}
