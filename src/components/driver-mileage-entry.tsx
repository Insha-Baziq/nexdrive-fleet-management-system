"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Gauge } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function DriverMileageEntry({ registration }: { registration: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  const french = locale === "fr";
  const labels = french ? {
    declare: "Déclarer le kilométrage", saved: "Kilométrage enregistré.",
    title: "Déclarer le kilométrage", description: "Enregistrez la valeur du compteur et la date du relevé.",
    assignedVehicle: "Véhicule attribué", assignmentHint: "Ce relevé sera associé à votre affectation actuelle.",
    date: "Date du relevé", kilometres: "Kilomètres", note: "Note", optional: "(facultative)",
    notePlaceholder: "Contrôle de routine", cancel: "Annuler", saving: "Enregistrement…", save: "Enregistrer le relevé",
    lowerWarning: "Ce kilométrage est inférieur au dernier relevé", correct: "Corriger", confirmAnyway: "Confirmer quand même",
    dateRequired: "Saisissez une date de relevé valide.",
    mileageRequired: "Saisissez un nombre entier de kilomètres compris entre 0 et 2 147 483 647.",
  } : {
    declare: "Declare mileage", saved: "Mileage saved.",
    title: "Declare mileage", description: "Record the odometer value and the date you observed it.",
    assignedVehicle: "Assigned vehicle", assignmentHint: "This reading is linked to your current assignment.",
    date: "Reading date", kilometres: "Kilometres", note: "Note", optional: "(optional)",
    notePlaceholder: "Routine check", cancel: "Cancel", saving: "Saving…", save: "Save reading",
    lowerWarning: "This reading is lower than the latest record", correct: "Correct", confirmAnyway: "Confirm anyway",
    dateRequired: "Enter a valid reading date.",
    mileageRequired: "Enter a whole kilometre value from 0 to 2,147,483,647.",
  };
  const [open, setOpen] = useState(false);
  const [readingDate, setReadingDate] = useState(localToday);
  const [mileage, setMileage] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [lowerWarning, setLowerWarning] = useState<{ id: string; mileage: number; reading_date: string } | null>(null);

  function localizeError(message: string) {
    if (!french) return message;
    const errors: Record<string, string> = {
      "Enter a reading date and odometer value.": "Saisissez une date de relevé et une valeur de compteur.",
      "Unexpected reading fields were supplied.": "Des champs de relevé inattendus ont été transmis.",
      "Enter a valid calendar date.": "Saisissez une date de calendrier valide.",
      "Enter a whole kilometre value from 0 to 2,147,483,647.": "Saisissez un nombre entier de kilomètres compris entre 0 et 2 147 483 647.",
      "Enter a text note.": "Saisissez une note textuelle.",
      "Confirmation de kilométrage invalide.": "La confirmation du kilométrage est invalide.",
      "Vehicle not found.": "Véhicule introuvable.",
      "Une affectation active est nécessaire pour déclarer le kilométrage.": "Une affectation active est nécessaire pour déclarer le kilométrage.",
      "Le dernier relevé a changé. Vérifiez le kilométrage avant de confirmer.": "Le dernier relevé a changé. Vérifiez le kilométrage avant de confirmer.",
      "Mileage reading not found.": "Relevé de kilométrage introuvable.",
      "This reading has already been cancelled.": "Ce relevé a déjà été annulé.",
      "Sign in required.": "Connexion requise.",
      "Forbidden.": "Accès interdit.",
      "Could not save this reading.": "Impossible d’enregistrer ce relevé.",
      "Could not connect. Please try again.": "Connexion impossible. Réessayez.",
    };
    const match = message.match(/^Use (\d+) characters or fewer\.$/);
    if (match) return `Utilisez au plus ${match[1]} caractères.`;
    return errors[message] ?? "Vérifiez les informations du relevé et réessayez.";
  }

  function formatDate(value: string) {
    const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(french ? "fr-FR" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(date);
  }

  function reset() {
    setReadingDate(localToday());
    setMileage("");
    setNote("");
    setErrors({});
    setLowerWarning(null);
  }

  async function submit(event?: FormEvent<HTMLFormElement>, acknowledgeId?: string) {
    event?.preventDefault();
    const parsedMileage = Number(mileage);
    const parsedDate = new Date(`${readingDate}T00:00:00.000Z`);
    if (!readingDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== readingDate) {
      setErrors({ readingDate: labels.dateRequired });
      return;
    }
    if (mileage.trim() === "" || !Number.isSafeInteger(parsedMileage) || parsedMileage < 0 || parsedMileage > 2_147_483_647) {
      setErrors({ mileage: labels.mileageRequired });
      return;
    }
    if (note.trim().length > 500) {
      setErrors({ note: french ? "Utilisez au plus 500 caractères." : "Use 500 characters or fewer." });
      return;
    }
    setSaving(true);
    setSaved(false);
    setErrors({});
    try {
      const response = await fetch("/api/my-vehicle/mileage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ readingDate, mileage, note, ...(acknowledgeId ? { acknowledgeLowerThanReadingId: acknowledgeId } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.warning?.type === "lower_mileage" && result.warning.latest) {
          setLowerWarning(result.warning.latest);
          return;
        }
        setLowerWarning(null);
        setErrors(result.errors
          ? Object.fromEntries(Object.entries(result.errors as Record<string, string>).map(([key, value]) => [key, localizeError(value)]))
          : { form: localizeError(result.error ?? "Could not save this reading.") });
        return;
      }
      reset();
      setOpen(false);
      setSaved(true);
      router.refresh();
    } catch {
      setErrors({ form: localizeError("Could not connect. Please try again.") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3">
      <Button onClick={() => { setSaved(false); setOpen(true); }} className="gap-2">
        <Gauge aria-hidden="true" /> {labels.declare}
      </Button>
      {saved && <p className="mt-2 text-xs text-primary" role="status">{labels.saved}</p>}
      <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value && !saving) reset(); }}>
        <DialogContent className="max-h-[min(88dvh,680px)] overflow-y-auto sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{labels.title}</DialogTitle>
            <DialogDescription>{labels.description}</DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-5">
            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">{labels.assignedVehicle}</p>
              <p className="mt-0.5 text-sm font-medium">{registration || labels.assignedVehicle}</p>
              <p className="mt-1 text-xs text-muted-foreground">{labels.assignmentHint}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="driver-mileage-date">{labels.date} *</Label>
              <Input id="driver-mileage-date" type="date" required value={readingDate} onChange={(event) => { setReadingDate(event.target.value); setLowerWarning(null); }} aria-invalid={Boolean(errors.readingDate)} />
              {errors.readingDate && <p className="text-xs text-destructive" role="alert">{errors.readingDate}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="driver-mileage-value">{labels.kilometres} *</Label>
              <Input id="driver-mileage-value" type="number" required min="0" max="2147483647" step="1" value={mileage} onChange={(event) => { setMileage(event.target.value); setLowerWarning(null); }} placeholder="48260" aria-invalid={Boolean(errors.mileage)} />
              {errors.mileage && <p className="text-xs text-destructive" role="alert">{errors.mileage}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="driver-mileage-note">{labels.note} <span className="font-normal text-muted-foreground">{labels.optional}</span></Label>
              <Textarea id="driver-mileage-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} placeholder={labels.notePlaceholder} aria-invalid={Boolean(errors.note)} />
              {errors.note && <p className="text-xs text-destructive" role="alert">{errors.note}</p>}
            </div>
            {errors.form && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{errors.form}</p>}
            {lowerWarning && <div className="rounded-md border border-amber-500/50 bg-amber-50 px-3 py-3 text-sm text-amber-950" role="alert">
              <p>{labels.lowerWarning} ({lowerWarning.mileage.toLocaleString(french ? "fr-FR" : "en-GB")} km, {formatDate(lowerWarning.reading_date)}). {french ? "Corrigez la valeur ou confirmez quand même." : "Correct the value or confirm it anyway."}</p>
              <div className="mt-3 flex gap-2">
                <Button type="button" variant="outline" disabled={saving} onClick={() => setLowerWarning(null)}>{labels.correct}</Button>
                <Button type="button" disabled={saving} onClick={() => void submit(undefined, lowerWarning.id)}>{labels.confirmAnyway}</Button>
              </div>
            </div>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving} onClick={() => { setOpen(false); reset(); }}>{labels.cancel}</Button>
              <Button type="submit" disabled={saving}>{saving ? labels.saving : labels.save}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
