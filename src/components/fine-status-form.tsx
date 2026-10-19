"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/locale-provider";
import { localizeClientError } from "@/lib/client-error-message";
import { fineStatusLabel } from "@/lib/client-feedback-copy";
import type { FineStatus } from "@/lib/fine-validation";

const fineStatuses: FineStatus[] = ["open", "closed", "cancelled"];
const copy = {
  fr: { unknown: "Statut inconnu", saving: "Enregistrement…", update: "Mettre à jour le statut", connection: "Connexion impossible. Réessayez." },
  en: { unknown: "Unknown status", saving: "Saving…", update: "Update status", connection: "Could not connect. Please try again." },
} as const;

export function FineStatusForm({ fineId, initialStatus }: { fineId: string; initialStatus: FineStatus }) {
  const router = useRouter();
  const { locale } = useLocale();
  const text = copy[locale];
  const [status, setStatus] = useState<FineStatus>(initialStatus);
  const [savedStatus, setSavedStatus] = useState<FineStatus>(initialStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/fines/${fineId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      const result = await response.json();
      if (!response.ok) { setError(localizeClientError(result.error, locale, { fr: "Impossible de mettre à jour le statut de l’amende. Réessayez.", en: "Could not update the fine status. Please try again." })); return; }
      setSavedStatus(status);
      router.refresh();
    } catch {
      setError(text.connection);
    } finally {
      setSaving(false);
    }
  }

  return <div className="flex flex-wrap items-center justify-end gap-2">
    <Select value={status} onValueChange={(value) => { if (value && fineStatuses.includes(value as FineStatus)) setStatus(value as FineStatus); }}><SelectTrigger className="h-9 w-36" aria-label={locale === "fr" ? "Statut de l’amende" : "Fine status"}><SelectValue>{(value: string) => fineStatuses.includes(value as FineStatus) ? fineStatusLabel(value as FineStatus, locale) : text.unknown}</SelectValue></SelectTrigger><SelectContent>{fineStatuses.map((value) => <SelectItem key={value} value={value}>{fineStatusLabel(value, locale)}</SelectItem>)}</SelectContent></Select>
    <Button size="sm" onClick={save} disabled={saving || status === savedStatus}>{saving ? text.saving : text.update}</Button>
    {error ? <span className="basis-full text-right text-xs text-destructive" role="alert">{error}</span> : null}
  </div>;
}
