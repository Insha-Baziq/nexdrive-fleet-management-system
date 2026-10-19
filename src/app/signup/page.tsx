import type { Metadata } from "next";
import { OnboardingShell } from "@/components/onboarding-shell";
import { AccountSignupForm } from "@/components/account-signup-form";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Sign up | NexDrive" };

export default async function SignupPage({ searchParams }: { searchParams?: Promise<{ invitation?: string | string[] }> }) {
  const value = (await searchParams)?.invitation;
  const invitationCode = typeof value === "string" && value.length >= 20 && value.length <= 80 ? value : undefined;
  if (await auth.api.getSession({ headers: await headers() })) redirect(invitationCode ? `/workspace?invitation=${encodeURIComponent(invitationCode)}` : "/workspace");
  return <OnboardingShell><AccountSignupForm invitationCode={invitationCode} /></OnboardingShell>;
}
