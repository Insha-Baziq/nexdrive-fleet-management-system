"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/locale-provider";
import { localizeClientError } from "@/lib/client-error-message";
import type { AnomalyStatus } from "@/lib/anomalies";

type ClosedStatus = Exclude<AnomalyStatus, "open">;
const copy = {
  fr: {
    cancel: "Annuler le signalement", resolve: "Résoudre l’anomalie", titleResolve: "Résoudre l’anomalie",
    titleCancel: "Annuler le signalement", description: "Le signalement initial est conservé. Indiquez la raison de cette décision.",
    reason: "Motif", resolvePlaceholder: "Décrivez comment le problème signalé a été résolu",
    cancelPlaceholder: "Expliquez pourquoi ce signalement est annulé", back: "Retour", save: "Enregistrer…",
    saveResolve: "Enregistrer la résolution", saveCancel: "Enregistrer l’annulation", required: "Saisissez un motif avant d’enregistrer la décision.",
  },
  en: {
    cancel: "Cancel anomaly", resolve: "Resolve anomaly", titleResolve: "Resolve anomaly",
    titleCancel: "Cancel anomaly", description: "The original report remains unchanged. Record the reason for this outcome.",
    reason: "Reason", resolvePlaceholder: "Describe how the reported problem was resolved",
    cancelPlaceholder: "Explain why this report is being cancelled", back: "Back", save: "Saving…",
    saveResolve: "Save resolution", saveCancel: "Save cancellation", required: "Enter a reason before saving this outcome.",
  },
} as const;

export function AnomalyOutcomeActions({ anomalyId }: { anomalyId: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  const text = copy[locale];
  const [status, setStatus] = useState<ClosedStatus | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status || !reason.trim()) { setError(text.required); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/anomalies/${anomalyId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, reason: reason.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(localizeClientError(result.error, locale, { fr: "Impossible d’enregistrer la décision. Vérifiez les informations et réessayez.", en: "Could not save the anomaly outcome. Check the details and try again." }));
      setStatus(null);
      setReason("");
      router.refresh();
    } catch (cause) {
      setError(localizeClientError(cause instanceof Error ? cause.message : undefined, locale, { fr: "Impossible d’enregistrer la décision. Vérifiez les informations et réessayez.", en: "Could not save the anomaly outcome. Check the details and try again." }));
    } finally { setBusy(false); }
  }

  return <>
    <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-4 sm:px-6">
      <Button variant="outline" onClick={() => setStatus("cancelled")}><XCircle /> {text.cancel}</Button>
      <Button onClick={() => setStatus("resolved")}><Check /> {text.resolve}</Button>
    </div>
    <Dialog open={status !== null} onOpenChange={(open) => { if (!open && !busy) { setStatus(null); setReason(""); setError(""); } }}>
      <DialogContent className="max-w-lg">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader><DialogTitle>{status === "resolved" ? text.titleResolve : text.titleCancel}</DialogTitle><DialogDescription>{text.description}</DialogDescription></DialogHeader>
          <div className="grid gap-2"><Label htmlFor="anomaly-outcome-reason">{text.reason}</Label><Textarea id="anomaly-outcome-reason" required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={status === "resolved" ? text.resolvePlaceholder : text.cancelPlaceholder} /></div>
          {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setStatus(null)}>{text.back}</Button><Button type="submit" disabled={busy}>{busy ? text.save : status === "resolved" ? text.saveResolve : text.saveCancel}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
