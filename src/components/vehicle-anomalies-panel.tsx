"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarDays, Image as ImageIcon, TriangleAlert } from "lucide-react";
import { AnomalyCreateDialog } from "@/components/anomaly-create-dialog";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { DataTablePagination } from "@/components/data-table-pagination";
import { useLocale } from "@/components/locale-provider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { VehicleAnomaly } from "@/lib/anomalies";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";

function dateLabel(value: string, locale: "fr" | "en") {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function Status({ value, locale }: { value: VehicleAnomaly["status"]; locale: "fr" | "en" }) {
  const tone = value === "open" ? "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300"
    : value === "resolved" ? "border-primary/20 bg-primary/10 text-primary"
      : "border-border bg-muted text-muted-foreground";
  const label = locale === "fr"
    ? value === "open" ? "Ouverte" : value === "resolved" ? "Résolue" : "Annulée"
    : value[0].toUpperCase() + value.slice(1);
  return <Badge variant="outline" className={tone}>{label}</Badge>;
}

export function VehicleAnomaliesPanel({ vehicleId, reporterName, canManage, initialAnomalies }: {
  vehicleId: string;
  reporterName: string;
  canManage: boolean;
  initialAnomalies: VehicleAnomaly[];
}) {
  const { locale } = useLocale();
  const text = locale === "fr" ? {
    title: "Anomalies du véhicule", description: "Problèmes signalés et décisions enregistrées", emptyTitle: "Aucune anomalie pour ce véhicule",
    emptyDescription: "Les problèmes signalés pour ce véhicule apparaîtront ici.", observed: "Observée le", descriptionColumn: "Description",
    reporter: "Signalée par", status: "Statut", photos: "Photos", reportedBy: "Signalée par", photo: "photo", photosPlural: "photos",
    viewAll: "Voir toutes les anomalies",
  } : {
    title: "Vehicle anomalies", description: "Reported problems and recorded outcomes", emptyTitle: "No vehicle anomalies",
    emptyDescription: "Reported problems for this vehicle will appear here.", observed: "Observed", descriptionColumn: "Description",
    reporter: "Reporter", status: "Status", photos: "Photos", reportedBy: "Reported by", photo: "photo", photosPlural: "photos",
    viewAll: "View all anomalies",
  };
  const [anomalies, setAnomalies] = useState(initialAnomalies);
  const [pageIndex, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(anomalies.length / TABLE_PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1);
  const visible = anomalies.slice(page * TABLE_PAGE_SIZE, (page + 1) * TABLE_PAGE_SIZE);
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
        <div><h2 className="text-sm font-semibold">{text.title}</h2><p className="mt-0.5 text-xs text-muted-foreground">{text.description}</p></div>
        {canManage && <AnomalyCreateDialog vehicleId={vehicleId} reporterName={reporterName} onCreated={(item) => setAnomalies((current) => [item, ...current])} />}
      </div>
      {!anomalies.length ? <Empty className="min-h-48 rounded-none border-0 bg-card">
        <EmptyHeader><EmptyMedia variant="icon"><TriangleAlert /></EmptyMedia><EmptyTitle>{text.emptyTitle}</EmptyTitle><EmptyDescription>{text.emptyDescription}</EmptyDescription></EmptyHeader>
      </Empty> : <>
        <div className="hidden md:block"><Table>
          <TableHeader><TableRow><TableHead className="h-12 pl-5 text-muted-foreground">{text.observed}</TableHead><TableHead className="text-muted-foreground">{text.descriptionColumn}</TableHead><TableHead className="text-muted-foreground">{text.reporter}</TableHead><TableHead className="text-muted-foreground">{text.status}</TableHead><TableHead className="pr-5 text-right text-muted-foreground">{text.photos}</TableHead></TableRow></TableHeader>
          <TableBody>{visible.map((item) => <TableRow key={item.id}>
            <TableCell className="pl-5 tabular-nums"><span className="inline-flex items-center gap-2"><CalendarDays className="size-4 text-muted-foreground" />{dateLabel(item.observed_date, locale)}</span></TableCell>
            <TableCell><Link href={`/anomalies/${item.id}`} className="line-clamp-2 max-w-md font-medium hover:underline">{item.description}</Link></TableCell>
            <TableCell>{item.reporter_name}</TableCell><TableCell><Status value={item.status} locale={locale} /></TableCell><TableCell className="pr-5 text-right"><span className="inline-flex items-center justify-end gap-1.5 text-muted-foreground"><ImageIcon className="size-4" />{new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB").format(item.photo_count)}</span></TableCell>
          </TableRow>)}</TableBody>
        </Table></div>
        <div className="divide-y md:hidden">{visible.map((item) => <Link key={item.id} href={`/anomalies/${item.id}`} className="block px-5 py-4 hover:bg-muted/40">
          <div className="flex items-start justify-between gap-3"><div className="text-sm font-medium">{dateLabel(item.observed_date, locale)}</div><Status value={item.status} locale={locale} /></div><p className="mt-2 line-clamp-2 text-sm">{item.description}</p><div className="mt-2 text-xs text-muted-foreground">{text.reportedBy} {item.reporter_name} · {new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB").format(item.photo_count)} {item.photo_count === 1 ? text.photo : text.photosPlural}</div>
        </Link>)}</div>
        <DataTablePagination page={page + 1} total={anomalies.length} noun="anomalies" onPageChange={(nextPage) => setPage(nextPage - 1)} />
        {anomalies.length > TABLE_PAGE_SIZE && <div className="px-4 pb-4 text-right"><Link href="/anomalies" className="text-xs text-muted-foreground hover:underline">{text.viewAll}</Link></div>}
      </>}
    </section>
  );
}
