import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/password-recovery";
import { OnboardingShell } from "@/components/onboarding-shell";

export const metadata: Metadata = { title: "Reset password | NexDrive" };

type SearchParams = Promise<{ token?: string | string[]; error?: string | string[] }>;

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const token = Array.isArray(query.token) ? query.token[0] ?? "" : query.token ?? "";
  const error = Array.isArray(query.error) ? query.error[0] : query.error;
  return <OnboardingShell><ResetPasswordForm token={token} invalid={error === "INVALID_TOKEN"} /></OnboardingShell>;
}
