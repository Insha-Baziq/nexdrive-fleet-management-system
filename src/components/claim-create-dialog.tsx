"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/locale-provider";
import { localizeClientError } from "@/lib/client-error-message";
import { claimCreateEvidenceCopy, fineVehicleOptionLabel } from "@/lib/client-feedback-copy";

type VehicleOption = { id: string; registration: string; make: string; model: string };
const copy = {
  fr: {
    add: "Déclarer un sinistre", title: "Déclarer un sinistre véhicule", description: "Consignez l’incident et gardez son justificatif initial dans un espace privé à votre organisation.",
    vehicle: "Véhicule", chooseVehicle: "Choisir un véhicule", incidentDate: "Date du sinistre", details: "Description", detailsPlaceholder: "Décrivez ce qui s’est passé.", descriptionLimit: "4 000 caractères maximum.",
    initialEvidence: "Justificatif initial", cancel: "Annuler", saving: "Enregistrement…", save: "Enregistrer le sinistre", connection: "Connexion impossible. Réessayez.",
    saveError: "Impossible d’enregistrer ce sinistre. Vérifiez les informations et réessayez.",
  },
  en: {
    add: "Declare claim", title: "Declare a vehicle claim", description: "Record the incident and keep its initial evidence private to your organization.",
    vehicle: "Vehicle", chooseVehicle: "Choose a vehicle", incidentDate: "Incident date", details: "Description", detailsPlaceholder: "Describe what happened.", descriptionLimit: "Up to 4,000 characters.",
    initialEvidence: "Initial evidence", cancel: "Cancel", saving: "Saving…", save: "Save claim", connection: "Could not connect. Please try again.",
    saveError: "Could not save this claim. Check the details and try again.",
  },
} as const;

export function ClaimCreateDialog({ vehicles }: { vehicles: VehicleOption[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const text = copy[locale];
  const evidenceText = claimCreateEvidenceCopy[locale];
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const evidenceInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!evidenceFile) { setError(evidenceText.requiredFile); return; }
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    form.set("vehicleId", vehicleId);
    try {
      const response = await fetch("/api/claims", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) { setError(localizeClientError(result.error, locale, { fr: text.saveError, en: text.saveError })); return; }
      setOpen(false);
      setEvidenceFile(null);
      router.push(`/claims/${result.claim.id}`);
      router.refresh();
    } catch {
      setError(text.connection);
    } finally {
      setSaving(false);
    }
  }

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button disabled={!vehicles.length} className="h-10 gap-2 px-4 shadow-sm"><Plus className="size-4" /> {text.add}</Button>} />
    <DialogContent className="flex max-h-[min(88dvh,820px)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]">
      <DialogHeader className="shrink-0 border-b px-6 py-5 sm:px-7"><DialogTitle className="text-xl font-semibold tracking-[-0.03em]">{text.title}</DialogTitle><DialogDescription>{text.description}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-col">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-6 sm:px-7">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-2"><Label htmlFor="claim-vehicle">{text.vehicle} *</Label><Select value={vehicleId} onValueChange={(value) => setVehicleId(value ?? "")}><SelectTrigger id="claim-vehicle" aria-label={text.vehicle} className="h-10 w-full"><SelectValue placeholder={text.chooseVehicle}>{(value: string) => { const selected = vehicles.find((vehicle) => vehicle.id === value); return selected ? fineVehicleOptionLabel(selected) : text.chooseVehicle; }}</SelectValue></SelectTrigger><SelectContent>{vehicles.map((vehicle) => <SelectItem key={vehicle.id} value={vehicle.id}>{fineVehicleOptionLabel(vehicle)}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid content-start gap-2"><Label htmlFor="claim-incident-date">{text.incidentDate} *</Label><Input id="claim-incident-date" name="incidentDate" type="date" required /></div>
          </div>
          <div className="grid content-start gap-2"><Label htmlFor="claim-description">{text.details} *</Label><Textarea id="claim-description" name="description" required maxLength={4000} rows={4} placeholder={text.detailsPlaceholder} /><p className="text-xs text-muted-foreground">{text.descriptionLimit}</p></div>
          <div className="grid min-w-0 content-start gap-2"><Label htmlFor="claim-evidence">{text.initialEvidence} *</Label><Input ref={evidenceInput} id="claim-evidence" name="initialEvidence" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only w-px" tabIndex={-1} onChange={(event) => setEvidenceFile(event.currentTarget.files?.[0] ?? null)} /><div className="flex min-w-0 flex-wrap items-center gap-3"><Button type="button" variant="outline" aria-label={evidenceText.chooseFile} onClick={() => evidenceInput.current?.click()}>{evidenceText.chooseFile}</Button><span className="min-w-0 max-w-full truncate text-sm text-muted-foreground">{evidenceFile?.name ?? evidenceText.noFile}</span></div><p className="text-xs text-muted-foreground">{evidenceText.fileHelp}</p></div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
        <DialogFooter className="shrink-0 px-6 py-4 sm:px-7"><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>{text.cancel}</Button><Button type="submit" disabled={saving || !vehicles.length}>{saving ? text.saving : text.save}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
