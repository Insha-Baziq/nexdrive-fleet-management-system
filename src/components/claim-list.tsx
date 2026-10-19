"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ShieldAlert } from "lucide-react";
import { ClaimCreateDialog } from "@/components/claim-create-dialog";
import { Badge } from "@/components/ui/badge";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocale } from "@/components/locale-provider";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type { Claim } from "@/lib/claim-dossiers";

type VehicleOption = { id: string; registration: string; make: string; model: string };

function dateLabel(value: string, locale: "fr" | "en") {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function Status({ value, locale }: { value: Claim["status"]; locale: "fr" | "en" }) {
  const className = value === "open" ? "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300"
    : value === "closed" ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground";
  return <Badge variant="outline" className={className}>{claimStatusLabels[locale][value]}</Badge>;
}

const claimStatusLabels: Record<"fr" | "en", Record<Claim["status"], string>> = {
  fr: { open: "En cours", closed: "Clôturé", cancelled: "Annulé", archived: "Archivé" },
  en: { open: "Open", closed: "Closed", cancelled: "Cancelled", archived: "Archived" },
};
const copy = {
  fr: {
    title: "Sinistres", description: "Suivez les incidents des véhicules, leur évolution et les documents associés.",
    searchLabel: "Rechercher des sinistres", searchPlaceholder: "Rechercher par véhicule ou date…", filterLabel: "Filtrer par statut",
    allStatuses: "Tous les statuts", noMatches: "Aucun sinistre correspondant", noClaims: "Aucun sinistre",
    changeFilters: "Modifiez la recherche ou le filtre.", createdAppear: "Les sinistres déclarés apparaîtront ici.", noItems: "Aucun sinistre à afficher.",
    vehicle: "Véhicule", incidentDate: "Date du sinistre", descriptionColumn: "Description", status: "Statut", viewClaim: "Voir le sinistre →",
    noun: "sinistre", unknownStatus: "Statut inconnu",
  },
  en: {
    title: "Claims", description: "Track vehicle incidents, updates, and supporting documents.",
    searchLabel: "Search claims", searchPlaceholder: "Search by vehicle or date…", filterLabel: "Filter by status",
    allStatuses: "All statuses", noMatches: "No matching claims", noClaims: "No claims",
    changeFilters: "Change the search or filter.", createdAppear: "Reported claims will appear here.", noItems: "No claims to display.",
    vehicle: "Vehicle", incidentDate: "Incident date", descriptionColumn: "Description", status: "Status", viewClaim: "View claim →",
    noun: "claim", unknownStatus: "Unknown status",
  },
} as const;

export function ClaimList({ claims, vehicles, canWrite, initialStatus = "all" }: { claims: Claim[]; vehicles: VehicleOption[]; canWrite: boolean; initialStatus?: "all" | Claim["status"] }) {
  const { locale } = useLocale();
  const text = copy[locale];
  const statusLabels = claimStatusLabels[locale];
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Claim["status"]>(initialStatus);
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return claims.filter((claim) => (statusFilter === "all" || claim.status === statusFilter)
      && (!query || [claim.vehicle_registration, claim.vehicle_make, claim.vehicle_model, claim.incident_date, claim.status].join(" ").toLocaleLowerCase().includes(query)));
  }, [claims, search, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(currentPage * TABLE_PAGE_SIZE, (currentPage + 1) * TABLE_PAGE_SIZE);

  return <main className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-7 sm:px-6 lg:px-10 lg:pt-10">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight text-foreground">{text.title}</h1><p className="mt-1 text-sm text-muted-foreground">{text.description}</p></div>{canWrite ? <ClaimCreateDialog vehicles={vehicles} /> : null}</div>
    <div className="mb-4 flex flex-wrap items-end gap-3"><div className="w-full max-w-sm"><label htmlFor="claim-search" className="sr-only">{text.searchLabel}</label><div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="claim-search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder={text.searchPlaceholder} className="pl-9" /></div></div><div className="w-full sm:w-44"><label htmlFor="claim-status" className="sr-only">{text.filterLabel}</label><Select value={statusFilter} onValueChange={(value) => { setStatusFilter((value ?? "all") as typeof statusFilter); setPage(0); }}><SelectTrigger id="claim-status" aria-label={text.filterLabel} className="w-full"><SelectValue>{(value: string) => value === "all" ? text.allStatuses : statusLabels[value as Claim["status"]] ?? text.unknownStatus}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">{text.allStatuses}</SelectItem>{Object.entries(statusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div></div>
    <Card className="overflow-hidden rounded-xl shadow-sm">
      {!rows.length ? <Empty className="min-h-[200px] rounded-none border-0 bg-card"><EmptyHeader><EmptyMedia variant="icon"><ShieldAlert /></EmptyMedia><EmptyTitle>{search || statusFilter !== "all" ? text.noMatches : text.noClaims}</EmptyTitle><EmptyDescription>{search || statusFilter !== "all" ? text.changeFilters : canWrite ? text.createdAppear : text.noItems}</EmptyDescription></EmptyHeader></Empty> : <>
        <div className="hidden md:block"><Table><TableHeader><TableRow><TableHead className="h-12 pl-5 text-muted-foreground">{text.vehicle}</TableHead><TableHead className="text-muted-foreground">{text.incidentDate}</TableHead><TableHead className="text-muted-foreground">{text.descriptionColumn}</TableHead><TableHead className="text-muted-foreground">{text.status}</TableHead></TableRow></TableHeader><TableBody>{rows.map((claim) => <TableRow key={claim.id}><TableCell className="pl-5"><Link href={`/claims/${claim.id}`} className="font-medium hover:underline">{claim.vehicle_registration}</Link><div className="mt-0.5 text-xs text-muted-foreground">{claim.vehicle_make} {claim.vehicle_model}</div></TableCell><TableCell className="tabular-nums"><Link href={`/claims/${claim.id}`} className="hover:underline">{dateLabel(claim.incident_date, locale)}</Link></TableCell><TableCell className="max-w-lg"><Link href={`/claims/${claim.id}`} className="line-clamp-2 text-sm text-muted-foreground hover:text-foreground">{claim.description}</Link></TableCell><TableCell><Status value={claim.status} locale={locale} /></TableCell></TableRow>)}</TableBody></Table></div>
        <div className="nexdrive-mobile-list md:hidden">{rows.map((claim) => <Link key={claim.id} href={`/claims/${claim.id}`} className="block min-w-0 hover:border-primary/30"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-base font-semibold tracking-tight">{claim.vehicle_registration}</div><div className="mt-0.5 break-words text-sm text-muted-foreground">{claim.vehicle_make} {claim.vehicle_model}</div></div><Status value={claim.status} locale={locale} /></div><dl className="mt-4 rounded-lg bg-muted/40 p-3 text-sm"><dt className="text-xs text-muted-foreground">{text.incidentDate}</dt><dd className="mt-0.5 font-medium tabular-nums">{dateLabel(claim.incident_date, locale)}</dd></dl><p className="mt-3 line-clamp-2 text-sm leading-relaxed">{claim.description}</p><div className="mt-3 text-right text-xs font-medium text-primary">{text.viewClaim}</div></Link>)}</div>
        <DataTablePagination page={currentPage + 1} total={filtered.length} noun={text.noun} onPageChange={(nextPage) => setPage(nextPage - 1)} />
      </>}
    </Card>
  </main>;
}
