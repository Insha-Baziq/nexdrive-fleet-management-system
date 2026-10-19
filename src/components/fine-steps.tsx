"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock3, Download, FileText, Plus } from "lucide-react";
import type { FineStep } from "@/lib/fine-dossiers";
import type { FineStepType } from "@/lib/fine-step-validation";
import { deriveFineWorkflowStatus } from "@/lib/fine-step-status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/locale-provider";
import { localizeClientError } from "@/lib/client-error-message";
import { fineEvidenceCopy } from "@/lib/client-feedback-copy";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type { FineWorkflowStatus } from "@/lib/fine-step-status";

const labels: Record<"fr" | "en", Record<FineStep["step_type"], string>> = {
  fr: { received: "Amende reçue", designation: "Désignation", contestation: "Contestation", response: "Réponse", payment: "Paiement enregistré" },
  en: { received: "Fine received", designation: "Designation", contestation: "Challenge", response: "Response", payment: "Payment recorded" },
};

const stepTypes: FineStepType[] = ["designation", "contestation", "response", "payment"];
const workflowStatusLabels: Record<"fr" | "en", Record<FineWorkflowStatus, string>> = {
  fr: { Received: "Reçue", Designated: "Conducteur désigné", Contested: "Contestée", "Response received": "Réponse reçue", Paid: "Payée", Closed: "Clôturée", Cancelled: "Annulée", Archived: "Archivée" },
  en: { Received: "Received", Designated: "Designated", Contested: "Contested", "Response received": "Response received", Paid: "Paid", Closed: "Closed", Cancelled: "Cancelled", Archived: "Archived" },
};
const copy = {
  fr: {
    title: "Historique de l’amende", currentStatus: "Statut actuel", externalPayments: "Consignez les paiements effectués en dehors de NexDrive.",
    add: "Ajouter une étape", addTitle: "Ajouter une étape à l’amende", addDescription: "Ajoutez une mise à jour datée et le justificatif associé.",
    stepType: "Type d’étape", date: "Date", driver: "Conducteur désigné", addDriver: "Ajoutez un conducteur avant d’enregistrer une désignation.",
    responseOutcome: "Résultat de la réponse", positive: "Positive", negative: "Négative", note: "Note", notePlaceholder: "Ajoutez des informations utiles pour l’équipe.",
    optionalLimit: "Facultatif · 2 000 caractères maximum.", proof: "Justificatif requis",
    cancel: "Annuler", saving: "Enregistrement…", save: "Enregistrer l’étape", open: "Ouvrir", download: "Télécharger", downloadProof: "Télécharger le justificatif",
    page: "Page", of: "sur", previous: "Précédent", next: "Suivant", noHistory: "Aucun historique d’amende disponible.",
    addError: "Impossible d’ajouter cette étape. Vérifiez les informations et réessayez.", connectError: "Connexion impossible. Réessayez.",
  },
  en: {
    title: "Fine dossier timeline", currentStatus: "Current status", externalPayments: "Record payments made outside NexDrive.",
    add: "Add step", addTitle: "Add fine step", addDescription: "Add a dated update and its supporting document.",
    stepType: "Step type", date: "Date", driver: "Designated driver", addDriver: "Add a driver record before recording a designation.",
    responseOutcome: "Response outcome", positive: "Positive", negative: "Negative", note: "Note", notePlaceholder: "Add useful context for staff.",
    optionalLimit: "Optional · up to 2,000 characters.", proof: "Required proof",
    cancel: "Cancel", saving: "Saving…", save: "Save step", open: "Open", download: "Download", downloadProof: "Download proof",
    page: "Page", of: "of", previous: "Previous", next: "Next", noHistory: "No fine history is available.",
    addError: "Could not add this fine step. Check the details and try again.", connectError: "Could not connect. Please try again.",
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

function evidenceHref(fineId: string, step: FineStep) {
  if (step.evidence.source === "fine") return `/api/fines/${fineId}/evidence/${step.evidence.id}/content`;
  return `/api/fines/${fineId}/steps/${step.id}/evidence/${step.evidence.id}/content`;
}

export function FineSteps({ fineId, recordStatus, initialSteps, drivers, canManage }: {
  fineId: string;
  recordStatus: string;
  initialSteps: FineStep[];
  drivers: { id: string; full_name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const text = copy[locale];
  const evidenceText = fineEvidenceCopy[locale];
  const stepLabels = labels[locale];
  const statusLabels = workflowStatusLabels[locale];
  const [steps, setSteps] = useState(initialSteps);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [stepType, setStepType] = useState<FineStepType>("designation");
  const [designatedDriverId, setDesignatedDriverId] = useState(drivers[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const evidenceInput = useRef<HTMLInputElement>(null);
  const pageCount = Math.max(1, Math.ceil(steps.length / TABLE_PAGE_SIZE));
  const visible = steps.slice((page - 1) * TABLE_PAGE_SIZE, page * TABLE_PAGE_SIZE);
  const status = deriveFineWorkflowStatus(recordStatus, steps);
  const canAdd = canManage && recordStatus === "open";

  async function submitStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!evidenceFile) { setError(evidenceText.requiredFile); return; }
    setSaving(true);
    setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.set("stepType", stepType);
    if (stepType === "response") form.set("responsePositive", form.get("responsePositive")?.toString() ?? "");
    if (stepType === "designation") form.set("designatedDriverId", designatedDriverId);
    try {
      const response = await fetch(`/api/fines/${fineId}/steps`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) { setError(localizeClientError(result.error, locale, { fr: copy.fr.addError, en: copy.en.addError })); return; }
      const next = [...steps, result.step as FineStep].sort((a, b) =>
        a.step_date.localeCompare(b.step_date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
      setSteps(next);
      setPage(Math.ceil(next.length / TABLE_PAGE_SIZE));
      setStepType("designation");
      setDesignatedDriverId(drivers[0]?.id ?? "");
      setEvidenceFile(null);
      setOpen(false);
      formElement.reset();
      router.refresh();
    } catch {
      setError(text.connectError);
    } finally {
      setSaving(false);
    }
  }

  return <Card className="mt-5 overflow-hidden rounded-xl shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
      <div>
        <h2 className="text-sm font-semibold">{text.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{text.currentStatus}: <span className="font-medium text-foreground">{statusLabels[status] ?? text.currentStatus}</span>. {text.externalPayments}</p>
      </div>
      {canAdd ? <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setError(""); }}>
        <DialogTrigger render={<Button className="h-9 gap-2 px-3"><Plus className="size-4" /> {text.add}</Button>} />
        <DialogContent className="flex max-h-[min(88dvh,760px)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
          <DialogHeader className="shrink-0 border-b px-6 py-5 sm:px-7">
            <DialogTitle className="text-xl font-semibold tracking-[-0.03em]">{text.addTitle}</DialogTitle>
            <DialogDescription>{text.addDescription}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitStep} className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-6 sm:px-7">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid content-start gap-2"><Label htmlFor={`fine-step-type-${fineId}`}>{text.stepType} *</Label>
                  <Select value={stepType} onValueChange={(value) => { if (value && stepTypes.includes(value as FineStepType)) setStepType(value as FineStepType); }}>
                    <SelectTrigger id={`fine-step-type-${fineId}`} aria-label={locale === "fr" ? "Type d’étape" : "Step type"} className="h-10 w-full"><SelectValue>{(value: string) => stepLabels[value as FineStepType] ?? (locale === "fr" ? "Choisir une étape" : "Select a step type")}</SelectValue></SelectTrigger>
                    <SelectContent>{stepTypes.map((value) => <SelectItem key={value} value={value}>{stepLabels[value]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid content-start gap-2"><Label htmlFor={`fine-step-date-${fineId}`}>{text.date} *</Label><Input id={`fine-step-date-${fineId}`} name="stepDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
              </div>
              {stepType === "designation" ? <div className="grid content-start gap-2"><Label htmlFor={`fine-step-driver-${fineId}`}>{text.driver} *</Label>
                <Select value={designatedDriverId} onValueChange={(value) => { if (value) setDesignatedDriverId(value); }}>
                  <SelectTrigger id={`fine-step-driver-${fineId}`} aria-label={locale === "fr" ? "Conducteur désigné" : "Designated driver"} className="h-10 w-full"><SelectValue>{(value: string) => drivers.find((driver) => driver.id === value)?.full_name ?? (locale === "fr" ? "Choisir un conducteur" : "Select a driver")}</SelectValue></SelectTrigger>
                  <SelectContent>{drivers.map((driver) => <SelectItem key={driver.id} value={driver.id}>{driver.full_name}</SelectItem>)}</SelectContent>
                </Select>
                {!drivers.length ? <p className="text-xs text-muted-foreground">{text.addDriver}</p> : null}
              </div> : null}
              {stepType === "response" ? <fieldset className="grid content-start gap-2">
                <legend className="text-sm font-medium">{text.responseOutcome} *</legend>
                <div className="flex flex-wrap gap-5 pt-1">
                  <label className="flex items-center gap-2 text-sm"><input className="accent-primary" type="radio" name="responsePositive" value="true" required /> {text.positive}</label>
                  <label className="flex items-center gap-2 text-sm"><input className="accent-primary" type="radio" name="responsePositive" value="false" required /> {text.negative}</label>
                </div>
              </fieldset> : null}
              <div className="grid content-start gap-2"><Label htmlFor={`fine-step-note-${fineId}`}>{text.note}</Label><Textarea id={`fine-step-note-${fineId}`} name="note" maxLength={2000} rows={4} placeholder={text.notePlaceholder} /><p className="text-xs text-muted-foreground">{text.optionalLimit}</p></div>
              <div className="grid min-w-0 content-start gap-2"><Label htmlFor={`fine-step-evidence-${fineId}`}>{text.proof} *</Label><Input ref={evidenceInput} id={`fine-step-evidence-${fineId}`} name="evidence" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only w-px" tabIndex={-1} onChange={(event) => setEvidenceFile(event.currentTarget.files?.[0] ?? null)} /><div className="flex min-w-0 flex-wrap items-center gap-3"><Button type="button" variant="outline" aria-label={evidenceText.chooseFile} onClick={() => evidenceInput.current?.click()}>{evidenceText.chooseFile}</Button><span className="min-w-0 max-w-full truncate text-sm text-muted-foreground">{evidenceFile?.name ?? evidenceText.noFile}</span></div><p className="text-xs text-muted-foreground">{evidenceText.fileHelp}</p></div>
              {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            </div>
            <DialogFooter className="shrink-0 px-6 py-4 sm:px-7">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>{text.cancel}</Button>
              <Button type="submit" disabled={saving || (stepType === "designation" && !drivers.length)}>{saving ? text.saving : text.save}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog> : null}
    </div>
    {steps.length ? <>
      <ol className="divide-y">
        {visible.map((step) => {
          const href = evidenceHref(fineId, step);
          const detail = step.step_type === "designation" && step.designated_driver_name
            ? `${locale === "fr" ? "Conducteur désigné" : "Designated driver"} : ${step.designated_driver_name}`
            : step.step_type === "response" && step.response_positive !== null
              ? locale === "fr"
                ? `${step.response_positive ? "Réponse positive" : "Réponse négative"}`
                : `${step.response_positive ? "Positive" : "Negative"} response`
              : null;
          return <li key={step.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(150px,0.8fr)_minmax(0,2fr)_minmax(140px,1fr)] sm:items-start sm:px-6">
            <div className="flex items-center gap-2 text-sm font-medium"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Check className="size-4" /></span><span>{stepLabels[step.step_type]}</span></div>
            <div className="min-w-0 break-words">
              <p className="text-sm font-medium">{stepLabels[step.step_type]}</p>
              {detail ? <p className="mt-1 text-sm text-foreground">{detail}</p> : null}
              {step.note ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{step.note}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs">
                <span className="flex min-w-0 items-center gap-2 font-medium"><FileText className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{step.evidence.file_name}</span><span className="shrink-0 text-muted-foreground">{step.evidence.file_extension.toUpperCase()} · {sizeLabel(step.evidence.file_size)}</span></span>
                <span className="ml-auto flex items-center gap-3"><a className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline" href={href} target="_blank" rel="noreferrer">{text.open}</a><a className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground" href={`${href}?download=1`} aria-label={`${text.download} ${step.evidence.file_name}`} title={text.downloadProof}><Download className="size-3.5" /></a></span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground sm:justify-end"><Clock3 className="size-3.5" /><time dateTime={step.step_date}>{dateLabel(step.step_date, locale)}</time>{step.actor_name ? <><span aria-hidden="true">·</span><span>{step.actor_name}</span></> : null}</div>
          </li>;
        })}
      </ol>
      {pageCount > 1 ? <div className="flex items-center justify-end gap-3 border-t px-5 py-3 sm:px-6"><span className="text-xs text-muted-foreground">{text.page} {page} {text.of} {pageCount}</span><Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>{text.previous}</Button><Button variant="outline" size="sm" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount}>{text.next}</Button></div> : null}
    </> : <div className="px-5 py-8 text-center sm:px-6"><p className="text-sm text-muted-foreground">{text.noHistory}</p></div>}
  </Card>;
}
