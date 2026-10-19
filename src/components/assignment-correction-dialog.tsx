"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AssignmentJournalEntry } from "@/lib/assignments";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/locale-provider";
import { localizeClientError } from "@/lib/client-error-message";

const copy = {
  fr: {
    title: "Corriger l’affectation", description: "Enregistrez la période corrigée pour le véhicule {vehicle}. Les valeurs précédentes resteront dans le journal.",
    start: "Date et heure de début", end: "Date et heure de fin", ended: "Cette affectation est terminée.", active: "Cette affectation est en cours ; sa date de fin reste ouverte.",
    reason: "Motif de la correction", placeholder: "Expliquez pourquoi les dates doivent être corrigées.", cancel: "Annuler", saving: "Enregistrement…", save: "Enregistrer la correction",
    invalidDates: "Saisissez des dates et heures de début et de fin valides.", error: "Impossible de corriger l’affectation. Vérifiez les informations et réessayez.", connection: "Connexion impossible. Réessayez.",
  },
  en: {
    title: "Correct assignment", description: "Record the corrected interval for {vehicle} and keep the earlier values in its journal.",
    start: "Start date and time", end: "End date and time", ended: "This assignment has ended.", active: "This assignment is active; its end remains open.",
    reason: "Reason for correction", placeholder: "Explain why the dates need correction", cancel: "Cancel", saving: "Saving…", save: "Save correction",
    invalidDates: "Enter valid start and end date and times.", error: "The assignment could not be corrected. Check the details and try again.", connection: "The assignment could not be corrected. Check your connection and try again.",
  },
} as const;

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function AssignmentCorrectionDialog({
  assignment,
  open,
  onOpenChange,
}: {
  assignment: AssignmentJournalEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const text = copy[locale];
  const [startedAt, setStartedAt] = useState(() => localDateTime(assignment.started_at));
  const [endedAt, setEndedAt] = useState(() => localDateTime(assignment.ended_at));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const startTime = new Date(startedAt).getTime();
      const endTime = endedAt ? new Date(endedAt).getTime() : null;
      if (!Number.isFinite(startTime) || (endedAt && !Number.isFinite(endTime))) {
        setError(text.invalidDates);
        return;
      }
      const response = await fetch(`/api/assignments/history/${assignment.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startedAt: new Date(startTime).toISOString(),
          endedAt: endTime === null ? null : new Date(endTime).toISOString(),
          reason,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(localizeClientError(data.error ?? Object.values(data.errors ?? {}).find((value): value is string => typeof value === "string"), locale, { fr: copy.fr.error, en: copy.en.error }));
        return;
      }
      onOpenChange(false);
      router.refresh();
    } catch {
      setError(text.connection);
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[min(90vh,760px)] max-w-xl flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="border-b px-5 py-4">
        <DialogTitle>{text.title}</DialogTitle>
        <DialogDescription>{text.description.replace("{vehicle}", assignment.vehicle_registration)}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="grid gap-4 overflow-y-auto px-5 py-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="assignment-correction-start">{text.start}</Label>
            <Input id="assignment-correction-start" type="datetime-local" required value={startedAt} onChange={(event) => setStartedAt(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assignment-correction-end">{text.end}</Label>
            <Input id="assignment-correction-end" type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} disabled={!assignment.ended_at} />
            <p className="text-xs text-muted-foreground">{assignment.ended_at ? text.ended : text.active}</p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="assignment-correction-reason">{text.reason}</Label>
            <Textarea id="assignment-correction-reason" required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={text.placeholder} />
            <p className="text-right text-xs text-muted-foreground">{reason.length}/500</p>
          </div>
          {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{text.cancel}</Button>
          <Button type="submit" disabled={busy}>{busy ? text.saving : text.save}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
