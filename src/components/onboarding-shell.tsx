"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useLocale } from "@/components/locale-provider";
import { LanguageToggle } from "@/components/language-toggle";
import { NexDriveMark } from "@/components/nexdrive-mark";

export function OnboardingShell({ children, steps }: { children: ReactNode; steps?: string[] }) {
  const { locale } = useLocale();
  const french = locale === "fr";
  const localizedSteps: Record<string, string> = {
    Organization: "Organisation",
    Administrator: "Administrateur",
    Confirmation: "Confirmation",
  };
  return (
    <main className="grid min-h-dvh bg-background text-foreground lg:grid-cols-[42.5%_57.5%]">
      <aside className="hidden min-h-dvh flex-col bg-[#063f35] px-12 py-12 text-white lg:flex xl:px-16">
        <Link href="/login" aria-label="NexDrive home"><NexDriveMark light /></Link>
        <div className="my-auto py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">{french ? "Gestion de flotte" : "Fleet management"}</p>
          <h2 className="mt-7 max-w-lg text-4xl font-semibold leading-tight tracking-[-0.055em] xl:text-5xl">{french ? "Une vision claire de votre flotte" : "A clear view of your fleet"}</h2>
          <p className="mt-5 max-w-md text-base leading-relaxed text-[#d1e2df]">{french ? "Véhicules, conducteurs et affectations dans un espace sécurisé." : "Vehicles, drivers and assignments in one secure workspace."}</p>
          {steps ? <ol className="mt-14 space-y-4 border-l border-white/20 pl-5 text-sm text-[#d1e2df]">
            {steps.map((step, index) => <li key={step}><span className="mr-3 font-semibold text-emerald-200">{index + 1}</span>{french ? localizedSteps[step] ?? step : step}</li>)}
          </ol> : null}
        </div>
        <p className="text-xs text-emerald-100/70">© 2026 NexDrive</p>
      </aside>
      <section className="relative flex min-h-dvh items-center justify-center px-6 py-24 sm:px-10 lg:px-14">
        <LanguageToggle className="absolute right-6 top-6 sm:right-10" />
        <div className="w-full max-w-xl">{children}</div>
      </section>
    </main>
  );
}
