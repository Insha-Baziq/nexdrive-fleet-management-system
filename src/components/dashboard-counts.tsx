"use client";

import {
  CarFront,
  CircleCheck,
  FileText,
  ShieldAlert,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/components/locale-provider";
import type { DashboardCounts } from "@/lib/dashboard";

const metrics = [
  { key: "vehicles", label: { fr: "Véhicules", en: "Vehicles" }, description: { fr: "Véhicules enregistrés", en: "Registered vehicles" }, icon: CarFront, tone: "primary", href: "/vehicles" },
  { key: "available-vehicles", label: { fr: "Véhicules disponibles", en: "Available vehicles" }, description: { fr: "Sans affectation en cours", en: "Not currently assigned" }, icon: CircleCheck, tone: "primary", href: "/vehicles?availability=available" },
  { key: "drivers", label: { fr: "Conducteurs", en: "Drivers" }, description: { fr: "Dossiers conducteurs", en: "Driver records" }, icon: UsersRound, tone: "neutral", href: "/drivers" },
  { key: "inspection-attention", label: { fr: "Contrôles à suivre", en: "Inspection attention" }, description: { fr: "À échéance ou en retard", en: "Due soon or overdue" }, icon: TriangleAlert, tone: "attention", href: "/vehicles?attention=inspection" },
  { key: "insurance-attention", label: { fr: "Assurances à suivre", en: "Insurance attention" }, description: { fr: "À échéance ou nécessitant une action", en: "Expiring or requiring action" }, icon: ShieldAlert, tone: "attention", href: "/vehicles?attention=insurance" },
  { key: "active-fines", label: { fr: "Amendes en cours", en: "Active fines" }, description: { fr: "Dossiers non clôturés", en: "Open fine records" }, icon: FileText, tone: "attention", href: "/fines?status=open" },
  { key: "open-claims", label: { fr: "Sinistres en cours", en: "Open claims" }, description: { fr: "Dossiers en cours", en: "Claims in progress" }, icon: ShieldAlert, tone: "neutral", href: "/claims?status=open" },
] as const;

export function DashboardCounts({ counts, attentionDays }: { counts: DashboardCounts; attentionDays: number }) {
  const { locale } = useLocale();
  const values: Record<(typeof metrics)[number]["key"], number> = {
    vehicles: counts.total_vehicles,
    "available-vehicles": counts.available_vehicles,
    drivers: counts.total_drivers,
    "inspection-attention": counts.inspection_attention,
    "insurance-attention": counts.insurance_attention,
    "active-fines": counts.active_fines,
    "open-claims": counts.open_claims,
  };

  const describedMetrics = metrics.map((metric) => {
    if (metric.key === "inspection-attention") {
      return { ...metric, description: locale === "fr" ? `À échéance dans ${attentionDays} jours ou en retard` : `Due within ${attentionDays} days or overdue` };
    }
    if (metric.key === "insurance-attention") {
      return { ...metric, description: locale === "fr" ? `À échéance dans ${attentionDays} jours ou à compléter` : `Expiring within ${attentionDays} days or requiring action` };
    }
    return { ...metric, description: metric.description[locale] };
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{locale === "fr" ? "Vue d’ensemble" : "Overview"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{locale === "fr" ? "L’état de votre flotte en un coup d’œil" : "Your fleet at a glance"}</p>
      </div>

      <section aria-label={locale === "fr" ? "Indicateurs opérationnels" : "Operational counts"} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {describedMetrics.map(({ key, label, description, icon: Icon, tone, href }) => (
          <Link key={key} href={href} aria-labelledby={`dashboard-stat-${key}`} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          <Card data-dashboard-stat={key} className="h-full transition-colors hover:border-primary/50 hover:bg-primary/[0.02]">
            <CardHeader className="grid grid-cols-[1fr_auto] items-start gap-4">
              <div className="min-w-0">
                <CardTitle id={`dashboard-stat-${key}`} className="text-sm font-medium text-muted-foreground">
                  {label[locale]}
                </CardTitle>
                <p data-dashboard-value={key} className="mt-3 text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                  {values[key].toLocaleString(locale === "fr" ? "fr-FR" : "en-GB")}
                </p>
              </div>
              <span
                aria-hidden="true"
                className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${
                  tone === "attention"
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : tone === "primary"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                <Icon className="size-5" />
              </span>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground">{description}</CardContent>
          </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
