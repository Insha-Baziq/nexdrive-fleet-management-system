"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type { VehicleAnomaly } from "@/lib/anomalies";
import { useLocale } from "@/components/locale-provider";

function dateLabel(value: string, locale: "fr" | "en") {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function statusLabel(value: VehicleAnomaly["status"], locale: "fr" | "en") {
  if (locale === "fr") return value === "open" ? "Ouverte" : value === "resolved" ? "Résolue" : "Annulée";
  return value[0].toUpperCase() + value.slice(1);
}

function Status({ value, locale }: { value: VehicleAnomaly["status"]; locale: "fr" | "en" }) {
  const className = value === "open" ? "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300"
    : value === "resolved" ? "border-primary/20 bg-primary/10 text-primary"
      : "border-border bg-muted text-muted-foreground";
  return <Badge variant="outline" className={className}>{statusLabel(value, locale)}</Badge>;
}

export function AnomalyList({ anomalies }: { anomalies: VehicleAnomaly[] }) {
  const { locale } = useLocale();
  const text = locale === "fr" ? {
    title: "Anomalies des véhicules", description: "Problèmes signalés sur les véhicules et décisions associées.",
    searchLabel: "Rechercher des anomalies", searchPlaceholder: "Véhicule, description, personne…", noMatches: "Aucune anomalie correspondante",
    noAnomalies: "Aucune anomalie pour le moment", trySearch: "Essayez une autre recherche.", noReports: "Les problèmes signalés apparaîtront ici.",
    vehicle: "Véhicule", observed: "Observée le", descriptionColumn: "Description", reporter: "Signalée par", status: "Statut", photos: "Photos",
    reportedBy: "Signalée par", photo: "photo", photosPlural: "photos", view: "Voir l’anomalie →",
  } : {
    title: "Vehicle anomalies", description: "Reported vehicle problems and their outcomes.",
    searchLabel: "Search anomalies", searchPlaceholder: "Search vehicle, description, reporter…", noMatches: "No matching anomalies",
    noAnomalies: "No vehicle anomalies yet", trySearch: "Try a different search.", noReports: "Reported vehicle problems will appear here.",
    vehicle: "Vehicle", observed: "Observed", descriptionColumn: "Description", reporter: "Reporter", status: "Status", photos: "Photos",
    reportedBy: "Reported by", photo: "photo", photosPlural: "photos", view: "View anomaly →",
  };
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? anomalies.filter((item) => [item.vehicle_registration, item.vehicle_make, item.vehicle_model, item.description, item.reporter_name, item.status, statusLabel(item.status, locale)].join(" ").toLocaleLowerCase().includes(query)) : anomalies;
  }, [anomalies, search, locale]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(currentPage * TABLE_PAGE_SIZE, (currentPage + 1) * TABLE_PAGE_SIZE);

  return (
    <main className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-7 sm:px-6 lg:px-10 lg:pt-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{text.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{text.description}</p>
      </div>
      <div className="mb-4 w-full max-w-sm">
        <label className="sr-only" htmlFor="anomaly-search">{text.searchLabel}</label>
        <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="anomaly-search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder={text.searchPlaceholder} className="pl-9" /></div>
      </div>
      <Card className="overflow-hidden rounded-xl shadow-sm">
        {!rows.length ? <Empty className="min-h-[200px] rounded-none border-0 bg-card">
          <EmptyHeader><EmptyMedia variant="icon"><TriangleAlert /></EmptyMedia><EmptyTitle>{search ? text.noMatches : text.noAnomalies}</EmptyTitle><EmptyDescription>{search ? text.trySearch : text.noReports}</EmptyDescription></EmptyHeader>
        </Empty> : <>
          <div className="hidden md:block">
            <Table>
              <TableHeader><TableRow><TableHead className="h-12 pl-5 text-muted-foreground">{text.vehicle}</TableHead><TableHead className="text-muted-foreground">{text.observed}</TableHead><TableHead className="text-muted-foreground">{text.descriptionColumn}</TableHead><TableHead className="text-muted-foreground">{text.reporter}</TableHead><TableHead className="text-muted-foreground">{text.status}</TableHead><TableHead className="w-28 text-right text-muted-foreground">{text.photos}</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map((item) => <TableRow key={item.id}>
                <TableCell className="pl-5"><Link className="font-medium underline-offset-4 hover:underline" href={`/anomalies/${item.id}`}>{item.vehicle_registration}</Link><div className="mt-0.5 text-xs text-muted-foreground">{[item.vehicle_make, item.vehicle_model].filter(Boolean).join(" ")}</div></TableCell>
                <TableCell className="tabular-nums">{dateLabel(item.observed_date, locale)}</TableCell>
                <TableCell><Link href={`/anomalies/${item.id}`} className="line-clamp-2 max-w-md text-sm text-foreground hover:underline">{item.description}</Link></TableCell>
                <TableCell>{item.reporter_name}</TableCell><TableCell><Status value={item.status} locale={locale} /></TableCell><TableCell className="pr-5 text-right tabular-nums">{new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB").format(item.photo_count)}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </div>
          <div className="nexdrive-mobile-list md:hidden">{rows.map((item) => <Link key={item.id} href={`/anomalies/${item.id}`} className="block min-w-0 hover:border-primary/30">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-base font-semibold tracking-tight">{item.vehicle_registration}</div><div className="mt-0.5 text-sm text-muted-foreground">{[item.vehicle_make, item.vehicle_model].filter(Boolean).join(" ")}</div></div><Status value={item.status} locale={locale} /></div>
            <p className="mt-4 line-clamp-2 text-sm font-medium leading-relaxed">{item.description}</p><dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-sm"><div><dt className="text-xs text-muted-foreground">{text.observed}</dt><dd className="mt-0.5 font-medium tabular-nums">{dateLabel(item.observed_date, locale)}</dd></div><div className="min-w-0"><dt className="text-xs text-muted-foreground">{text.reportedBy}</dt><dd className="mt-0.5 break-words font-medium">{item.reporter_name}</dd></div></dl><div className="mt-3 flex items-center justify-between text-xs"><span className="text-muted-foreground">{new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB").format(item.photo_count)} {item.photo_count === 1 ? text.photo : text.photosPlural}</span><span className="font-medium text-primary">{text.view}</span></div>
          </Link>)}</div>
          <DataTablePagination page={currentPage + 1} total={filtered.length} noun="anomalies" onPageChange={(nextPage) => setPage(nextPage - 1)} />
        </>}
      </Card>
    </main>
  );
}
