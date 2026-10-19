import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { LoginHero } from "@/components/login-hero";
import { LoginPageIntro, LoginSignupPrompt } from "@/components/login-page-copy";
import { LanguageToggle } from "@/components/language-toggle";
import { NexDriveMark } from "@/components/nexdrive-mark";
import { VerificationCallbackSignal } from "@/components/verification-callback-signal";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in | NexDrive",
  description: "Sign in to your organization's NexDrive workspace.",
};

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ invitation?: string | string[]; verified?: string | string[]; verificationAttempt?: string | string[]; organizationCreated?: string | string[] }> }) {
  const parameters = await searchParams;
  const parameter = parameters?.invitation;
  const invitationCode = typeof parameter === "string" && parameter.length >= 20 && parameter.length <= 80 ? parameter : undefined;
  const attempt = typeof parameters?.verificationAttempt === "string" ? parameters.verificationAttempt : undefined;
  const rawSession = await auth.api.getSession({ headers: await headers() });
  if (rawSession && invitationCode) redirect(`/workspace?invitation=${encodeURIComponent(invitationCode)}`);
  if (rawSession) redirect("/workspace");

  return (
    <main className="grid h-dvh overflow-hidden bg-background text-foreground lg:grid-cols-[42.5%_57.5%]">
      <VerificationCallbackSignal attempt={attempt} />
      <LoginHero />

      <section className="login-content relative flex h-full min-h-0 items-start justify-center overflow-y-auto px-6 py-8 sm:px-10 lg:px-16">
        <LanguageToggle className="absolute right-6 top-6 sm:right-10 lg:right-16" />
        <div className="login-card my-auto w-full max-w-[640px]">
          <NexDriveMark className="login-mark mb-12" />
          <LoginPageIntro verified={parameters?.verified === "1"} organizationCreated={parameters?.organizationCreated === "1"} />
          <LoginForm invitationCode={invitationCode} verificationAttempt={attempt} />
          <LoginSignupPrompt invitationCode={invitationCode} />
        </div>
      </section>
    </main>
  );
}
