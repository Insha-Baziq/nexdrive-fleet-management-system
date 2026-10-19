"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AssignmentJournalEntry } from "@/lib/assignments";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/locale-provider";
import { localizeClientError } from "@/lib/client-error-message";

const copy = {
  fr: {
    title: "Terminer l’affectation", description: "Terminez l’affectation de {driver} au véhicule {vehicle}. Elle restera dans le journal.",
    endDate: "Date et heure de fin", reason: "Motif", placeholder: "Pourquoi cette affectation prend-elle fin ?", characters: "caractères",
    cancel: "Annuler", saving: "Enregistrement…", submit: "Terminer l’affectation", required: "Saisissez la date de fin et un motif.", invalidDate: "Saisissez une date et une heure de fin valides.",
    error: "Impossible de terminer l’affectation. Vérifiez les informations et réessayez.", connection: "Connexion impossible. Réessayez.",
  },
  en: {
    title: "End assignment", description: "Record the end of {driver}’s assignment to {vehicle}. This keeps the assignment in the journal.",
    endDate: "End date and time", reason: "Reason", placeholder: "Why is this assignment ending?", characters: "characters",
    cancel: "Cancel", saving: "Saving…", submit: "End assignment", required: "Enter an end date and a reason.", invalidDate: "Enter a valid end date and time.",
    error: "Could not end this assignment. Check the details and try again.", connection: "Could not connect. Please try again.",
  },
} as const;

function localDateTimeNow() {
  const date = new Date();
  date.setSeconds(0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function AssignmentEndDialog({ assignment, open, onOpenChange }: {
  assignment: AssignmentJournalEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const text = copy[locale];
  const [endedAt, setEndedAt] = useState(localDateTimeNow);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!endedAt || !reason.trim()) { setError(text.required); return; }
    if (!Number.isFinite(new Date(endedAt).getTime())) { setError(text.invalidDate); return; }
    setPending(true);
    try {
      const response = await fetch(`/api/assignments/history/${assignment.id}/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endedAt: new Date(endedAt).toISOString(), reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(localizeClientError(data.error || Object.values(data.errors ?? {}).join(" "), locale, { fr: copy.fr.error, en: copy.en.error }));
      onOpenChange(false);
      router.refresh();
    } catch (cause) {
      setError(localizeClientError(cause instanceof Error ? cause.message : undefined, locale, { fr: copy.fr.error, en: copy.en.error }));
    } finally {
      setPending(false);
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{text.title}</DialogTitle>
        <DialogDescription>{text.description.replace("{driver}", assignment.driver_name).replace("{vehicle}", assignment.vehicle_registration)}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5 text-sm font-medium">{text.endDate}
          <Input type="datetime-local" required value={endedAt} onChange={(event) => setEndedAt(event.target.value)} />
        </label>
        <label className="block space-y-1.5 text-sm font-medium">{text.reason}
          <Textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={text.placeholder} />
          <span className="block text-xs font-normal text-muted-foreground">{reason.length}/500 {text.characters}</span>
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>{text.cancel}</Button>
          <Button type="submit" disabled={pending || !endedAt || !reason.trim()}>{pending ? text.saving : text.submit}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
