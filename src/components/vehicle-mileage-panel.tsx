"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Gauge, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type { VehicleMileageReading } from "@/lib/vehicle-mileage";
import { useLocale } from "@/components/locale-provider";

function dateLabel(value: string, locale: "fr" | "en") {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`));
}

function localizeMileageError(message: string, locale: "fr" | "en", fallback: string) {
  if (locale === "en") {
    const englishMessages: Record<string, string> = {
      "Confirmation de kilométrage invalide.": "Mileage confirmation is invalid.",
      "Le kilométrage est inférieur au dernier relevé du véhicule.": "This mileage is below the vehicle’s latest reading.",
    };
    return englishMessages[message] ?? message;
  }
  const translations: Record<string, string> = {
    "Enter a reading date and odometer value.": "Saisissez une date de relevé et une valeur de compteur.",
    "Unexpected reading fields were supplied.": "Des champs de relevé inattendus ont été transmis.",
    "Enter a valid calendar date.": "Saisissez une date de calendrier valide.",
    "Enter a whole kilometre value from 0 to 2,147,483,647.": "Saisissez un nombre entier de kilomètres compris entre 0 et 2 147 483 647.",
    "Enter a text note.": "Saisissez une note textuelle.",
    "Confirmation de kilométrage invalide.": "La confirmation du kilométrage est invalide.",
    "Enter a cancellation reason.": "Saisissez un motif d’annulation.",
    "Unexpected cancellation fields were supplied.": "Des champs d’annulation inattendus ont été transmis.",
    "Enter a reason of 1 to 1,000 characters.": "Saisissez un motif de 1 à 1 000 caractères.",
    "Vehicle not found.": "Véhicule introuvable.",
    "Mileage reading not found.": "Relevé de kilométrage introuvable.",
    "This reading has already been cancelled.": "Ce relevé a déjà été annulé.",
    "Sign in required.": "Connexion requise.",
    "Forbidden.": "Accès interdit.",
    "Invalid JSON.": "La requête est invalide.",
    "Restore this vehicle before adding mileage readings.": "Restaurez ce véhicule avant d’ajouter des relevés de kilométrage.",
    "Restore this vehicle before changing mileage records.": "Restaurez ce véhicule avant de modifier ses relevés de kilométrage.",
    "Could not save this reading.": "Impossible d’enregistrer ce relevé.",
    "Could not cancel this reading.": "Impossible d’annuler ce relevé.",
    "Could not connect. Please try again.": "Connexion impossible. Réessayez.",
    "Le kilométrage est inférieur au dernier relevé du véhicule.": "Le kilométrage est inférieur au dernier relevé du véhicule.",
  };
  if (translations[message]) return translations[message];
  const length = message.match(/^Use (\d+) characters or fewer\.$/);
  if (length) return `Utilisez au plus ${length[1]} caractères.`;
  return fallback;
}

function localizeMileageErrors(errors: Record<string, string>, locale: "fr" | "en") {
  return Object.fromEntries(Object.entries(errors).map(([key, value]) => [key,
    localizeMileageError(value, locale, key === "form" ? "Vérifiez les informations du relevé et réessayez." : "Vérifiez cette information et réessayez."),
  ]));
}

function readingOrder(a: VehicleMileageReading, b: VehicleMileageReading) {
  return b.reading_date.localeCompare(a.reading_date)
    || b.created_at.localeCompare(a.created_at)
    || b.id.localeCompare(a.id);
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function VehicleMileagePanel({ vehicleId, canManage, initialReadings }: {
  vehicleId: string;
  canManage: boolean;
  initialReadings: VehicleMileageReading[];
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const french = locale === "fr";
  const formatNumber = (value: number) => new Intl.NumberFormat(french ? "fr-FR" : "en-GB").format(value);
  const text = french ? {
    currentMileage: "Kilométrage actuel", noReading: "Aucun relevé", latestValid: "Dernier relevé valide le", setCurrent: "Ajoutez un relevé daté pour définir le kilométrage actuel.",
    addReading: "Ajouter un relevé", history: "Historique du kilométrage", historyDescription: "Relevés datés du compteur de ce véhicule", showCancelled: "Afficher les relevés annulés",
    noValid: "Aucun relevé valide", noMileage: "Aucun kilométrage enregistré", hiddenDescription: "Les relevés annulés sont masqués. Affichez-les pour consulter l’historique.",
    emptyDescription: "Un relevé daté du compteur apparaîtra ici après son enregistrement.", date: "Date", odometer: "Compteur (km)", note: "Note", status: "Statut", action: "Action",
    valid: "Valide", cancelled: "Annulé", reason: "Motif", noNote: "Aucune note", cancellationReason: "Motif de l’annulation", cancelReading: "Annuler le relevé",
    addTitle: "Ajouter un relevé de kilométrage", addDescription: "Enregistrez la valeur du compteur et la date du relevé.", readingDate: "Date du relevé", optionalNote: "Note (facultative)",
    routineCheck: "Contrôle de routine", cancel: "Annuler", saving: "Enregistrement…", saveReading: "Enregistrer le relevé", cancelTitle: "Annuler le relevé de kilométrage",
    cancelDescription: "Le relevé reste dans l’historique. Indiquez un motif pour expliquer la correction.", cancelReasonLabel: "Motif de l’annulation", keepReading: "Conserver le relevé", confirmCancel: "Confirmer l’annulation",
    dateRequired: "Saisissez une date de relevé valide.", mileageRequired: "Saisissez un nombre entier de kilomètres compris entre 0 et 2 147 483 647.",
    reasonRequired: "Saisissez un motif d’annulation.", reasonLength: "Le motif doit contenir de 1 à 1 000 caractères.", noteLength: "Utilisez au plus 500 caractères.",
  } : {
    currentMileage: "Current mileage", noReading: "No reading", latestValid: "Latest valid reading on", setCurrent: "Add a dated odometer reading to set the current mileage.",
    addReading: "Add reading", history: "Mileage history", historyDescription: "Dated odometer readings for this vehicle", showCancelled: "Show cancelled readings",
    noValid: "No valid readings", noMileage: "No mileage recorded", hiddenDescription: "Cancelled readings are hidden. Show cancelled readings to review the history.",
    emptyDescription: "A dated odometer reading will appear here after it is recorded.", date: "Date", odometer: "Odometer (km)", note: "Note", status: "Status", action: "Action",
    valid: "Valid", cancelled: "Cancelled", reason: "Reason", noNote: "No note", cancellationReason: "Cancellation reason", cancelReading: "Cancel reading",
    addTitle: "Add mileage reading", addDescription: "Record the odometer value and the date it was observed.", readingDate: "Reading date", optionalNote: "Note (optional)",
    routineCheck: "Routine check", cancel: "Cancel", saving: "Saving…", saveReading: "Save reading", cancelTitle: "Cancel mileage reading",
    cancelDescription: "The reading remains in the history. Give a reason so the corrected record is clear.", cancelReasonLabel: "Cancellation reason", keepReading: "Keep reading", confirmCancel: "Confirm cancellation",
    dateRequired: "Enter a valid reading date.", mileageRequired: "Enter a whole kilometre value from 0 to 2,147,483,647.",
    reasonRequired: "Enter a cancellation reason.", reasonLength: "Enter a reason of 1 to 1,000 characters.", noteLength: "Use 500 characters or fewer.",
  };
  const [readings, setReadings] = useState(initialReadings);
  const [showCancelled, setShowCancelled] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [cancelReading, setCancelReading] = useState<VehicleMileageReading | null>(null);
  const [readingDate, setReadingDate] = useState(localToday);
  const [mileage, setMileage] = useState("");
  const [note, setNote] = useState("");
  const [cancellationReason, setCancellationReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const latestValidReading = readings.filter((reading) => reading.status === "valid").sort(readingOrder)[0] ?? null;
  const currentMileage = latestValidReading?.mileage ?? null;
  const visibleReadings = readings.filter((reading) => showCancelled || reading.status === "valid");
  const pageCount = Math.max(1, Math.ceil(visibleReadings.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const pageReadings = visibleReadings.slice(currentPage * TABLE_PAGE_SIZE, (currentPage + 1) * TABLE_PAGE_SIZE);

  async function submitReading(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedDate = new Date(`${readingDate}T00:00:00.000Z`);
    const parsedMileage = Number(mileage);
    const validation: Record<string, string> = {};
    if (!readingDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== readingDate) validation.readingDate = text.dateRequired;
    if (!mileage.trim() || !Number.isSafeInteger(parsedMileage) || parsedMileage < 0 || parsedMileage > 2_147_483_647) validation.mileage = text.mileageRequired;
    if (note.trim().length > 500) validation.note = text.noteLength;
    if (Object.keys(validation).length) { setErrors(validation); return; }
    setSaving(true);
    setErrors({});
    try {
      const response = await fetch(`/api/vehicles/${vehicleId}/mileage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ readingDate, mileage, note }),
      });
      const result = await response.json();
      if (!response.ok) {
        setErrors(result.errors ? localizeMileageErrors(result.errors, locale) : { form: localizeMileageError(result.error ?? "Could not save this reading.", locale, "Impossible d’enregistrer ce relevé.") });
        return;
      }
      setReadings((current) => [...current, result.reading as VehicleMileageReading].sort(readingOrder));
      setPageIndex(0);
      setShowCancelled(false);
      setMileage("");
      setNote("");
      setReadingDate(localToday());
      setAddOpen(false);
      router.refresh();
    } catch {
      setErrors({ form: localizeMileageError("Could not connect. Please try again.", locale, "Connexion impossible. Réessayez.") });
    } finally {
      setSaving(false);
    }
  }

  async function submitCancellation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cancelReading) return;
    const reason = cancellationReason.trim();
    if (!reason || reason.length > 1000) { setErrors({ cancellationReason: reason ? text.reasonLength : text.reasonRequired }); return; }
    setSaving(true);
    setErrors({});
    try {
      const response = await fetch(`/api/vehicles/${vehicleId}/mileage/${cancelReading.id}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancellationReason }),
      });
      const result = await response.json();
      if (!response.ok) {
        setErrors(result.errors ? localizeMileageErrors(result.errors, locale) : { form: localizeMileageError(result.error ?? "Could not cancel this reading.", locale, "Impossible d’annuler ce relevé.") });
        return;
      }
      setReadings((current) => current.map((reading) => reading.id === cancelReading.id ? result.reading as VehicleMileageReading : reading).sort(readingOrder));
      setShowCancelled(true);
      setCancellationReason("");
      setCancelReading(null);
      router.refresh();
    } catch {
      setErrors({ form: localizeMileageError("Could not connect. Please try again.", locale, "Connexion impossible. Réessayez.") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5" aria-labelledby="vehicle-mileage-title">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Gauge aria-hidden="true" className="size-5" /></div>
            <div>
              <h2 id="vehicle-mileage-title" className="text-sm font-medium text-muted-foreground">{text.currentMileage}</h2>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground" data-testid="current-mileage">
                {currentMileage === null ? text.noReading : `${formatNumber(currentMileage)} km`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {latestValidReading
                  ? `${text.latestValid} ${dateLabel(latestValidReading.reading_date, locale)}`
                  : text.setCurrent}
              </p>
            </div>
          </div>
          {canManage && <Button onClick={() => setAddOpen(true)} className="h-9 gap-2"><Plus className="size-4" /> {text.addReading}</Button>}
        </CardContent>
      </Card>

      <section className="overflow-hidden rounded-xl border bg-card shadow-sm" aria-labelledby="mileage-history-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
          <div><h2 id="mileage-history-heading" className="text-sm font-semibold">{text.history}</h2><p className="mt-0.5 text-xs text-muted-foreground">{text.historyDescription}</p></div>
          {readings.some((reading) => reading.status === "cancelled") && (
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={showCancelled} onChange={(event) => { setShowCancelled(event.target.checked); setPageIndex(0); }} className="size-4 accent-primary" />
              {text.showCancelled}
            </label>
          )}
        </div>
        {pageReadings.length === 0 ? (
          <Empty className="min-h-48 rounded-none border-0 bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Gauge /></EmptyMedia>
              <EmptyTitle>{readings.length ? text.noValid : text.noMileage}</EmptyTitle>
              <EmptyDescription>{readings.length ? text.hiddenDescription : text.emptyDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="hidden md:block"><Table>
              <TableHeader><TableRow>
                <TableHead className="h-12 pl-5 text-muted-foreground">{text.date}</TableHead>
                <TableHead className="text-muted-foreground">{text.odometer}</TableHead>
                <TableHead className="text-muted-foreground">{text.note}</TableHead>
                <TableHead className="text-muted-foreground">{text.status}</TableHead>
                <TableHead className="pr-5 text-right text-muted-foreground">{text.action}</TableHead>
              </TableRow></TableHeader>
              <TableBody>{pageReadings.map((reading) => (
                <TableRow key={reading.id} data-testid={`mileage-reading-${reading.id}`}>
                  <TableCell className="pl-5 tabular-nums"><span className="inline-flex items-center gap-2"><CalendarDays className="size-4 text-muted-foreground" />{dateLabel(reading.reading_date, locale)}</span></TableCell>
                  <TableCell className="font-medium tabular-nums">{formatNumber(reading.mileage)}</TableCell>
                  <TableCell className="max-w-sm whitespace-normal text-muted-foreground">
                    <span>{reading.note ?? "—"}</span>
                    {reading.status === "cancelled" && <p className="mt-1 text-xs text-destructive">{text.reason}: {reading.cancellation_reason}</p>}
                  </TableCell>
                  <TableCell><Badge variant="outline" className={reading.status === "valid" ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground"}>{reading.status === "valid" ? text.valid : text.cancelled}</Badge></TableCell>
                  <TableCell className="pr-5 text-right">
                    {canManage && reading.status === "valid" && <Button variant="ghost" size="sm" onClick={() => { setErrors({}); setCancellationReason(""); setCancelReading(reading); }}>{text.cancelReading}</Button>}
                  </TableCell>
                </TableRow>
              ) )}</TableBody>
            </Table></div>
            <ul className="divide-y md:hidden">{pageReadings.map((reading) => (
              <li key={reading.id} className="space-y-2 px-5 py-4" data-testid={`mileage-reading-${reading.id}`}>
                <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium tabular-nums">{dateLabel(reading.reading_date, locale)}</p><p className="mt-1 text-base font-semibold tabular-nums">{formatNumber(reading.mileage)} km</p></div><Badge variant="outline" className={reading.status === "valid" ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground"}>{reading.status === "valid" ? text.valid : text.cancelled}</Badge></div>
                <p className="text-sm text-muted-foreground">{reading.note ?? text.noNote}</p>
                {reading.status === "cancelled" && <p className="text-sm text-muted-foreground">{text.cancellationReason}: {reading.cancellation_reason}</p>}
                {canManage && reading.status === "valid" && <Button variant="outline" size="sm" onClick={() => { setErrors({}); setCancellationReason(""); setCancelReading(reading); }}>{text.cancelReading}</Button>}
              </li>
            ))}</ul>
            <DataTablePagination page={currentPage + 1} total={visibleReadings.length} noun="readings" onPageChange={(nextPage) => setPageIndex(nextPage - 1)} />
          </>
        )}
      </section>

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setErrors({}); }}>
        <DialogContent className="max-h-[min(88dvh,680px)] overflow-y-auto sm:max-w-[520px]">
          <DialogHeader><DialogTitle>{text.addTitle}</DialogTitle><DialogDescription>{text.addDescription}</DialogDescription></DialogHeader>
          <form onSubmit={(event) => void submitReading(event)} noValidate className="grid gap-5">
            <div className="grid gap-2"><Label htmlFor={`mileage-date-${vehicleId}`}>{text.readingDate} *</Label><Input id={`mileage-date-${vehicleId}`} type="date" required value={readingDate} onChange={(event) => setReadingDate(event.target.value)} aria-invalid={Boolean(errors.readingDate)} />{errors.readingDate && <p className="text-xs text-destructive" role="alert">{errors.readingDate}</p>}</div>
            <div className="grid gap-2"><Label htmlFor={`mileage-value-${vehicleId}`}>{text.odometer} *</Label><Input id={`mileage-value-${vehicleId}`} type="number" required min="0" max="2147483647" step="1" value={mileage} onChange={(event) => setMileage(event.target.value)} placeholder="48260" aria-invalid={Boolean(errors.mileage)} />{errors.mileage && <p className="text-xs text-destructive" role="alert">{errors.mileage}</p>}</div>
            <div className="grid gap-2"><Label htmlFor={`mileage-note-${vehicleId}`}>{text.optionalNote}</Label><Textarea id={`mileage-note-${vehicleId}`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} placeholder={text.routineCheck} aria-invalid={Boolean(errors.note)} />{errors.note && <p className="text-xs text-destructive" role="alert">{errors.note}</p>}</div>
            {errors.form && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{errors.form}</p>}
            <DialogFooter><DialogClose render={<Button type="button" variant="outline" disabled={saving}>{text.cancel}</Button>} /><Button type="submit" disabled={saving}>{saving ? text.saving : text.saveReading}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cancelReading)} onOpenChange={(open) => { if (!open && !saving) { setCancelReading(null); setErrors({}); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader><DialogTitle>{text.cancelTitle}</DialogTitle><DialogDescription>{text.cancelDescription}</DialogDescription></DialogHeader>
          {cancelReading && <form onSubmit={(event) => void submitCancellation(event)} noValidate className="grid gap-5">
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm"><span className="font-medium">{dateLabel(cancelReading.reading_date, locale)} · {formatNumber(cancelReading.mileage)} km</span></div>
            <div className="grid gap-2"><Label htmlFor={`mileage-cancel-reason-${vehicleId}`}>{text.cancelReasonLabel} *</Label><Textarea id={`mileage-cancel-reason-${vehicleId}`} required value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} maxLength={1000} rows={4} aria-invalid={Boolean(errors.cancellationReason)} />{errors.cancellationReason && <p className="text-xs text-destructive" role="alert">{errors.cancellationReason}</p>}</div>
            {errors.form && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{errors.form}</p>}
            <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => setCancelReading(null)}>{text.keepReading}</Button><Button type="submit" variant="destructive" disabled={saving}>{saving ? text.saving : text.confirmCancel}</Button></DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
