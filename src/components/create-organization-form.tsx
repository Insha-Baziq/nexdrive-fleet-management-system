"use client";

import { reloadOrganizationWorkspace } from "@/lib/invitation-navigation";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Circle } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { postOnboarding } from "@/lib/onboarding-client";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const field = "mt-2 h-12 w-full rounded-md border-input bg-background px-4 text-base text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/20";

export function CreateOrganizationForm({ account }: { account?: { name: string; email: string } } = {}) {
  const router = useRouter();
  const { locale } = useLocale();
  const french = locale === "fr";
  const [step, setStep] = useState(1);
  const [organizationName, setOrganizationName] = useState("");
  const [name, setName] = useState(account?.name ?? "");
  const [email, setEmail] = useState(account?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState("");
  const validPasswordLength = password.length >= 8 && password.length <= 128;
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

  function next(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (step === 2 && password !== confirmPassword) {
      setError(french ? "Les mots de passe ne correspondent pas." : "Passwords do not match.");
      return;
    }
    setStep(account && step === 1 ? 3 : step + 1);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await postOnboarding("/api/onboarding/create", {
        organizationName, country: "FR", timezone: "Europe/Paris", name, email, password,
      });
      if (account) { reloadOrganizationWorkspace(); return; }
      // New administrators must verify their email and explicitly sign in.
      await authClient.signOut();
      router.replace("/login?organizationCreated=1");
      router.refresh();
    } catch (cause) {
      setError(french ? "Impossible de créer l’organisation. Vérifiez les informations et réessayez." : cause instanceof Error ? cause.message : "Please try again.");
    } finally { setBusy(false); }
  }

  return <div>
    {step === 1 ? <Link href={account ? "/workspace" : "/login"} className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"><ArrowLeft className="size-4" /> {french ? "Retour" : "Back"}</Link>
      : <button type="button" onClick={() => setStep(account ? 1 : step - 1)} className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"><ArrowLeft className="size-4" /> {french ? "Retour" : "Back"}</button>}
    <p className="mt-10 text-xs font-semibold uppercase tracking-widest text-primary">{french ? `Étape ${account && step === 3 ? 2 : step} sur ${account ? 2 : 3}` : `Step ${account && step === 3 ? 2 : step} of ${account ? 2 : 3}`}</p>
    <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">
      {step === 1 ? (french ? "Créer votre organisation" : "Create your organization") : step === 2 ? (french ? "Créer votre compte administrateur" : "Create your administrator account") : (french ? "Confirmer vos informations" : "Confirm your details")}
    </h1>
    <p className="mt-3 text-muted-foreground">{step === 1 ? (french ? "Quelques informations pour configurer votre espace." : "A few details to set up your workspace.") : step === 2 ? (french ? "Vous gérerez les invitations et les accès de votre organisation." : "You will manage invitations and access for your organization.") : (french ? "Vérifiez les informations avant de créer votre espace." : "Review the details before creating your workspace.")}</p>
    {step === 1 ? <form onSubmit={next} className="mt-10 space-y-6">
      <div><Label htmlFor="organizationName">{french ? "Nom de l’organisation" : "Organization name"}</Label><Input id="organizationName" required maxLength={120} autoFocus className={field} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder={french ? "Nom de votre entreprise" : "Your company name"} /></div>
      <div><Label htmlFor="country">{french ? "Pays" : "Country"}</Label><Input id="country" value="France" readOnly className={field} /></div>
      <div><Label htmlFor="timezone">{french ? "Fuseau horaire" : "Time zone"}</Label><Input id="timezone" value="Europe/Paris" readOnly className={field} /></div>
      <p className="text-sm text-muted-foreground">{account ? (french ? "Vous serez l’administrateur de cette organisation avec votre compte actuel." : "Your current account will be this organization’s administrator.") : (french ? "Vous créerez votre compte administrateur à l’étape suivante." : "You will create your administrator account in the next step.")}</p>
      <Button type="submit" className="h-12 px-7">{french ? "Continuer" : "Continue"}</Button>
    </form> : null}
    {step === 2 ? <form onSubmit={next} className="mt-10 space-y-5">
      <div><Label htmlFor="fullName">{french ? "Nom complet" : "Full name"}</Label><Input id="fullName" required maxLength={120} autoComplete="name" className={field} value={name} onChange={(event) => setName(event.target.value)} /></div>
      <div><Label htmlFor="adminEmail">{french ? "Adresse e-mail" : "Email address"}</Label><Input id="adminEmail" type="email" required maxLength={254} autoComplete="email" className={field} value={email} onChange={(event) => setEmail(event.target.value)} /></div>
      <div><Label htmlFor="adminPassword">{french ? "Mot de passe" : "Password"}</Label><Input id="adminPassword" type="password" required minLength={8} maxLength={128} autoComplete="new-password" aria-describedby="password-requirements" className={field} value={password} onChange={(event) => setPassword(event.target.value)} /></div>
      <div><Label htmlFor="confirmPassword">{french ? "Confirmer le mot de passe" : "Confirm password"}</Label><Input id="confirmPassword" type="password" required minLength={8} maxLength={128} autoComplete="new-password" aria-describedby="password-requirements" className={field} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
      <div id="password-requirements" className="rounded-lg border border-border bg-muted/30 px-4 py-3" aria-live="polite">
        <p className="text-sm font-medium text-foreground">{french ? "Exigences du mot de passe" : "Password requirements"}</p>
        <ul className="mt-2 space-y-1.5 text-sm">
          <li className={`flex items-center gap-2 ${validPasswordLength ? "text-primary" : "text-muted-foreground"}`}>{validPasswordLength ? <Check className="size-4 shrink-0" aria-hidden="true" /> : <Circle className="size-4 shrink-0" aria-hidden="true" />}<span>{french ? "8 à 128 caractères" : "8 to 128 characters"}</span></li>
          <li className={`flex items-center gap-2 ${passwordsMatch ? "text-primary" : "text-muted-foreground"}`}>{passwordsMatch ? <Check className="size-4 shrink-0" aria-hidden="true" /> : <Circle className="size-4 shrink-0" aria-hidden="true" />}<span>{french ? "Les mots de passe correspondent" : "Passwords match"}</span></li>
        </ul>
      </div>
      <Button type="submit" className="h-12 px-7">{french ? "Continuer" : "Continue"}</Button>
    </form> : null}
    {step === 3 ? <form onSubmit={create} className="mt-10 space-y-6">
      <div className="rounded-lg border border-border bg-muted/30 p-5 text-sm">
        <p className="font-medium text-foreground">{organizationName}</p>
        <p className="mt-1 text-muted-foreground">France · Europe/Paris · EUR</p>
        <p className="mt-5 font-medium text-foreground">{name}</p>
        <p className="mt-1 text-muted-foreground" data-no-translate>{email}</p>
        <p className="mt-1 text-muted-foreground">{french ? "Administrateur" : "Administrator"}</p>
      </div>
      <Button type="submit" disabled={busy} className="h-12 px-7">{busy ? (french ? "Création…" : "Creating…") : account ? (french ? "Créer mon organisation" : "Create my organization") : (french ? "Créer mon compte et mon organisation" : "Create my account and organization")}</Button>
    </form> : null}
    {error ? <p role="alert" className="mt-5 text-sm text-destructive">{error}</p> : null}
  </div>;
}
