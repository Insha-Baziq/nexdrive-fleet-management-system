"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type { AssignmentHistory } from "@/lib/assignments";
import { useLocale } from "@/components/locale-provider";

function assignmentDate(value: string | null, locale: "fr" | "en", currentLabel: string) {
  if (!value) return currentLabel;
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}

export function AssignmentHistoryTable({ history }: { history: AssignmentHistory[] }) {
  const { locale } = useLocale();
  const text = locale === "fr" ? {
    current: "En cours", title: "Historique des affectations", description: "Conducteurs actuels et précédents de ce véhicule",
    driver: "Conducteur", from: "Début (UTC)", to: "Fin (UTC)", endReason: "Motif de fin", mobileFrom: "Début", mobileTo: "Fin",
    noAssignments: "Aucune affectation enregistrée pour le moment.",
  } : {
    current: "Current", title: "Assignment history", description: "Current and previous drivers for this vehicle",
    driver: "Driver", from: "From (UTC)", to: "To (UTC)", endReason: "End reason", mobileFrom: "From", mobileTo: "To",
    noAssignments: "No assignments recorded yet.",
  };
  const [pageIndex, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(history.length / TABLE_PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1);
  const visible = history.slice(page * TABLE_PAGE_SIZE, (page + 1) * TABLE_PAGE_SIZE);
  return (
        <section className="mt-5 overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="border-b px-6 py-5"><h2 className="text-sm font-semibold text-foreground">{text.title}</h2><p className="mt-0.5 text-xs text-muted-foreground">{text.description}</p></div>
          {history.length ? <>
            <div className="hidden sm:block"><Table>
              <TableHeader><TableRow><TableHead>{text.driver}</TableHead><TableHead>{text.from}</TableHead><TableHead>{text.to}</TableHead><TableHead>{text.endReason}</TableHead></TableRow></TableHeader>
              <TableBody>{visible.map((entry) => <TableRow key={entry.id}>
                <TableCell className="font-medium">{entry.driver_name}{!entry.ended_at && <Badge variant="outline" className="ml-2 border-primary/20 bg-primary/10 text-primary">{text.current}</Badge>}</TableCell>
                <TableCell>{assignmentDate(entry.started_at, locale, text.current)}</TableCell>
                <TableCell>{entry.ended_at ? assignmentDate(entry.ended_at, locale, text.current) : "—"}</TableCell>
                <TableCell className="max-w-xs whitespace-normal text-muted-foreground">{entry.end_reason || "—"}</TableCell>
              </TableRow>)}</TableBody>
            </Table></div>
            <div className="divide-y sm:hidden">{visible.map((entry) => <div key={entry.id} className="grid gap-3 px-4 py-4 text-sm">
              <div><span className="text-xs text-muted-foreground">{text.driver} · </span><span className="font-medium">{entry.driver_name}</span>{!entry.ended_at && <Badge variant="outline" className="ml-2 border-primary/20 bg-primary/10 text-primary">{text.current}</Badge>}</div>
              <div><span className="text-xs text-muted-foreground">{text.mobileFrom} · </span>{assignmentDate(entry.started_at, locale, text.current)}</div>
              <div><span className="text-xs text-muted-foreground">{text.mobileTo} · </span>{entry.ended_at ? assignmentDate(entry.ended_at, locale, text.current) : "—"}</div>
              <div className="text-muted-foreground"><span className="text-xs">{text.endReason} · </span>{entry.end_reason || "—"}</div>
            </div>)}</div>
          </> : <p className="px-6 py-6 text-sm text-muted-foreground">{text.noAssignments}</p>}
          {history.length > 0 && <DataTablePagination page={page + 1} total={history.length} noun="assignments" onPageChange={(nextPage) => setPage(nextPage - 1)} />}
        </section>
  );
}
