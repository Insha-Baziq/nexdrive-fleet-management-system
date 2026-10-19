"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Clock3, Download, FileText, Plus, Upload, X } from "lucide-react";
import type { Claim, ClaimStage } from "@/lib/claim-dossiers";
import type { ClaimStageType } from "@/lib/claim-stage-validation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/locale-provider";
import { localizeClientError } from "@/lib/client-error-message";
import { claimStageEvidenceCopy } from "@/lib/client-feedback-copy";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";

const labels: Record<"fr" | "en", Record<ClaimStage["step_type"], string>> = {
  fr: {
    declared: "Sinistre déclaré", garage_designated: "Garage désigné", expert_scheduled: "Expert programmé",
    expert_completed: "Expertise terminée", quote_received: "Devis reçu", repair_completed: "Réparation terminée",
    closed: "Dossier clôturé", cancelled: "Dossier annulé", archived: "Dossier archivé",
  },
  en: {
    declared: "Incident declared", garage_designated: "Garage designated", expert_scheduled: "Expert scheduled",
    expert_completed: "Expert completed", quote_received: "Quote received", repair_completed: "Repair completed",
    closed: "Case closed", cancelled: "Case cancelled", archived: "Case archived",
  },
};

const stageTypes: ClaimStageType[] = ["garage_designated", "expert_scheduled", "expert_completed", "quote_received", "repair_completed"];
const copy = {
  fr: {
    title: "Suivi du sinistre", description: "Mises à jour datées et justificatifs.", add: "Ajouter une étape", addTitle: "Ajouter une étape au sinistre",
    addDescription: "Ajoutez une mise à jour datée. Les échanges avec les assureurs, experts et garages se déroulent en dehors de NexDrive.",
    stage: "Étape", date: "Date", note: "Note interne", notePlaceholder: "Ajoutez des informations utiles à l’équipe.", noteLimit: "2 000 caractères maximum.",
    evidence: "Justificatif (facultatif)", cancel: "Annuler", saving: "Enregistrement…", save: "Enregistrer l’étape",
    noNote: "Aucune note", open: "Ouvrir", download: "Télécharger", page: "Page", of: "sur", previous: "Précédent", next: "Suivant", noStages: "Aucune étape enregistrée.",
    actions: "Actions du dossier", history: "Les changements de statut sont consignés dans l’historique.", close: "Clôturer le sinistre", cancelClaim: "Annuler le sinistre",
    cancelTitle: "Annuler le sinistre", cancelDescription: "Conservez l’historique existant et indiquez le motif d’annulation.", reason: "Motif", keepOpen: "Garder le dossier ouvert",
    confirmCancel: "Confirmer l’annulation", archive: "Archiver le sinistre", connection: "Connexion impossible. Réessayez.",
    addError: "Impossible d’ajouter cette étape. Vérifiez les informations et réessayez.", updateError: "Impossible de mettre à jour ce sinistre. Réessayez.",
    unknownStage: "Étape inconnue",
  },
  en: {
    title: "Claim updates", description: "Dated updates and supporting documents.", add: "Add stage", addTitle: "Add claim stage",
    addDescription: "Add a dated update to this claim. Contact with insurers, experts, and garages happens outside NexDrive.",
    stage: "Stage", date: "Date", note: "Internal note", notePlaceholder: "Add useful context for staff.", noteLimit: "Up to 2,000 characters.",
    evidence: "Evidence (optional)", cancel: "Cancel", saving: "Saving…", save: "Save stage",
    noNote: "No note", open: "Open", download: "Download", page: "Page", of: "of", previous: "Previous", next: "Next", noStages: "No stages have been recorded.",
    actions: "Case actions", history: "Status changes are recorded in the history.", close: "Close claim", cancelClaim: "Cancel claim",
    cancelTitle: "Cancel claim", cancelDescription: "Keep the existing history and record why this claim was cancelled.", reason: "Reason", keepOpen: "Keep claim open",
    confirmCancel: "Confirm cancellation", archive: "Archive claim", connection: "Could not connect. Please try again.",
    addError: "Could not add this stage. Check the details and try again.", updateError: "Could not update the claim. Please try again.",
    unknownStage: "Unknown stage",
  },
} as const;

function dateLabel(value: string, locale: "fr" | "en") {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function sizeLabel(value: string) {
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`;
}

export function ClaimStages({ claimId, claimStatus, initialStages, canManage }: {
  claimId: string;
  claimStatus: Claim["status"];
  initialStages: ClaimStage[];
  canManage: boolean;
}) {
  const { locale } = useLocale();
  const text = copy[locale];
  const evidenceText = claimStageEvidenceCopy[locale];
  const stageLabels = labels[locale];
  const router = useRouter();
  const [stages, setStages] = useState(initialStages);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [stepType, setStepType] = useState<ClaimStageType>("garage_designated");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const evidenceInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState(claimStatus);
  const pageCount = Math.max(1, Math.ceil(stages.length / TABLE_PAGE_SIZE));
  const visible = stages.slice((page - 1) * TABLE_PAGE_SIZE, page * TABLE_PAGE_SIZE);

  async function submitStage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.set("stepType", stepType);
    try {
      const response = await fetch(`/api/claims/${claimId}/stages`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) { setError(localizeClientError(result.error, locale, { fr: copy.fr.addError, en: copy.en.addError })); return; }
      const next = [...stages, result.stage as ClaimStage].sort((a, b) => a.step_date.localeCompare(b.step_date) || a.created_at.localeCompare(b.created_at));
      setStages(next);
      setPage(Math.ceil(next.length / TABLE_PAGE_SIZE));
      setStepType("garage_designated");
      setOpen(false);
      formElement.reset();
      setEvidenceFile(null);
      router.refresh();
    } catch {
      setError(text.connection);
    } finally {
      setSaving(false);
    }
  }

  async function changeLifecycle(action: "close" | "archive" | "cancel", reason?: string) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/claims/${claimId}/lifecycle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason === undefined ? { action } : { action, reason }),
      });
      const result = await response.json();
      if (!response.ok) { setError(localizeClientError(result.error, locale, { fr: copy.fr.updateError, en: copy.en.updateError })); return false; }
      setStatus(result.status as Claim["status"]);
      setStages((current) => [...current, result.stage as ClaimStage].sort((a, b) => a.step_date.localeCompare(b.step_date) || a.created_at.localeCompare(b.created_at)));
      setPage(1);
      setCancelReason("");
      setCancelOpen(false);
      router.refresh();
      return true;
    } catch {
      setError(text.connection);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return <>
    <Card className="mt-5 overflow-hidden rounded-xl shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
        <div><h2 className="text-sm font-semibold">{text.title}</h2><p className="mt-1 text-xs text-muted-foreground">{text.description}</p></div>
        {canManage && status === "open" ? <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button className="h-9 gap-2 px-3"><Plus className="size-4" /> {text.add}</Button>} />
          <DialogContent className="flex max-h-[min(88dvh,760px)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]">
            <DialogHeader className="shrink-0 border-b px-6 py-5 sm:px-7">
              <DialogTitle className="text-xl font-semibold tracking-[-0.03em]">{text.addTitle}</DialogTitle>
              <DialogDescription>{text.addDescription}</DialogDescription>
            </DialogHeader>
            <form onSubmit={submitStage} className="flex min-h-0 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-6 sm:px-7">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid content-start gap-2"><Label htmlFor={`claim-stage-type-${claimId}`}>{text.stage} *</Label>
                    <Select value={stepType} onValueChange={(value) => { if (value) setStepType(value as ClaimStageType); }}>
                      <SelectTrigger id={`claim-stage-type-${claimId}`} aria-label={text.stage} className="h-10 w-full"><SelectValue>{(value: string) => stageLabels[value as ClaimStageType] ?? text.unknownStage}</SelectValue></SelectTrigger>
                      <SelectContent>{stageTypes.map((value) => <SelectItem key={value} value={value}>{stageLabels[value]}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid content-start gap-2"><Label htmlFor={`claim-stage-date-${claimId}`}>{text.date} *</Label><Input id={`claim-stage-date-${claimId}`} name="stepDate" type="date" required /></div>
                </div>
                <div className="grid content-start gap-2"><Label htmlFor={`claim-stage-note-${claimId}`}>{text.note}</Label><Textarea id={`claim-stage-note-${claimId}`} name="note" maxLength={2000} rows={4} placeholder={text.notePlaceholder} /><p className="text-xs text-muted-foreground">{text.noteLimit}</p></div>
                <div className="grid min-w-0 content-start gap-2"><Label htmlFor={`claim-stage-evidence-${claimId}`}>{text.evidence}</Label><Input ref={evidenceInput} id={`claim-stage-evidence-${claimId}`} name="evidence" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only w-px" tabIndex={-1} onChange={(event) => setEvidenceFile(event.currentTarget.files?.[0] ?? null)} /><div className="flex min-w-0 flex-wrap items-center gap-3"><Button type="button" variant="outline" aria-label={evidenceText.chooseFile} onClick={() => evidenceInput.current?.click()}><Upload className="size-4" />{evidenceText.chooseFile}</Button><span className="min-w-0 max-w-full truncate text-sm text-muted-foreground">{evidenceFile?.name ?? evidenceText.noFile}</span></div><p className="text-xs text-muted-foreground">{evidenceText.fileHelp}</p></div>
                {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
              </div>
              <DialogFooter className="shrink-0 px-6 py-4 sm:px-7">
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>{text.cancel}</Button>
                <Button type="submit" disabled={saving}>{saving ? text.saving : text.save}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog> : null}
      </div>
      {stages.length ? <>
        <ol className="divide-y">
          {visible.map((stage) => <li key={stage.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(130px,0.7fr)_minmax(0,2fr)_minmax(160px,1fr)] sm:items-start sm:px-6">
            <div className="flex items-center gap-2 text-sm font-medium"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Check className="size-4" /></span><span>{stageLabels[stage.step_type]}</span></div>
            <div className="min-w-0 break-words">{stage.note ? <p className="whitespace-pre-wrap text-sm text-foreground">{stage.note}</p> : <p className="text-sm text-muted-foreground">{text.noNote}</p>}
              {stage.evidence ? <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs">
                <span className="flex min-w-0 items-center gap-2 font-medium"><FileText className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{stage.evidence.file_name}</span><span className="shrink-0 text-muted-foreground">{stage.evidence.file_extension.toUpperCase()} · {sizeLabel(stage.evidence.file_size)}</span></span>
                <span className="ml-auto flex items-center gap-3"><a className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline" href={`/api/claims/${claimId}/stages/${stage.id}/evidence/${stage.evidence.id}/content`} target="_blank" rel="noreferrer">{text.open}</a><a className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground" href={`/api/claims/${claimId}/stages/${stage.id}/evidence/${stage.evidence.id}/content?download=1`} aria-label={`${text.download} ${stage.evidence.file_name}`}><Download className="size-3.5" /><span className="sr-only">{text.download} {stage.evidence.file_name}</span></a></span>
              </div> : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground sm:justify-end"><Clock3 className="size-3.5" /><time dateTime={stage.step_date}>{dateLabel(stage.step_date, locale)}</time><span aria-hidden="true">·</span><span>{stage.actor_name}</span></div>
          </li>)}
        </ol>
        {pageCount > 1 ? <div className="flex items-center justify-end gap-3 border-t px-5 py-3 sm:px-6"><span className="text-xs text-muted-foreground">{text.page} {page} {text.of} {pageCount}</span><Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>{text.previous}</Button><Button variant="outline" size="sm" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount}>{text.next}</Button></div> : null}
      </> : <div className="px-5 py-8 text-center sm:px-6"><p className="text-sm text-muted-foreground">{text.noStages}</p></div>}
    </Card>

    {canManage && (status === "open" || status === "closed") ? <Card className="mt-5 overflow-hidden rounded-xl shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6"><div><h2 className="text-sm font-semibold">{text.actions}</h2><p className="mt-1 text-xs text-muted-foreground">{text.history}</p></div>
        <div className="flex flex-wrap gap-2">
          {status === "open" ? <>
            <Button variant="outline" disabled={saving} onClick={() => void changeLifecycle("close")}><Check className="size-4" /> {text.close}</Button>
            <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
              <DialogTrigger render={<Button variant="outline" disabled={saving}><X className="size-4" /> {text.cancelClaim}</Button>} />
              <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
                <DialogHeader><DialogTitle>{text.cancelTitle}</DialogTitle><DialogDescription>{text.cancelDescription}</DialogDescription></DialogHeader>
                <div className="grid gap-2"><Label htmlFor={`claim-cancel-reason-${claimId}`}>{text.reason} *</Label><Textarea id={`claim-cancel-reason-${claimId}`} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} maxLength={1000} rows={4} required />{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}</div>
                <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setCancelOpen(false)}>{text.keepOpen}</Button><Button variant="destructive" disabled={saving || !cancelReason.trim()} onClick={() => void changeLifecycle("cancel", cancelReason)}>{saving ? text.saving : text.confirmCancel}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </> : <Button variant="outline" disabled={saving} onClick={() => void changeLifecycle("archive")}><Archive className="size-4" /> {text.archive}</Button>}
        </div>
      </div>
      {error && !cancelOpen ? <p className="px-5 pb-4 text-sm text-destructive sm:px-6" role="alert">{error}</p> : null}
    </Card> : null}
  </>;
}
