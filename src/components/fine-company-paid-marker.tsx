"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Info, Plus } from "lucide-react";
import type { FineCompanyPaidMarker } from "@/lib/fine-dossiers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/locale-provider";
import { localizeClientError } from "@/lib/client-error-message";
import { companyPaidEvidenceCopy } from "@/lib/client-feedback-copy";

const copy = {
  fr: {
    titleRecorded: "Paiement par l’entreprise malgré la désignation", disclaimer: "Saisie manuelle à titre de référence interne. NexDrive ne traite ni ne confirme les paiements et cette mention ne constitue pas une conclusion juridique.",
    context: "Contexte", open: "Ouvrir le justificatif", download: "Télécharger le justificatif", recorded: "Enregistré le", title: "Mention de paiement par l’entreprise",
    record: "Ajouter une mention", dialogTitle: "Enregistrer un paiement par l’entreprise", dialogDescription: "Cette mention est saisie manuellement à titre interne. NexDrive ne traite ni ne confirme les paiements et elle ne constitue pas une conclusion juridique.",
    available: "Disponible car une désignation de conducteur est enregistrée pour cette amende.", contextRequired: "Contexte", contextPlaceholder: "Ajoutez une date, une référence ou toute autre information interne.",
    requiredLimit: "Obligatoire · 2 000 caractères maximum.", proof: "Justificatif requis",
    cancel: "Annuler", saving: "Enregistrement…", save: "Enregistrer la mention", fallback: "Impossible d’enregistrer cette mention de paiement. Vérifiez les informations et réessayez.", connection: "Connexion impossible. Réessayez.",
  },
  en: {
    titleRecorded: "Company paid despite designation", disclaimer: "Manually recorded for internal reference. NexDrive does not process or confirm payment, and this record is not a legal conclusion.",
    context: "Context", open: "Open proof", download: "Download proof", recorded: "Recorded", title: "Company payment marker",
    record: "Record marker", dialogTitle: "Record company payment marker", dialogDescription: "This is a manual internal record only. NexDrive does not process or confirm payment, and this record is not a legal conclusion.",
    available: "Available because this driver-related fine has a recorded designation.", contextRequired: "Context", contextPlaceholder: "Add the date, reference, or other internal context.",
    requiredLimit: "Required · up to 2,000 characters.", proof: "Required proof",
    cancel: "Cancel", saving: "Saving…", save: "Save marker", fallback: "Could not save the marker. Check the details and try again.", connection: "Could not connect. Please try again.",
  },
} as const;

function dateTimeLabel(value: string, locale: "fr" | "en") {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function sizeLabel(value: string) {
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`;
}

export function FineCompanyPaidMarker({ fineId, marker: initialMarker, canRecord }: {
  fineId: string;
  marker: FineCompanyPaidMarker | null;
  canRecord: boolean;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const text = copy[locale];
  const evidenceText = companyPaidEvidenceCopy[locale];
  const [marker, setMarker] = useState(initialMarker);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const evidenceInput = useRef<HTMLInputElement>(null);

  async function submitMarker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!evidenceFile) { setError(evidenceText.requiredFile); return; }
    setSaving(true);
    setError("");
    const formElement = event.currentTarget;
    try {
      const response = await fetch(`/api/fines/${fineId}/company-paid`, { method: "POST", body: new FormData(formElement) });
      const result = await response.json();
      if (!response.ok) { setError(localizeClientError(result.error, locale, { fr: copy.fr.fallback, en: copy.en.fallback })); return; }
      setMarker(result.marker as FineCompanyPaidMarker);
      formElement.reset();
      setEvidenceFile(null);
      setOpen(false);
      router.refresh();
    } catch {
      setError(text.connection);
    } finally {
      setSaving(false);
    }
  }

  if (marker) {
    const evidenceHref = `/api/fines/${fineId}/company-paid/evidence/${marker.evidence.id}/content`;
    return <Card className="mt-5 overflow-hidden rounded-xl border-amber-500/20 shadow-sm">
      <div className="border-b border-amber-500/15 bg-amber-500/10 px-5 py-4 sm:px-6">
        <h2 className="text-sm font-semibold">{text.titleRecorded}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{text.disclaimer}</p>
      </div>
      <div className="grid gap-4 p-5 sm:p-6">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{text.context}</p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm">{marker.context}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-muted/30 px-3 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><FileText className="size-4" /></span>
            <div className="min-w-0"><p className="truncate text-sm font-medium">{marker.evidence.file_name}</p><p className="mt-0.5 text-xs text-muted-foreground">{marker.evidence.file_extension.toUpperCase()} · {sizeLabel(marker.evidence.file_size)}</p></div>
          </div>
          <div className="flex items-center gap-2">
            <Button nativeButton={false} variant="outline" size="sm" render={<a href={evidenceHref} target="_blank" rel="noreferrer" />}>{text.open}</Button>
            <Button nativeButton={false} variant="ghost" size="icon-sm" render={<a href={`${evidenceHref}?download=1`} aria-label={`${text.download} ${marker.evidence.file_name}`} title={text.download} />}><Download className="size-4" /></Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{text.recorded} {dateTimeLabel(marker.created_at, locale)} · {marker.recorded_by_name}</p>
      </div>
    </Card>;
  }

  if (!canRecord) return null;
  return <Card className="mt-5 overflow-hidden rounded-xl shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6">
      <div>
        <h2 className="text-sm font-semibold">{text.title}</h2>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{text.disclaimer}</p>
      </div>
      <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setError(""); }}>
        <DialogTrigger render={<Button className="h-9 gap-2 px-3"><Plus className="size-4" /> {text.record}</Button>} />
        <DialogContent className="flex max-h-[min(88dvh,760px)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
          <DialogHeader className="shrink-0 border-b px-6 py-5 sm:px-7">
            <DialogTitle className="text-xl font-semibold tracking-[-0.03em]">{text.dialogTitle}</DialogTitle>
            <DialogDescription>{text.dialogDescription}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitMarker} className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-6 sm:px-7">
              <div className="flex items-start gap-2.5 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" /><p>{text.available}</p></div>
              <div className="grid content-start gap-2"><Label htmlFor={`fine-company-paid-context-${fineId}`}>{text.contextRequired} *</Label><Textarea id={`fine-company-paid-context-${fineId}`} name="context" required maxLength={2000} rows={4} placeholder={text.contextPlaceholder} /><p className="text-xs text-muted-foreground">{text.requiredLimit}</p></div>
              <div className="grid min-w-0 content-start gap-2"><Label htmlFor={`fine-company-paid-evidence-${fineId}`}>{text.proof} *</Label><Input ref={evidenceInput} id={`fine-company-paid-evidence-${fineId}`} name="evidence" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only w-px" tabIndex={-1} onChange={(event) => setEvidenceFile(event.currentTarget.files?.[0] ?? null)} /><div className="flex min-w-0 flex-wrap items-center gap-3"><Button type="button" variant="outline" aria-label={evidenceText.chooseFile} onClick={() => evidenceInput.current?.click()}>{evidenceText.chooseFile}</Button><span className="min-w-0 max-w-full truncate text-sm text-muted-foreground">{evidenceFile?.name ?? evidenceText.noFile}</span></div><p className="text-xs text-muted-foreground">{evidenceText.fileHelp}</p></div>
              {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            </div>
            <DialogFooter className="shrink-0 px-6 py-4 sm:px-7">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>{text.cancel}</Button>
              <Button type="submit" disabled={saving}>{saving ? text.saving : text.save}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  </Card>;
}
