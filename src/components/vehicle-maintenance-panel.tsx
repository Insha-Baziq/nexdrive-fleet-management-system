"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Plus, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/locale-provider";
import { localizeClientError } from "@/lib/client-error-message";
import { maintenanceInvoiceCopy } from "@/lib/client-feedback-copy";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";

type Intervention = {
  id: string;
  vehicle_id: string;
  intervention_date: string;
  location_type: "internal" | "external";
  garage_name: string | null;
  work_performed: string;
  parts_used: string | null;
  status: "active" | "cancelled";
  cancellation_reason: string | null;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  created_at: string;
  created_by_name: string;
  invoice: { id: string; file_name: string; file_extension: string; file_size: string; created_at: string } | null;
};

type Location = "internal" | "external";
const maxInvoiceBytes = 15 * 1024 * 1024;
const copy = {
  fr: {
    noInvoice: "Aucune facture", open: "Ouvrir", download: "Télécharger", title: "Interventions d’entretien", subtitle: "Travaux en cours et historique complet du véhicule",
    add: "Ajouter une intervention", retry: "Réessayer", loading: "Chargement de l’historique d’entretien…", unavailable: "L’historique d’entretien est indisponible. Réessayez.",
    emptyTitle: "Aucune intervention enregistrée", emptyDescription: "Les interventions d’entretien de ce véhicule apparaîtront ici.", addFirst: "Ajouter la première intervention",
    date: "Date", location: "Lieu", work: "Travaux effectués", parts: "Pièces utilisées ou commandées", invoice: "Facture", status: "Statut", action: "Action",
    addedBy: "Ajoutée par", active: "En cours", cancelled: "Annulée", cancel: "Annuler", cancelIntervention: "Annuler l’intervention", cancelReason: "Motif d’annulation",
    addTitle: "Ajouter une intervention", addDescription: "Consignez les travaux effectués sur ce véhicule. Les factures sont stockées de façon privée.",
    externalGarage: "Nom du garage externe", garagePlaceholder: "Nom du garage ou de l’atelier", workPlaceholder: "Décrivez les travaux effectués",
    partsPlaceholder: "Indiquez les pièces utilisées ou commandées", optional: "(facultatif)", privateInvoice: "Facture privée",
    cancelDescription: "L’intervention et sa facture resteront dans l’historique du véhicule. Indiquez le motif de l’annulation.",
    cancelPlaceholder: "Expliquez pourquoi cette intervention est annulée", back: "Retour", saveCancellation: "Enregistrer l’annulation", save: "Enregistrer…", saveIntervention: "Enregistrer l’intervention",
    invalidFields: "Saisissez la date, les travaux effectués et, le cas échéant, le nom du garage externe.", invalidInvoice: "Choisissez un fichier de facture valide de 15 Mo maximum.",
    requiredCancel: "Saisissez le motif de l’annulation.", noun: "intervention",
  },
  en: {
    noInvoice: "No invoice", open: "Open", download: "Download", title: "Maintenance interventions", subtitle: "Active work and the full vehicle history",
    add: "Add intervention", retry: "Retry", loading: "Loading maintenance history…", unavailable: "Maintenance history is unavailable. Use Retry to try again.",
    emptyTitle: "No interventions recorded", emptyDescription: "Maintenance work recorded for this vehicle will appear here.", addFirst: "Add first intervention",
    date: "Date", location: "Location", work: "Work performed", parts: "Parts used or ordered", invoice: "Invoice", status: "Status", action: "Action",
    addedBy: "Added by", active: "Active", cancelled: "Cancelled", cancel: "Cancel", cancelIntervention: "Cancel intervention", cancelReason: "Cancellation reason",
    addTitle: "Add intervention", addDescription: "Record work completed for this vehicle. Invoices are stored privately.",
    externalGarage: "External garage name", garagePlaceholder: "Name of garage or workshop", workPlaceholder: "Describe the work performed",
    partsPlaceholder: "List any parts used or ordered", optional: "(optional)", privateInvoice: "Private invoice",
    cancelDescription: "The intervention and invoice will remain in the vehicle history. Record why it was cancelled.",
    cancelPlaceholder: "Explain why this record is being cancelled", back: "Back", saveCancellation: "Save cancellation", save: "Saving…", saveIntervention: "Save intervention",
    invalidFields: "Enter the date, work performed, and external garage name when applicable.", invalidInvoice: "Choose one valid invoice file up to 15 MB.",
    requiredCancel: "Enter a reason for cancelling this intervention.", noun: "intervention",
  },
} as const;

function todayLocal() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function sortHistory(items: Intervention[]) {
  return [...items].sort((left, right) => right.intervention_date.localeCompare(left.intervention_date) || right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
}

function dateLabel(value: string, locale: "fr" | "en") {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function sizeLabel(value: string) {
  const bytes = Number(value);
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 1024 * 1024 ? 1 : 2)} MB`;
}

function LocationBadge({ item, locale }: { item: Intervention; locale: "fr" | "en" }) {
  const location = item.location_type === "internal"
    ? locale === "fr" ? "Interne" : "Internal"
    : locale === "fr" ? "Externe" : "External";
  return <div className="space-y-1"><Badge variant="outline" className="font-normal">{location}</Badge>{item.garage_name && <p className="max-w-48 text-xs text-muted-foreground">{item.garage_name}</p>}</div>;
}

function InvoiceLinks({ vehicleId, item, locale }: { vehicleId: string; item: Intervention; locale: "fr" | "en" }) {
  const text = copy[locale];
  if (!item.invoice) return <span className="text-xs text-muted-foreground">{text.noInvoice}</span>;
  const href = `/api/vehicles/${vehicleId}/maintenance/${item.id}/invoice/content`;
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
    <a className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline" href={href} target="_blank" rel="noreferrer" aria-label={`${text.open} ${item.invoice.file_name}`}><FileText className="size-3.5" /> {text.open}</a>
    <a className="text-muted-foreground underline-offset-4 hover:underline" href={`${href}?download=1`} aria-label={`${text.download} ${item.invoice.file_name}`}>{text.download}</a>
    <span className="text-muted-foreground">{item.invoice.file_extension.toUpperCase()} · {sizeLabel(item.invoice.file_size)}</span>
  </div>;
}

export function VehicleMaintenancePanel({ vehicleId, canManage }: { vehicleId: string; canManage: boolean }) {
  const { locale } = useLocale();
  const text = copy[locale];
  const invoiceText = maintenanceInvoiceCopy[locale];
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Intervention | null>(null);
  const [date, setDate] = useState(todayLocal);
  const [location, setLocation] = useState<Location>("internal");
  const [garageName, setGarageName] = useState("");
  const [workPerformed, setWorkPerformed] = useState("");
  const [partsUsed, setPartsUsed] = useState("");
  const [invoice, setInvoice] = useState<File | null>(null);
  const invoiceInput = useRef<HTMLInputElement>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [page, setPage] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/vehicles/${vehicleId}/maintenance`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(localizeClientError(result.error, locale, { fr: "Impossible de charger l’historique d’entretien. Réessayez.", en: "Could not load maintenance history. Please try again." }));
      setInterventions(result.interventions as Intervention[]);
      setPage(0);
      setListError("");
    } catch (cause) {
      setListError(localizeClientError(cause instanceof Error ? cause.message : undefined, locale, { fr: "Impossible de charger l’historique d’entretien. Réessayez.", en: "Could not load maintenance history. Please try again." }));
    } finally {
      setLoading(false);
    }
  }, [vehicleId, locale]);
  useEffect(() => {
    let active = true;
    void fetch(`/api/vehicles/${vehicleId}/maintenance`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(localizeClientError(result.error, locale, { fr: "Impossible de charger l’historique d’entretien. Réessayez.", en: "Could not load maintenance history. Please try again." }));
        if (active) setInterventions(result.interventions as Intervention[]);
      })
      .catch((cause: unknown) => { if (active) setListError(localizeClientError(cause instanceof Error ? cause.message : undefined, locale, { fr: "Impossible de charger l’historique d’entretien. Réessayez.", en: "Could not load maintenance history. Please try again." })); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [vehicleId, locale]);

  const pageCount = Math.max(1, Math.ceil(interventions.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = useMemo(() => interventions.slice(currentPage * TABLE_PAGE_SIZE, (currentPage + 1) * TABLE_PAGE_SIZE), [currentPage, interventions]);

  function resetNewForm() {
    setDate(todayLocal());
    setLocation("internal");
    setGarageName("");
    setWorkPerformed("");
    setPartsUsed("");
    setInvoice(null);
    if (invoiceInput.current) invoiceInput.current.value = "";
    setDialogError("");
  }

  async function saveIntervention(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date || !workPerformed.trim() || (location === "external" && !garageName.trim())) {
      setDialogError(text.invalidFields);
      return;
    }
    if (invoice && (invoice.size < 1 || invoice.size > maxInvoiceBytes)) {
      setDialogError(text.invalidInvoice);
      return;
    }
    setBusy(true);
    setDialogError("");
    try {
      const form = new FormData();
      form.set("interventionDate", date);
      form.set("locationType", location);
      form.set("garageName", location === "external" ? garageName : "");
      form.set("workPerformed", workPerformed);
      form.set("partsUsed", partsUsed);
      if (invoice) form.set("invoice", invoice);
      const response = await fetch(`/api/vehicles/${vehicleId}/maintenance`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(localizeClientError(result.error, locale, { fr: "Impossible d’enregistrer l’intervention. Vérifiez les informations et réessayez.", en: "Could not save the intervention. Check the details and try again." }));
      setInterventions((current) => sortHistory([...current, result.intervention as Intervention]));
      setListError("");
      setPage(0);
      setDialogOpen(false);
      resetNewForm();
    } catch (cause) { setDialogError(localizeClientError(cause instanceof Error ? cause.message : undefined, locale, { fr: "Impossible d’enregistrer l’intervention. Vérifiez les informations et réessayez.", en: "Could not save the intervention. Check the details and try again." })); }
    finally { setBusy(false); }
  }

  async function cancelIntervention(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cancelTarget || !cancelReason.trim()) { setDialogError(text.requiredCancel); return; }
    setBusy(true);
    setDialogError("");
    try {
      const response = await fetch(`/api/vehicles/${vehicleId}/maintenance/${cancelTarget.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel", reason: cancelReason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(localizeClientError(result.error, locale, { fr: "Impossible d’annuler l’intervention. Vérifiez les informations et réessayez.", en: "Could not cancel the intervention. Check the details and try again." }));
      setInterventions((current) => current.map((item) => item.id === cancelTarget.id ? result.intervention as Intervention : item));
      setListError("");
      setCancelTarget(null);
      setCancelReason("");
    } catch (cause) { setDialogError(localizeClientError(cause instanceof Error ? cause.message : undefined, locale, { fr: "Impossible d’annuler l’intervention. Vérifiez les informations et réessayez.", en: "Could not cancel the intervention. Check the details and try again." })); }
    finally { setBusy(false); }
  }

  return <section className="overflow-hidden rounded-xl border bg-card shadow-sm" aria-labelledby="vehicle-maintenance-title">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Wrench className="size-[18px]" /></div>
        <div><h2 id="vehicle-maintenance-title" className="text-sm font-semibold">{text.title}</h2><p className="mt-0.5 text-xs text-muted-foreground">{text.subtitle}</p></div>
      </div>
      {canManage && <Button onClick={() => { resetNewForm(); setDialogOpen(true); }}><Plus className="size-4" /> {text.add}</Button>}
    </div>

    {listError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b bg-destructive/5 px-6 py-3 text-sm text-destructive"><p>{listError}</p><Button size="sm" variant="outline" onClick={() => { void refresh(); }}>{text.retry}</Button></div>}
    {loading ? <div role="status" className="px-6 py-12 text-center text-sm text-muted-foreground">{text.loading}</div>
      : listError ? <div className="px-6 py-12 text-center text-sm text-muted-foreground">{text.unavailable}</div>
      : interventions.length === 0 ? <Empty className="min-h-48 rounded-none border-0 bg-card">
        <EmptyHeader><EmptyMedia variant="icon"><Wrench /></EmptyMedia><EmptyTitle>{text.emptyTitle}</EmptyTitle><EmptyDescription>{text.emptyDescription}</EmptyDescription></EmptyHeader>
        {canManage && <Button onClick={() => { resetNewForm(); setDialogOpen(true); }}><Plus className="size-4" /> {text.addFirst}</Button>}
      </Empty> : <>
        <div className="hidden lg:block"><Table>
          <TableHeader><TableRow className="bg-muted/30 hover:bg-muted/30"><TableHead className="pl-6">{text.date}</TableHead><TableHead>{text.location}</TableHead><TableHead>{text.work}</TableHead><TableHead>{text.parts}</TableHead><TableHead>{text.invoice}</TableHead><TableHead>{text.status}</TableHead><TableHead className="pr-6 text-right">{text.action}</TableHead></TableRow></TableHeader>
          <TableBody>{visible.map((item) => <TableRow key={item.id}>
            <TableCell className="whitespace-nowrap pl-6"><div>{dateLabel(item.intervention_date, locale)}</div><div className="mt-1 text-xs text-muted-foreground">{text.addedBy} {item.created_by_name}</div></TableCell>
            <TableCell><LocationBadge item={item} locale={locale} /></TableCell>
            <TableCell className="max-w-64 whitespace-normal">{item.work_performed}</TableCell>
            <TableCell className="max-w-56 whitespace-normal text-muted-foreground">{item.parts_used || "—"}</TableCell>
            <TableCell><InvoiceLinks vehicleId={vehicleId} item={item} locale={locale} /></TableCell>
            <TableCell><div className="space-y-1"><Badge variant="outline" className={item.status === "active" ? "border-primary/20 bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}>{item.status === "active" ? text.active : text.cancelled}</Badge>{item.cancellation_reason && <p className="max-w-52 text-xs text-muted-foreground">{item.cancellation_reason}</p>}</div></TableCell>
            <TableCell className="pr-6 text-right">{canManage && item.status === "active" ? <Button type="button" size="sm" variant="outline" onClick={() => { setDialogError(""); setCancelTarget(item); }}>{text.cancel}</Button> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
          </TableRow>)}</TableBody>
        </Table></div>
        <div className="divide-y lg:hidden">{visible.map((item) => <article key={item.id} className="space-y-3 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{dateLabel(item.intervention_date, locale)}</p><p className="mt-1 text-xs text-muted-foreground">{text.addedBy} {item.created_by_name}</p></div><Badge variant="outline" className={item.status === "active" ? "border-primary/20 bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}>{item.status === "active" ? text.active : text.cancelled}</Badge></div>
          <LocationBadge item={item} locale={locale} />
          <div><p className="text-xs font-medium text-muted-foreground">{text.work}</p><p className="mt-1 whitespace-pre-wrap text-sm">{item.work_performed}</p></div>
          <div><p className="text-xs font-medium text-muted-foreground">{text.parts}</p><p className="mt-1 whitespace-pre-wrap text-sm">{item.parts_used || "—"}</p></div>
          <InvoiceLinks vehicleId={vehicleId} item={item} locale={locale} />
          {item.cancellation_reason && <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground"><span className="font-medium">{text.cancelReason}:</span> {item.cancellation_reason}</p>}
          {canManage && item.status === "active" && <Button size="sm" variant="outline" onClick={() => { setDialogError(""); setCancelTarget(item); }}>{text.cancelIntervention}</Button>}
        </article>)}</div>
        <DataTablePagination page={currentPage + 1} total={interventions.length} noun={text.noun} onPageChange={(nextPage) => setPage(nextPage - 1)} />
      </>}

    <Dialog open={dialogOpen} onOpenChange={(open) => { if (!busy) { setDialogOpen(open); if (!open) resetNewForm(); } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={saveIntervention} className="grid gap-4">
          <DialogHeader><DialogTitle>{text.addTitle}</DialogTitle><DialogDescription>{text.addDescription}</DialogDescription></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2"><Label htmlFor="maintenance-date">{text.date} *</Label><Input id="maintenance-date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></div>
            <div className="grid gap-2"><Label htmlFor="maintenance-location">{text.location} *</Label><Select value={location} onValueChange={(value) => { if (value === "internal" || value === "external") setLocation(value); }}><SelectTrigger id="maintenance-location" aria-label={text.location} className="w-full"><SelectValue>{(value: string) => value === "internal" ? locale === "fr" ? "Interne" : "Internal" : value === "external" ? locale === "fr" ? "Externe" : "External" : text.location}</SelectValue></SelectTrigger><SelectContent><SelectItem value="internal">{locale === "fr" ? "Interne" : "Internal"}</SelectItem><SelectItem value="external">{locale === "fr" ? "Externe" : "External"}</SelectItem></SelectContent></Select></div>
          </div>
          {location === "external" && <div className="grid gap-2"><Label htmlFor="maintenance-garage">{text.externalGarage} *</Label><Input id="maintenance-garage" required maxLength={180} value={garageName} onChange={(event) => setGarageName(event.target.value)} placeholder={text.garagePlaceholder} /></div>}
          <div className="grid gap-2"><Label htmlFor="maintenance-work">{text.work} *</Label><Textarea id="maintenance-work" required maxLength={4000} value={workPerformed} onChange={(event) => setWorkPerformed(event.target.value)} placeholder={text.workPlaceholder} /></div>
          <div className="grid gap-2"><Label htmlFor="maintenance-parts">{text.parts} <span className="font-normal text-muted-foreground">{text.optional}</span></Label><Textarea id="maintenance-parts" maxLength={4000} value={partsUsed} onChange={(event) => setPartsUsed(event.target.value)} placeholder={text.partsPlaceholder} /></div>
          <div className="grid min-w-0 gap-2"><Label htmlFor="maintenance-invoice">{text.privateInvoice} <span className="font-normal text-muted-foreground">{text.optional}</span></Label><Input ref={invoiceInput} id="maintenance-invoice" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" className="sr-only w-px" tabIndex={-1} onChange={(event) => setInvoice(event.currentTarget.files?.[0] ?? null)} /><div className="flex min-w-0 flex-wrap items-center gap-3"><Button type="button" variant="outline" aria-label={invoiceText.chooseFile} onClick={() => invoiceInput.current?.click()}>{invoiceText.chooseFile}</Button><span className="min-w-0 max-w-full truncate text-sm text-muted-foreground">{invoice?.name ?? invoiceText.noFile}</span></div><p className="text-xs text-muted-foreground">{invoiceText.fileHelp}</p></div>
          {dialogError && !cancelTarget && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{dialogError}</p>}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => { setDialogOpen(false); resetNewForm(); }}>{text.cancel}</Button><Button type="submit" disabled={busy || !date || !workPerformed.trim() || (location === "external" && !garageName.trim())}>{busy ? text.save : text.saveIntervention}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={cancelTarget !== null} onOpenChange={(open) => { if (!open && !busy) { setCancelTarget(null); setCancelReason(""); setDialogError(""); } }}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={cancelIntervention} className="grid gap-4">
          <DialogHeader><DialogTitle>{text.cancelIntervention}</DialogTitle><DialogDescription>{text.cancelDescription}</DialogDescription></DialogHeader>
          <div className="grid gap-2"><Label htmlFor="maintenance-cancel-reason">{text.cancelReason} *</Label><Textarea id="maintenance-cancel-reason" autoFocus required maxLength={1000} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder={text.cancelPlaceholder} /></div>
          {dialogError && cancelTarget && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{dialogError}</p>}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => { setCancelTarget(null); setCancelReason(""); setDialogError(""); }}>{text.back}</Button><Button type="submit" variant="destructive" disabled={busy || !cancelReason.trim()}>{busy ? text.save : text.saveCancellation}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}






