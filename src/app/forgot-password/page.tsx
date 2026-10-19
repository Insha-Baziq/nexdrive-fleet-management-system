import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/password-recovery";
import { OnboardingShell } from "@/components/onboarding-shell";

export const metadata: Metadata = { title: "Forgot password | NexDrive" };

export default function ForgotPasswordPage() {
  return <OnboardingShell><ForgotPasswordForm /></OnboardingShell>;
}
