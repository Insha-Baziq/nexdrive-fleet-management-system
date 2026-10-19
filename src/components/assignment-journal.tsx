"use client";

import { Fragment, useMemo, useState } from "react";
import { BookOpenText, Pencil } from "lucide-react";
import type { AssignmentCorrection, AssignmentJournalEntry } from "@/lib/assignments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import { AssignmentCorrectionDialog } from "@/components/assignment-correction-dialog";
import { AssignmentEndDialog } from "@/components/assignment-end-dialog";
import { useLocale } from "@/components/locale-provider";

function dateTime(value: string | null, locale: "fr" | "en") {
  if (!value) return null;
  return new Date(value).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
}

const copy = {
  fr: {
    previousInterval: "Période précédente", correctedInterval: "Période corrigée", correctedBy: "Corrigée par", reason: "Motif", history: "Historique des corrections",
    title: "Journal des affectations", description: "Consultez les affectations de véhicules et de conducteurs de votre organisation.",
    searchLabel: "Rechercher par conducteur ou véhicule", searchPlaceholder: "Conducteur ou véhicule…", from: "Début à partir du", to: "Début jusqu’au", clear: "Effacer les filtres",
    noMatches: "Aucune affectation correspondante", noAssignments: "Aucune affectation enregistrée", changeFilters: "Modifiez la recherche ou les filtres.",
    appear: "Les affectations apparaîtront ici.", vehicle: "Véhicule", driver: "Conducteur", start: "Début", end: "Fin", startReason: "Motif de l’affectation",
    endReason: "Motif de fin", createdBy: "Créée par", status: "Statut", actions: "Actions", corrected: "Corrigée", endAction: "Terminer", correct: "Corriger",
    endFor: "Terminer l’affectation pour", correctFor: "Corriger l’affectation pour", noun: "affectation",
  },
  en: {
    previousInterval: "Previous interval", correctedInterval: "Corrected interval", correctedBy: "Corrected by", reason: "Reason", history: "Correction history",
    title: "Assignment journal", description: "Review vehicle and driver allocations across your organization.",
    searchLabel: "Search by driver or vehicle", searchPlaceholder: "Driver or vehicle…", from: "Start from", to: "Start through", clear: "Clear filters",
    noMatches: "No matching assignments", noAssignments: "No assignments recorded", changeFilters: "Change the search or filters.",
    appear: "Assignments will appear here.", vehicle: "Vehicle", driver: "Driver", start: "Start", end: "End", startReason: "Assignment reason",
    endReason: "Ending reason", createdBy: "Created by", status: "Status", actions: "Actions", corrected: "Corrected", endAction: "End", correct: "Correct",
    endFor: "End assignment for", correctFor: "Correct assignment for", noun: "assignment",
  },
} as const;

function AssignmentStatus({ active, locale }: { active: boolean; locale: "fr" | "en" }) {
  return active
    ? <Badge className="h-auto rounded-sm bg-primary/10 px-1.5 py-0.5 text-primary hover:bg-primary/10">{locale === "fr" ? "En cours" : "Active"}</Badge>
    : <Badge variant="outline" className="h-auto rounded-sm px-1.5 py-0.5">{locale === "fr" ? "Terminée" : "Ended"}</Badge>;
}

function CorrectionHistory({ corrections, locale }: { corrections: AssignmentCorrection[]; locale: "fr" | "en" }) {
  if (!corrections.length) return null;
  const text = copy[locale];
  const active = locale === "fr" ? "En cours" : "Active";
  return <details className="rounded-md border bg-muted/20 px-3 py-2">
    <summary className="cursor-pointer text-sm font-medium">{text.history} ({corrections.length})</summary>
    <ol className="mt-3 divide-y">
      {corrections.map((correction) => <li key={correction.id} className="grid gap-3 py-3 first:pt-0 sm:grid-cols-2 xl:grid-cols-4">
        <div><p className="text-xs text-muted-foreground">{text.previousInterval}</p><p className="mt-1 text-sm">{dateTime(correction.old_started_at, locale)} – {dateTime(correction.old_ended_at, locale) ?? active}</p></div>
        <div><p className="text-xs text-muted-foreground">{text.correctedInterval}</p><p className="mt-1 text-sm">{dateTime(correction.new_started_at, locale)} – {dateTime(correction.new_ended_at, locale) ?? active}</p></div>
        <div><p className="text-xs text-muted-foreground">{text.correctedBy} · {dateTime(correction.corrected_at, locale)}</p><p className="mt-1 text-sm">{correction.corrected_by_name}</p></div>
        <div><p className="text-xs text-muted-foreground">{text.reason}</p><p className="mt-1 break-words text-sm">{correction.reason}</p></div>
      </li>)}
    </ol>
  </details>;
}

export function AssignmentJournal({ assignments, isAdministrator, canEndAssignments }: { assignments: AssignmentJournalEntry[]; isAdministrator: boolean; canEndAssignments: boolean }) {
  const { locale } = useLocale();
  const text = copy[locale];
  const activeLabel = locale === "fr" ? "En cours" : "Active";
  const endedLabel = locale === "fr" ? "Terminée" : "Ended";
  const allStatusesLabel = locale === "fr" ? "Tous les statuts" : "All statuses";
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState<AssignmentJournalEntry | null>(null);
  const [selectedToEnd, setSelectedToEnd] = useState<AssignmentJournalEntry | null>(null);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return assignments.filter((assignment) => {
      const startDay = assignment.started_at.slice(0, 10);
      return (!query || `${assignment.driver_name} ${assignment.vehicle_registration}`.toLocaleLowerCase().includes(query))
        && (status === "all" || (status === "active") === !assignment.ended_at)
        && (!fromDate || startDay >= fromDate)
        && (!toDate || startDay <= toDate);
    });
  }, [assignments, search, status, fromDate, toDate]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / TABLE_PAGE_SIZE) - 1));
  const rows = filtered.slice(currentPage * TABLE_PAGE_SIZE, (currentPage + 1) * TABLE_PAGE_SIZE);

  return <main className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-7 sm:px-6">
    <div className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight">{text.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{text.description}</p>
    </div>
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="w-full sm:w-64"><Label htmlFor="assignment-search" className="sr-only">{text.searchLabel}</Label><Input id="assignment-search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder={text.searchPlaceholder} /></div>
      <div className="w-full sm:w-40"><Label htmlFor="assignment-status" className="sr-only">Statut</Label><Select value={status} onValueChange={(value) => { setStatus(value ?? "all"); setPage(0); }}><SelectTrigger id="assignment-status" aria-label={locale === "fr" ? "Statut de l’affectation" : "Assignment status"} className="w-full"><SelectValue>{(value: string) => value === "active" ? activeLabel : value === "ended" ? endedLabel : allStatusesLabel}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">{allStatusesLabel}</SelectItem><SelectItem value="active">{activeLabel}</SelectItem><SelectItem value="ended">{endedLabel}</SelectItem></SelectContent></Select></div>
      <div><Label htmlFor="assignment-from" className="text-xs text-muted-foreground">{text.from}</Label><Input id="assignment-from" type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(0); }} className="mt-1 w-40" /></div>
      <div><Label htmlFor="assignment-to" className="text-xs text-muted-foreground">{text.to}</Label><Input id="assignment-to" type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(0); }} className="mt-1 w-40" /></div>
      {(search || status !== "all" || fromDate || toDate) && <Button variant="outline" onClick={() => { setSearch(""); setStatus("all"); setFromDate(""); setToDate(""); setPage(0); }}>{text.clear}</Button>}
    </div>
    <Card className="nexdrive-wide-cards w-full gap-0 py-0">
      {!filtered.length ? <Empty className="min-h-[200px] rounded-none border-0 bg-card">
        <EmptyHeader><EmptyMedia variant="icon"><BookOpenText /></EmptyMedia><EmptyTitle>{assignments.length ? text.noMatches : text.noAssignments}</EmptyTitle><EmptyDescription>{assignments.length ? text.changeFilters : text.appear}</EmptyDescription></EmptyHeader>
      </Empty> : <>
        <div className="hidden xl:block">
          <Table className="min-w-[1080px]">
            <TableHeader><TableRow>
              <TableHead className="h-12 pl-5 text-muted-foreground">{text.vehicle}</TableHead>
              <TableHead className="text-muted-foreground">{text.driver}</TableHead>
              <TableHead className="text-muted-foreground">{text.start}</TableHead>
              <TableHead className="text-muted-foreground">{text.end}</TableHead>
              <TableHead className="text-muted-foreground">{text.startReason}</TableHead>
              <TableHead className="text-muted-foreground">{text.endReason}</TableHead>
              <TableHead className="text-muted-foreground">{text.createdBy}</TableHead>
              <TableHead className="pr-5 text-right text-muted-foreground">{text.status}</TableHead>
              {(isAdministrator || canEndAssignments) && <TableHead className="min-w-40 pr-5 text-right text-muted-foreground">{text.actions}</TableHead>}
            </TableRow></TableHeader>
            <TableBody>{rows.map((assignment) => <Fragment key={assignment.id}>
              <TableRow className="h-16">
                <TableCell className="pl-5 font-mono text-xs font-medium">{assignment.vehicle_registration}</TableCell>
                <TableCell className="font-medium">{assignment.driver_name}</TableCell>
                <TableCell className="tabular-nums">{dateTime(assignment.started_at, locale)}</TableCell>
                <TableCell className="tabular-nums">{dateTime(assignment.ended_at, locale) ?? <span className="text-muted-foreground">{activeLabel}</span>}</TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground" title={assignment.start_reason ?? undefined}>{assignment.start_reason || "—"}</TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground" title={assignment.end_reason ?? undefined}>{assignment.end_reason || "—"}</TableCell>
                <TableCell>{assignment.created_by_name}</TableCell>
                <TableCell className="pr-5 text-right"><AssignmentStatus active={!assignment.ended_at} locale={locale} />{assignment.corrections.length > 0 && <Badge variant="outline" className="ml-2">{text.corrected}</Badge>}</TableCell>
                {(isAdministrator || canEndAssignments) && <TableCell className="pr-5 text-right"><div className="flex justify-end gap-2">
                  {canEndAssignments && !assignment.ended_at && <Button variant="outline" size="sm" onClick={() => setSelectedToEnd(assignment)} aria-label={`${text.endFor} ${assignment.vehicle_registration}`}>{text.endAction}</Button>}
                  {isAdministrator && <Button variant="ghost" size="sm" onClick={() => setSelected(assignment)} aria-label={`${text.correctFor} ${assignment.vehicle_registration}`}><Pencil /> <span className="hidden 2xl:inline">{text.correct}</span></Button>}
                </div></TableCell>}
              </TableRow>
              {assignment.corrections.length > 0 && <TableRow><TableCell colSpan={isAdministrator || canEndAssignments ? 9 : 8} className="px-5 py-3"><CorrectionHistory corrections={assignment.corrections} locale={locale} /></TableCell></TableRow>}
            </Fragment>)}</TableBody>
          </Table>
        </div>
        <div className="nexdrive-mobile-list xl:hidden">
          {rows.map((assignment) => <article key={assignment.id} className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><div className="font-mono text-sm font-semibold">{assignment.vehicle_registration}</div><div className="mt-1 break-words text-sm text-muted-foreground">{assignment.driver_name}</div></div>
              <AssignmentStatus active={!assignment.ended_at} locale={locale} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-muted-foreground">{text.start}</dt><dd className="mt-0.5 break-words font-medium tabular-nums">{dateTime(assignment.started_at, locale)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{text.end}</dt><dd className="mt-0.5 break-words font-medium tabular-nums">{dateTime(assignment.ended_at, locale) ?? activeLabel}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{text.createdBy}</dt><dd className="mt-0.5 break-words font-medium">{assignment.created_by_name}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{text.startReason}</dt><dd className="mt-0.5 break-words font-medium">{assignment.start_reason || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{text.endReason}</dt><dd className="mt-0.5 break-words font-medium">{assignment.end_reason || "—"}</dd></div>
            </dl>
            <div className="mt-4 space-y-3">
              <CorrectionHistory corrections={assignment.corrections} locale={locale} />
              <div className="flex flex-wrap gap-2">
                {canEndAssignments && !assignment.ended_at && <Button variant="outline" size="sm" onClick={() => setSelectedToEnd(assignment)} aria-label={`${text.endFor} ${assignment.vehicle_registration}`}>{locale === "fr" ? "Terminer l’affectation" : "End assignment"}</Button>}
                {isAdministrator && <Button variant="ghost" size="sm" onClick={() => setSelected(assignment)} aria-label={`${text.correctFor} ${assignment.vehicle_registration}`}><Pencil /> {text.correct}</Button>}
              </div>
            </div>
          </article>)}
        </div>
        <DataTablePagination page={currentPage + 1} total={filtered.length} noun={text.noun} onPageChange={(nextPage) => setPage(nextPage - 1)} />
      </>}
    </Card>
    {selected && <AssignmentCorrectionDialog key={selected.id} assignment={selected} open onOpenChange={(open) => { if (!open) setSelected(null); }} />}
    {selectedToEnd && <AssignmentEndDialog key={selectedToEnd.id} assignment={selectedToEnd} open onOpenChange={(open) => { if (!open) setSelectedToEnd(null); }} />}
  </main>;
}
