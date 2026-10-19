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
import { fineEvidenceCopy, fineVehicleOptionLabel } from "@/lib/client-feedback-copy";

type VehicleOption = { id: string; registration: string; make: string; model: string };
type FineType = "company" | "driver";

const fineTypeLabels: Record<"fr" | "en", Record<FineType, string>> = {
  fr: { company: "Entreprise", driver: "Liée à un conducteur" },
  en: { company: "Company", driver: "Driver-related" },
};
const copy = {
  fr: {
    add: "Ajouter une amende", title: "Créer une amende", description: "Enregistrez les détails de l’amende et les justificatifs privés associés.",
    reference: "Référence", vehicle: "Véhicule", chooseVehicle: "Choisir un véhicule", type: "Type d’amende", chooseType: "Choisir un type",
    dateTime: "Date et heure de l’infraction", deadline: "Date limite de paiement", amount: "Montant (facultatif)", descriptionField: "Description (facultatif)",
    evidence: "Justificatif requis", cancel: "Annuler", saving: "Enregistrement…", save: "Enregistrer l’amende",
    referencePlaceholder: "Ex. : FN-2026-0148", invalidDate: "Saisissez une date et une heure d’infraction valides.", connection: "Connexion impossible. Réessayez.",
  },
  en: {
    add: "Add fine", title: "Create a fine record", description: "Save the fine details and its private supporting evidence.",
    reference: "Reference", vehicle: "Vehicle", chooseVehicle: "Choose a vehicle", type: "Fine type", chooseType: "Choose a type",
    dateTime: "Infraction date and time", deadline: "Payment deadline", amount: "Amount (optional)", descriptionField: "Description (optional)",
    evidence: "Supporting evidence", cancel: "Cancel", saving: "Saving…", save: "Save fine",
    referencePlaceholder: "e.g. FN-2026-0148", invalidDate: "Enter a valid infraction date and time.", connection: "Could not connect. Please try again.",
  },
} as const;

export function FineCreateDialog({ vehicles }: { vehicles: VehicleOption[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const text = copy[locale];
  const evidenceText = fineEvidenceCopy[locale];
  const types = fineTypeLabels[locale];
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [fineType, setFineType] = useState<FineType>("company");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const evidenceInput = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!evidenceFile) { setError(evidenceText.requiredFile); return; }
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    form.set("vehicleId", vehicleId);
    form.set("fineType", fineType);
    const localDateTime = String(form.get("infractionAt") ?? "");
    if (localDateTime) {
      const parsedDateTime = new Date(localDateTime);
      if (Number.isNaN(parsedDateTime.getTime())) {
        setError(text.invalidDate);
        setSaving(false);
        return;
      }
      form.set("infractionAt", parsedDateTime.toISOString());
    }
    try {
      const response = await fetch("/api/fines", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) { setError(localizeClientError(result.error, locale, { fr: "Impossible d’enregistrer cette amende. Réessayez.", en: "Could not save this fine. Please try again." })); return; }
      setOpen(false);
      setEvidenceFile(null);
      router.push(`/fines/${result.fine.id}`);
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
            <div className="grid content-start gap-2"><Label htmlFor="fine-reference">{text.reference} *</Label><Input id="fine-reference" name="reference" required maxLength={100} placeholder={text.referencePlaceholder} /></div>
            <div className="grid content-start gap-2"><Label htmlFor="fine-vehicle">{text.vehicle} *</Label><Select value={vehicleId} onValueChange={(value) => setVehicleId(value ?? "")}><SelectTrigger id="fine-vehicle" aria-label={text.vehicle} className="h-10 w-full"><SelectValue placeholder={text.chooseVehicle}>{(value: string) => { const selected = vehicles.find((vehicle) => vehicle.id === value); return selected ? fineVehicleOptionLabel(selected) : text.chooseVehicle; }}</SelectValue></SelectTrigger><SelectContent>{vehicles.map((vehicle) => <SelectItem key={vehicle.id} value={vehicle.id}>{fineVehicleOptionLabel(vehicle)}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid content-start gap-2"><Label htmlFor="fine-type">{text.type} *</Label><Select value={fineType} onValueChange={(value) => { if (value === "company" || value === "driver") setFineType(value); }}><SelectTrigger id="fine-type" aria-label={text.type} className="h-10 w-full"><SelectValue>{(value: string) => types[value as FineType] ?? text.chooseType}</SelectValue></SelectTrigger><SelectContent><SelectItem value="company">{types.company}</SelectItem><SelectItem value="driver">{types.driver}</SelectItem></SelectContent></Select></div>
            <div className="grid content-start gap-2"><Label htmlFor="fine-infraction-at">{text.dateTime} *</Label><Input id="fine-infraction-at" name="infractionAt" type="datetime-local" required /></div>
            <div className="grid content-start gap-2"><Label htmlFor="fine-deadline">{text.deadline} *</Label><Input id="fine-deadline" name="paymentDeadline" type="date" required /></div>
            <div className="grid content-start gap-2"><Label htmlFor="fine-amount">{text.amount}</Label><Input id="fine-amount" name="amount" type="number" min="0" max="9999999999.99" step="0.01" placeholder="0.00" /></div>
          </div>
          <div className="grid content-start gap-2"><Label htmlFor="fine-description">{text.descriptionField}</Label><Textarea id="fine-description" name="description" maxLength={4000} rows={3} /></div>
          <div className="grid min-w-0 content-start gap-2"><Label htmlFor="fine-evidence">{text.evidence} *</Label><Input ref={evidenceInput} id="fine-evidence" name="evidence" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only w-px" tabIndex={-1} onChange={(event) => setEvidenceFile(event.currentTarget.files?.[0] ?? null)} /><div className="flex min-w-0 flex-wrap items-center gap-3"><Button type="button" variant="outline" aria-label={evidenceText.chooseFile} onClick={() => evidenceInput.current?.click()}>{evidenceText.chooseFile}</Button><span className="min-w-0 max-w-full truncate text-sm text-muted-foreground">{evidenceFile?.name ?? evidenceText.noFile}</span></div><p className="text-xs text-muted-foreground">{evidenceText.fileHelp}</p></div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
        <DialogFooter className="shrink-0 px-6 py-4 sm:px-7"><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>{text.cancel}</Button><Button type="submit" disabled={saving || !vehicles.length}>{saving ? text.saving : text.save}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
