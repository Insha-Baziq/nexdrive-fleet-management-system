"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { FineCreateDialog } from "@/components/fine-create-dialog";
import { useLocale } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type { Fine } from "@/lib/fine-dossiers";

type VehicleOption = { id: string; registration: string; make: string; model: string };

function timeLabel(value: string, locale: "fr" | "en") {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function dateLabel(value: string, locale: "fr" | "en") {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function Status({ value, french }: { value: Fine["status"]; french: boolean }) {
  const className = value === "open" ? "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300"
    : value === "closed" ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground";
  return <Badge variant="outline" className={className}>{fineStatusLabels[french ? "fr" : "en"][value]}</Badge>;
}

const fineStatusLabels: Record<"fr" | "en", Record<Fine["status"], string>> = {
  fr: { open: "En cours", closed: "Clôturée", cancelled: "Annulée" },
  en: { open: "Open", closed: "Closed", cancelled: "Cancelled" },
};
const fineTypeLabels: Record<"fr" | "en", Record<Fine["fine_type"], string>> = {
  fr: { company: "Entreprise", driver: "Liée à un conducteur" },
  en: { company: "Company", driver: "Driver-related" },
};

export function FineList({ fines, vehicles, canWrite, initialStatus = "all" }: { fines: Fine[]; vehicles: VehicleOption[]; canWrite: boolean; initialStatus?: "all" | Fine["status"] }) {
  const { locale } = useLocale();
  const french = locale === "fr";
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Fine["status"]>(initialStatus);
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return fines.filter((fine) => (statusFilter === "all" || fine.status === statusFilter)
      && (!query || [fine.reference, fine.vehicle_registration, fine.vehicle_make, fine.vehicle_model, fine.fine_type, fine.status].join(" ").toLocaleLowerCase().includes(query)));
  }, [fines, search, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(currentPage * TABLE_PAGE_SIZE, (currentPage + 1) * TABLE_PAGE_SIZE);

  return <main className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-7 sm:px-6 lg:px-10 lg:pt-10">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight text-foreground">Fines</h1><p className="mt-1 text-sm text-muted-foreground">Track fines and their supporting documents.</p></div>{canWrite ? <FineCreateDialog vehicles={vehicles} /> : null}</div>
    <div className="mb-4 flex flex-wrap items-end gap-3"><div className="w-full max-w-sm"><label htmlFor="fine-search" className="sr-only">Rechercher des amendes</label><div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="fine-search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Rechercher par référence ou véhicule…" className="pl-9" /></div></div><div className="w-full sm:w-44"><label htmlFor="fine-status" className="sr-only">Filtrer par statut</label><Select value={statusFilter} onValueChange={(value) => { setStatusFilter((value ?? "all") as typeof statusFilter); setPage(0); }}><SelectTrigger id="fine-status" aria-label={locale === "fr" ? "Filtrer par statut" : "Filter by status"} className="w-full"><SelectValue>{(value: string) => value === "all" ? (french ? "Tous les statuts" : "All statuses") : fineStatusLabels[french ? "fr" : "en"][value as Fine["status"]] ?? value}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">{french ? "Tous les statuts" : "All statuses"}</SelectItem>{Object.entries(fineStatusLabels[french ? "fr" : "en"]).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div></div>
    <Card className="overflow-hidden rounded-xl shadow-sm">
      {!rows.length ? <Empty className="min-h-[200px] rounded-none border-0 bg-card"><EmptyHeader><EmptyMedia variant="icon"><FileText /></EmptyMedia><EmptyTitle>{search || statusFilter !== "all" ? "Aucune amende correspondante" : "Aucune amende"}</EmptyTitle><EmptyDescription>{search || statusFilter !== "all" ? "Modifiez la recherche ou le filtre." : "Les amendes apparaîtront ici."}</EmptyDescription></EmptyHeader></Empty> : <>
        <div className="hidden md:block"><Table><TableHeader><TableRow><TableHead className="h-12 pl-5 text-muted-foreground">Reference</TableHead><TableHead className="text-muted-foreground">Vehicle</TableHead><TableHead className="text-muted-foreground">Infraction</TableHead><TableHead className="text-muted-foreground">Deadline</TableHead><TableHead className="text-muted-foreground">Type</TableHead><TableHead className="text-muted-foreground">Status</TableHead></TableRow></TableHeader><TableBody>{rows.map((fine) => <TableRow key={fine.id}><TableCell className="pl-5"><Link className="font-medium underline-offset-4 hover:underline" href={`/fines/${fine.id}`}>{fine.reference}</Link></TableCell><TableCell><Link href={`/fines/${fine.id}`} className="font-medium hover:underline">{fine.vehicle_registration}</Link><div className="mt-0.5 text-xs text-muted-foreground">{fine.vehicle_make} {fine.vehicle_model}</div></TableCell><TableCell className="tabular-nums">{timeLabel(fine.infraction_at, locale)}</TableCell><TableCell className="tabular-nums">{dateLabel(fine.payment_deadline, locale)}</TableCell><TableCell>{fineTypeLabels[locale][fine.fine_type]}</TableCell><TableCell><Status value={fine.status} french={french} /></TableCell></TableRow>)}</TableBody></Table></div>
        <div className="nexdrive-mobile-list md:hidden">{rows.map((fine) => <Link key={fine.id} href={`/fines/${fine.id}`} className="block min-w-0 hover:border-primary/30"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="break-all text-base font-semibold tracking-tight">{fine.reference}</div><div className="mt-0.5 break-words text-sm text-muted-foreground">{fine.vehicle_registration} · {fine.vehicle_make} {fine.vehicle_model}</div></div><Status value={fine.status} french={french} /></div><dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-sm"><div><dt className="text-xs text-muted-foreground">Infraction</dt><dd className="mt-0.5 font-medium tabular-nums">{timeLabel(fine.infraction_at, locale)}</dd></div><div><dt className="text-xs text-muted-foreground">Payment deadline</dt><dd className="mt-0.5 font-medium tabular-nums">{dateLabel(fine.payment_deadline, locale)}</dd></div><div className="col-span-2"><dt className="text-xs text-muted-foreground">Type</dt><dd className="mt-0.5 font-medium">{fineTypeLabels[locale][fine.fine_type]}</dd></div></dl><div className="mt-3 text-right text-xs font-medium text-primary">View fine →</div></Link>)}</div>
        <DataTablePagination page={currentPage + 1} total={filtered.length} noun="fines" onPageChange={(nextPage) => setPage(nextPage - 1)} />
      </>}
    </Card>
  </main>;
}
