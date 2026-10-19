"use client";

import { useState, type FormEvent } from "react";
import { CalendarDays, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/locale-provider";
import type { InsuranceEventType } from "@/lib/insurance-event-validation";
import type { VehicleInsuranceEvent, VehicleInsuranceStatus } from "@/lib/insurance-events";
import { insuranceEventTypeLabel, vehicleInsuranceStatusLabel } from "@/lib/client-feedback-copy";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";

const labels = {
  fr: {
    status: "Statut actuel", history: "Historique d’assurance", subtitle: "Les suspensions, impayés et confirmations d’assurance restent dans l’historique.",
    add: "Enregistrer un changement", events: "événements", eventType: "Événement", date: "Date", description: "Description",
    state: "État", actions: "Actions", active: "Actif", cancelled: "Annulé", cancel: "Annuler l’événement",
    noEvents: "Aucun événement d’assurance", noEventsHint: "Les changements de statut de ce véhicule apparaîtront ici.",
    addTitle: "Enregistrer un événement d’assurance", addHint: "Ajoutez un statut confirmé à l’historique de ce véhicule.",
    chooseType: "Nouveau statut", selectType: "Choisir un statut", eventDate: "Date d’effet", eventDescription: "Détails",
    eventPlaceholder: "Décrivez le changement de statut", close: "Fermer", save: "Enregistrer", saving: "Enregistrement…",
    cancelTitle: "Annuler l’événement d’assurance", cancelHint: "L’événement restera dans l’historique avec votre motif.",
    reason: "Motif d’annulation", reasonPlaceholder: "Expliquez pourquoi cet événement est annulé", keep: "Conserver l’événement",
    cancelSaving: "Annulation…", cancellationReason: "Motif :", error: "Impossible d’enregistrer le changement. Réessayez.",
  },
  en: {
    status: "Current status", history: "Insurance history", subtitle: "Suspensions, unpaid notices, and confirmed coverage stay in the history.",
    add: "Record a status change", events: "events", eventType: "Event", date: "Date", description: "Description",
    state: "State", actions: "Actions", active: "Active", cancelled: "Cancelled", cancel: "Cancel event",
    noEvents: "No insurance events", noEventsHint: "Status changes for this vehicle will appear here.",
    addTitle: "Record an insurance event", addHint: "Add a confirmed status to this vehicle’s history.",
    chooseType: "New status", selectType: "Choose a status", eventDate: "Effective date", eventDescription: "Details",
    eventPlaceholder: "Describe the status change", close: "Close", save: "Save", saving: "Saving…",
    cancelTitle: "Cancel insurance event", cancelHint: "The event will remain in the history with your reason.",
    reason: "Cancellation reason", reasonPlaceholder: "Explain why this event is being cancelled", keep: "Keep event",
    cancelSaving: "Cancelling…", cancellationReason: "Reason:", error: "Could not save the status change. Please try again.",
  },
} as const;

function dateLabel(value: string, locale: "fr" | "en") {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function EventType({ value, locale }: { value: InsuranceEventType; locale: "fr" | "en" }) {
  return insuranceEventTypeLabel(value, locale);
}

function isInsuranceEventType(value: string): value is InsuranceEventType {
  return value === "insured" || value === "suspension" || value === "unpaid";
}

function EventStatus({ value, locale }: { value: VehicleInsuranceEvent["status"]; locale: "fr" | "en" }) {
  return value === "active"
    ? <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">{labels[locale].active}</Badge>
    : <Badge variant="outline" className="border-border bg-muted text-muted-foreground">{labels[locale].cancelled}</Badge>;
}

function CurrentInsuranceStatus({ status, locale }: { status: VehicleInsuranceStatus; locale: "fr" | "en" }) {
  const color = status === "insured"
    ? "border-primary/20 bg-primary/10 text-primary"
    : status === "to_complete"
      ? "border-border bg-muted text-muted-foreground"
      : "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300";
  return <Badge variant="outline" className={color} data-insurance-status={status}>{vehicleInsuranceStatusLabel(status, locale)}</Badge>;
}

export function VehicleInsurancePanel({ vehicleId, canManage, initialEvents, initialStatus }: {
  vehicleId: string;
  canManage: boolean;
  initialEvents: VehicleInsuranceEvent[];
  initialStatus: VehicleInsuranceStatus;
}) {
  const { locale } = useLocale();
  const text = labels[locale];
  const [events, setEvents] = useState(initialEvents);
  const [insuranceStatus, setInsuranceStatus] = useState(initialStatus);
  const [pageIndex, setPageIndex] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<VehicleInsuranceEvent | null>(null);
  const [eventType, setEventType] = useState<InsuranceEventType>("suspension");
  const [eventDate, setEventDate] = useState("");
  const [description, setDescription] = useState("");
  const [cancellationReason, setCancellationReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pageCount = Math.max(1, Math.ceil(events.length / TABLE_PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1);
  const visibleEvents = events.slice(page * TABLE_PAGE_SIZE, (page + 1) * TABLE_PAGE_SIZE);

  function resetAddForm() {
    setEventType("suspension");
    setEventDate("");
    setDescription("");
    setError("");
  }

  async function createEvent(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/vehicles/${vehicleId}/insurance-events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventType, eventDate, description }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(text.error);
      setEvents((current) => [result.event as VehicleInsuranceEvent, ...current].sort((left, right) =>
        right.event_date.localeCompare(left.event_date) || right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id),
      ));
      if (result.insuranceStatus) setInsuranceStatus(result.insuranceStatus as VehicleInsuranceStatus);
      setPageIndex(0);
      setAddOpen(false);
      resetAddForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.error);
    } finally { setBusy(false); }
  }

  async function cancelEvent(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!cancelTarget) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/insurance-events/${cancelTarget.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel", reason: cancellationReason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(text.error);
      setEvents((current) => current.map((item) => item.id === cancelTarget.id ? result.event as VehicleInsuranceEvent : item));
      if (result.insuranceStatus) setInsuranceStatus(result.insuranceStatus as VehicleInsuranceStatus);
      setCancelTarget(null);
      setCancellationReason("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.error);
    } finally { setBusy(false); }
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
        <div className="min-w-0"><h2 className="text-sm font-semibold">{text.status}</h2><div className="mt-1 flex flex-wrap items-center gap-2"><CurrentInsuranceStatus status={insuranceStatus} locale={locale} /><span className="text-xs text-muted-foreground">{text.history}</span></div><p className="mt-1 text-xs text-muted-foreground">{text.subtitle}</p></div>
        {canManage && <Button onClick={() => setAddOpen(true)}><Plus /> {text.add}</Button>}
      </div>
      {!events.length ? <Empty className="min-h-48 rounded-none border-0 bg-card">
        <EmptyHeader><EmptyMedia variant="icon"><CalendarDays /></EmptyMedia><EmptyTitle>{text.noEvents}</EmptyTitle><EmptyDescription>{text.noEventsHint}</EmptyDescription></EmptyHeader>
      </Empty> : <>
        <div className="hidden md:block"><Table>
          <TableHeader><TableRow><TableHead className="h-12 pl-5 text-muted-foreground">{text.eventType}</TableHead><TableHead className="text-muted-foreground">{text.date}</TableHead><TableHead className="text-muted-foreground">{text.description}</TableHead><TableHead className="text-muted-foreground">{text.state}</TableHead>{canManage && <TableHead className="pr-5 text-right text-muted-foreground">{text.actions}</TableHead>}</TableRow></TableHeader>
          <TableBody>{visibleEvents.map((item) => <TableRow key={item.id}>
            <TableCell className="pl-5 font-medium"><EventType value={item.event_type} locale={locale} /></TableCell>
            <TableCell className="tabular-nums">{dateLabel(item.event_date, locale)}</TableCell>
            <TableCell className="max-w-md"><p className="line-clamp-2">{item.description}</p>{item.status === "cancelled" && item.cancellation_reason && <p className="mt-1 text-xs text-muted-foreground">{text.cancellationReason} {item.cancellation_reason}</p>}</TableCell>
            <TableCell><EventStatus value={item.status} locale={locale} /></TableCell>
            {canManage && <TableCell className="pr-5 text-right">{item.status === "active" && <Button variant="outline" size="sm" onClick={() => { setCancelTarget(item); setError(""); }}>{text.cancel}</Button>}</TableCell>}
          </TableRow>)}</TableBody>
        </Table></div>
        <div className="divide-y md:hidden">{visibleEvents.map((item) => <article key={item.id} className="px-5 py-4">
          <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-medium"><EventType value={item.event_type} locale={locale} /></div><div className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />{dateLabel(item.event_date, locale)}</div></div><EventStatus value={item.status} locale={locale} /></div>
          <p className="mt-3 text-sm">{item.description}</p>
          {item.status === "cancelled" && item.cancellation_reason && <p className="mt-2 text-xs text-muted-foreground">{text.cancellationReason} {item.cancellation_reason}</p>}
          {canManage && item.status === "active" && <Button variant="outline" size="sm" className="mt-3" onClick={() => { setCancelTarget(item); setError(""); }}>{text.cancel}</Button>}
        </article>)}</div>
        <DataTablePagination page={page + 1} total={events.length} noun={text.events} onPageChange={(nextPage) => setPageIndex(nextPage - 1)} />
      </>}

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetAddForm(); }}>
        <DialogContent className="flex max-h-[min(90vh,720px)] max-w-xl flex-col gap-0 overflow-hidden p-0">
          <form onSubmit={createEvent} className="flex min-h-0 flex-col">
            <DialogHeader className="border-b px-5 py-4 sm:px-6"><DialogTitle>{text.addTitle}</DialogTitle><DialogDescription>{text.addHint}</DialogDescription></DialogHeader>
            <div className="grid gap-4 overflow-y-auto px-5 py-5 sm:px-6">
              <div className="grid gap-2"><Label htmlFor={`insurance-event-type-${vehicleId}`}>{text.chooseType}</Label><Select value={eventType} onValueChange={(value) => { if (value && isInsuranceEventType(value)) setEventType(value); }}><SelectTrigger id={`insurance-event-type-${vehicleId}`} className="h-10 w-full"><SelectValue placeholder={text.selectType}>{(value: string) => isInsuranceEventType(value) ? insuranceEventTypeLabel(value, locale) : text.selectType}</SelectValue></SelectTrigger><SelectContent><SelectItem value="insured">{insuranceEventTypeLabel("insured", locale)}</SelectItem><SelectItem value="suspension">{insuranceEventTypeLabel("suspension", locale)}</SelectItem><SelectItem value="unpaid">{insuranceEventTypeLabel("unpaid", locale)}</SelectItem></SelectContent></Select></div>
              <div className="grid gap-2"><Label htmlFor={`insurance-event-date-${vehicleId}`}>{text.eventDate}</Label><Input id={`insurance-event-date-${vehicleId}`} type="date" required value={eventDate} onChange={(event) => setEventDate(event.currentTarget.value)} className="h-10 bg-background" /></div>
              <div className="grid gap-2"><Label htmlFor={`insurance-event-description-${vehicleId}`}>{text.eventDescription}</Label><Textarea id={`insurance-event-description-${vehicleId}`} required maxLength={4000} value={description} onChange={(event) => setDescription(event.currentTarget.value)} placeholder={text.eventPlaceholder} /></div>
              {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter className="px-5 py-4 sm:px-6"><Button type="button" variant="outline" disabled={busy} onClick={() => setAddOpen(false)}>{text.close}</Button><Button type="submit" disabled={busy}>{busy ? text.saving : text.save}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelTarget !== null} onOpenChange={(open) => { if (!open) { setCancelTarget(null); setCancellationReason(""); setError(""); } }}>
        <DialogContent className="max-w-lg">
          <form onSubmit={cancelEvent} className="grid gap-4">
            <DialogHeader><DialogTitle>{text.cancelTitle}</DialogTitle><DialogDescription>{text.cancelHint}</DialogDescription></DialogHeader>
            {cancelTarget && <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm"><span className="font-medium"><EventType value={cancelTarget.event_type} locale={locale} /></span> · {dateLabel(cancelTarget.event_date, locale)}</div>}
            <div className="grid gap-2"><Label htmlFor={`insurance-cancel-reason-${vehicleId}`}>{text.reason}</Label><Textarea id={`insurance-cancel-reason-${vehicleId}`} required maxLength={1000} value={cancellationReason} onChange={(event) => setCancellationReason(event.currentTarget.value)} placeholder={text.reasonPlaceholder} /></div>
            {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
            <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setCancelTarget(null)}>{text.keep}</Button><Button type="submit" variant="destructive" disabled={busy}>{busy ? text.cancelSaving : text.cancel}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
