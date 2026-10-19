"use client";

import Link from "next/link";
import { useLocale } from "@/components/locale-provider";

export function LoginPageIntro({ verified = false, organizationCreated = false }: { verified?: boolean; organizationCreated?: boolean } = {}) {
  const { locale } = useLocale();
  const french = locale === "fr";

  return <>
    <h1 className="text-[clamp(2rem,2.8vw,2.75rem)] leading-tight font-semibold tracking-[-0.055em] text-foreground">
      {french ? "Se connecter à NexDrive" : "Sign in to NexDrive"}
    </h1>
    <p className="mt-4 text-[clamp(1rem,1.2vw,1.15rem)] leading-relaxed text-muted-foreground">
      {french ? "Connectez-vous à votre compte pour continuer." : "Sign in to your account to continue."}
    </p>
    {verified ? <p role="status" className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-foreground">{french ? "Adresse e-mail confirmée. Vous pouvez maintenant vous connecter." : "Email address verified. You can now sign in."}</p> : null}
    {organizationCreated ? <p role="status" className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-foreground">{french ? "Organisation créée. Vérifiez votre adresse e-mail, puis connectez-vous avec votre compte administrateur." : "Organization created. Verify your email, then sign in with your administrator account."}</p> : null}
  </>;
}

export function LoginSignupPrompt({ invitationCode }: { invitationCode?: string } = {}) {
  const { locale } = useLocale();
  const french = locale === "fr";
  return <div className="login-signup-prompt mt-8 border-t border-border pt-6 text-center text-sm text-muted-foreground">
    <p>{french ? "Nouveau sur NexDrive ?" : "New to NexDrive?"}</p>
    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
      <Link href={invitationCode ? `/signup?invitation=${encodeURIComponent(invitationCode)}` : "/signup"} className="font-semibold text-primary underline-offset-4 hover:underline">{french ? "Créer un compte" : "Sign up"}</Link>
      <Link href="/signup/create" className="font-semibold text-primary underline-offset-4 hover:underline">{french ? "Créer une organisation" : "Create organization"}</Link>
    </div>
  </div>;
}
