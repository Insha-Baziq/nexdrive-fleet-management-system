"use client";

import { useState, type FormEvent } from "react";
import { CalendarDays, Plus } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { VehicleInspection } from "@/lib/vehicle-inspections";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";

const labels = {
  fr: {
    title: "Contrôles périodiques", subtitle: "La dernière échéance enregistrée est utilisée pour le tableau de bord.",
    add: "Ajouter un contrôle", technical: "Échéance du contrôle technique", emissions: "Échéance du contrôle antipollution",
    optional: "Facultatif", history: "Historique des échéances", noHistory: "Aucun contrôle enregistré",
    noHistoryHint: "Ajoutez les prochaines échéances du véhicule pour les suivre ici.",
    addTitle: "Ajouter des échéances de contrôle", addHint: "Une nouvelle entrée conserve les échéances précédentes dans l’historique.",
    recorded: "Enregistré par", recordedOn: "Ajouté le", actions: "Actions", initial: "Date initiale importée",
    staff: "Équipe", pageNoun: "contrôles", save: "Enregistrer", saving: "Enregistrement…", close: "Fermer",
    error: "Impossible d’enregistrer ces échéances. Vérifiez les dates et réessayez.", noDate: "Non défini",
  },
  en: {
    title: "Periodic inspections", subtitle: "The latest recorded due date is used by the dashboard.",
    add: "Add inspection", technical: "Technical inspection due", emissions: "Emissions inspection due",
    optional: "Optional", history: "Due date history", noHistory: "No inspections recorded",
    noHistoryHint: "Add the vehicle’s upcoming due dates to track them here.",
    addTitle: "Add inspection due dates", addHint: "A new entry keeps earlier due dates in the history.",
    recorded: "Recorded by", recordedOn: "Added on", actions: "Actions", initial: "Imported starting date",
    staff: "Staff", pageNoun: "inspections", save: "Save", saving: "Saving…", close: "Close",
    error: "Could not save these due dates. Check the dates and try again.", noDate: "Not set",
  },
} as const;

function dateLabel(value: string | null, locale: "fr" | "en") {
  if (!value) return labels[locale].noDate;
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function recordedAtLabel(value: string, locale: "fr" | "en") {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(value));
}

export function VehicleInspectionsPanel({ vehicleId, canManage, initialInspections }: {
  vehicleId: string;
  canManage: boolean;
  initialInspections: VehicleInspection[];
}) {
  const { locale } = useLocale();
  const text = labels[locale];
  const [inspections, setInspections] = useState(initialInspections);
  const [pageIndex, setPageIndex] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [technicalDueDate, setTechnicalDueDate] = useState("");
  const [emissionsDueDate, setEmissionsDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pageCount = Math.max(1, Math.ceil(inspections.length / TABLE_PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1);
  const visibleInspections = inspections.slice(page * TABLE_PAGE_SIZE, (page + 1) * TABLE_PAGE_SIZE);
  const current = inspections[0] ?? null;

  function resetForm() {
    setTechnicalDueDate("");
    setEmissionsDueDate("");
    setError("");
  }

  async function saveInspection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/vehicles/${vehicleId}/inspections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ technicalDueDate, emissionsDueDate: emissionsDueDate || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(text.error);
      setInspections((items) => [result.inspection as VehicleInspection, ...items]
        .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at) || right.id.localeCompare(left.id)));
      setPageIndex(0);
      setDialogOpen(false);
      resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.error);
    } finally { setBusy(false); }
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{text.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{text.subtitle}</p>
        </div>
        {canManage && <Button onClick={() => setDialogOpen(true)}><Plus /> {text.add}</Button>}
      </div>

      <div className="grid gap-4 border-b px-5 py-4 sm:grid-cols-2 sm:px-6">
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">{text.technical}</p>
          <p className="mt-1 text-sm font-medium tabular-nums">{dateLabel(current?.technical_due_date ?? null, locale)}</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">{text.emissions}</p>
          <p className="mt-1 text-sm font-medium tabular-nums">{dateLabel(current?.emissions_due_date ?? null, locale)}</p>
        </div>
      </div>

      {!inspections.length ? <Empty className="min-h-48 rounded-none border-0 bg-card">
        <EmptyHeader><EmptyMedia variant="icon"><CalendarDays /></EmptyMedia><EmptyTitle>{text.noHistory}</EmptyTitle><EmptyDescription>{text.noHistoryHint}</EmptyDescription></EmptyHeader>
      </Empty> : <>
        <div className="hidden md:block">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="h-12 pl-5 text-muted-foreground">{text.technical}</TableHead>
              <TableHead className="text-muted-foreground">{text.emissions}</TableHead>
              <TableHead className="text-muted-foreground">{text.recorded}</TableHead>
              <TableHead className="pr-5 text-muted-foreground">{text.recordedOn}</TableHead>
            </TableRow></TableHeader>
            <TableBody>{visibleInspections.map((item) => <TableRow key={item.id}>
              <TableCell className="pl-5 font-medium tabular-nums">{dateLabel(item.technical_due_date, locale)}</TableCell>
              <TableCell className="tabular-nums">{dateLabel(item.emissions_due_date, locale)}</TableCell>
              <TableCell>{item.source === "legacy" ? <Badge variant="outline">{text.initial}</Badge> : item.recorded_by_name || text.staff}</TableCell>
              <TableCell className="pr-5 tabular-nums">{recordedAtLabel(item.recorded_at, locale)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>
        <div className="divide-y md:hidden">
          {visibleInspections.map((item) => <article key={item.id} className="px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-medium">{dateLabel(item.technical_due_date, locale)}</div>
              {item.source === "legacy" && <Badge variant="outline">{text.initial}</Badge>}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">{text.emissions}</dt><dd className="mt-0.5 font-medium">{dateLabel(item.emissions_due_date, locale)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{text.recordedOn}</dt><dd className="mt-0.5 font-medium">{recordedAtLabel(item.recorded_at, locale)}</dd></div>
            </dl>
            {item.source !== "legacy" && <p className="mt-2 text-xs text-muted-foreground">{text.recorded}: {item.recorded_by_name || text.staff}</p>}
          </article>)}
        </div>
        <DataTablePagination page={page + 1} total={inspections.length} noun={text.pageNoun} onPageChange={(nextPage) => setPageIndex(nextPage - 1)} />
      </>}

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <form onSubmit={saveInspection} className="grid gap-4">
            <DialogHeader><DialogTitle>{text.addTitle}</DialogTitle><DialogDescription>{text.addHint}</DialogDescription></DialogHeader>
            <div className="grid gap-2"><Label htmlFor={`inspection-technical-${vehicleId}`}>{text.technical} *</Label><Input id={`inspection-technical-${vehicleId}`} type="date" required value={technicalDueDate} onChange={(event) => setTechnicalDueDate(event.currentTarget.value)} /></div>
            <div className="grid gap-2"><Label htmlFor={`inspection-emissions-${vehicleId}`}>{text.emissions} <span className="font-normal text-muted-foreground">({text.optional})</span></Label><Input id={`inspection-emissions-${vehicleId}`} type="date" value={emissionsDueDate} onChange={(event) => setEmissionsDueDate(event.currentTarget.value)} /></div>
            {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
            <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setDialogOpen(false)}>{text.close}</Button><Button type="submit" disabled={busy}>{busy ? text.saving : text.save}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
