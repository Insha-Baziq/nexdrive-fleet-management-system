"use client";

import Link from "next/link";
import {
  AlertTriangle,
  FileText,
  ShieldAlert,
  UsersRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/components/locale-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AppRole } from "@/lib/organization-session";
import type { DashboardAlert, DashboardAlertType } from "@/lib/dashboard-alerts";
import { translateText } from "@/lib/locale";

const alertIcons: Record<DashboardAlertType, LucideIcon> = {
  technical_inspection: Wrench,
  vehicle_insurance: ShieldAlert,
  vehicle_document: FileText,
  driver_licence: UsersRound,
  driver_document: FileText,
  vehicle_anomaly: AlertTriangle,
  fine_deadline: FileText,
};

function targetHref(alert: DashboardAlert, role: AppRole): string | null {
  if (alert.targetType === "driver") {
    return role === "administrator" || role === "fleet_manager"
      ? `/drivers/${alert.targetId}`
      : null;
  }
  if (alert.targetType === "vehicle") return `/vehicles/${alert.targetId}`;
  if (alert.targetType === "anomaly") return `/anomalies/${alert.targetId}`;
  return `/fines/${alert.targetId}`;
}

function dateLabel(value: string, locale: "fr" | "en") {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function statusClass(status: string) {
  if (status === "Overdue") return "border-destructive/25 bg-destructive/10 text-destructive";
  if (status === "Open") return "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300";
  return "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300";
}

export function DashboardAttention({
  alerts,
  count,
  role,
}: {
  alerts: DashboardAlert[];
  count: number;
  role: AppRole;
}) {
  const { locale } = useLocale();
  return (
    <Card className="mt-6 overflow-hidden rounded-xl shadow-sm" aria-labelledby="dashboard-attention-title">
      <CardHeader className="flex flex-row items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
        <div>
          <CardTitle id="dashboard-attention-title" className="text-base">Attention</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Deadlines and open items that need follow-up.</p>
        </div>
        <Badge variant="outline" aria-label={`${count} attention items`} data-attention-count={count}>
          {count} {count === 1 ? "item" : "items"}
        </Badge>
      </CardHeader>
      <CardContent className="p-0">
        {alerts.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground sm:px-6">
            No approaching deadlines or open attention items.
          </p>
        ) : (
          <ul aria-label="Attention items" className="divide-y">
            {alerts.map((alert) => {
              const Icon = alertIcons[alert.type];
              const href = targetHref(alert, role);
              const title = translateText(alert.title, locale);
              const details = translateText(alert.details, locale);
              const status = translateText(alert.status, locale);
              const content = (
                <>
                  <span aria-hidden="true" className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${alert.status === "Overdue" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block line-clamp-2 text-sm font-medium text-foreground sm:truncate">{title}</span>
                    <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground sm:truncate">{details}</span>
                  </span>
                  <span className="hidden shrink-0 text-right text-sm tabular-nums text-muted-foreground sm:block">{alert.isOpenItem ? (locale === "fr" ? "Signalé" : "Reported") : dateLabel(alert.date, locale)}</span>
                  <Badge variant="outline" className={`shrink-0 ${statusClass(alert.status)}`} data-alert-status={alert.status}>
                    {status}
                  </Badge>
                  <span className="hidden min-w-4 text-right text-muted-foreground sm:block" aria-hidden="true">{href ? "›" : ""}</span>
                </>
              );

              return (
                <li key={alert.id} data-alert-type={alert.type}>
                  {href ? (
                    <Link href={href} aria-label={`${title}: ${details}; ${status}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[auto_minmax(0,1fr)_minmax(110px,auto)_auto_1rem] sm:px-5">
                      {content}
                    </Link>
                  ) : (
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)_minmax(110px,auto)_auto_1rem] sm:px-5">
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
