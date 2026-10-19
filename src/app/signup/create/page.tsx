import type { Metadata } from "next";
import { CreateOrganizationForm } from "@/components/create-organization-form";
import { OnboardingShell } from "@/components/onboarding-shell";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export const metadata: Metadata = { title: "Create organization | NexDrive" };

export default async function CreateOrganizationPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  return <OnboardingShell steps={session ? ["Organization", "Confirmation"] : ["Organization", "Administrator", "Confirmation"]}><CreateOrganizationForm account={session ? { name: session.user.name, email: session.user.email } : undefined} /></OnboardingShell>;
}
