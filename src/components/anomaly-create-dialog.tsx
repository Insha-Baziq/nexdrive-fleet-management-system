"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/locale-provider";
import { localizeClientError } from "@/lib/client-error-message";
import type { VehicleAnomaly } from "@/lib/anomalies";

const maxBytes = 15 * 1024 * 1024;
const copy = {
  fr: {
    add: "Signaler une anomalie", title: "Signaler une anomalie sur le véhicule",
    description: "Décrivez le problème et ajoutez des photos privées si elles peuvent aider.",
    observedDate: "Date du constat", details: "Description", placeholder: "Décrivez le problème constaté",
    reportedBy: "Signalée par", photos: "Photos", optional: "(facultatif)", choosePhotos: "Choisir des photos",
    photoTypes: "PNG ou JPEG. Jusqu’à 5 photos, 15 Mo au total.", cancel: "Annuler", save: "Enregistrer…",
    maxPhotos: "Choisissez jusqu’à 5 photos.", maxSize: "Le total des photos ne peut pas dépasser 15 Mo.",
    photoTypesError: "Choisissez des photos PNG ou JPEG.", required: "Saisissez la date du constat et une description.",
  },
  en: {
    add: "Report anomaly", title: "Report vehicle anomaly",
    description: "Record the problem and add private photos if they help explain it.",
    observedDate: "Observed date", details: "Description", placeholder: "Describe what was observed",
    reportedBy: "Reported by", photos: "Photos", optional: "(optional)", choosePhotos: "Choose photos",
    photoTypes: "PNG or JPEG. Up to 5 photos, 15 MB total.", cancel: "Cancel", save: "Saving…",
    maxPhotos: "Choose up to 5 photos.", maxSize: "Photos must total no more than 15 MB.",
    photoTypesError: "Choose PNG or JPEG photos.", required: "Enter an observed date and description.",
  },
} as const;

export function AnomalyCreateDialog({ vehicleId, reporterName, onCreated }: {
  vehicleId: string;
  reporterName: string;
  onCreated: (anomaly: VehicleAnomaly) => void;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const text = copy[locale];
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setDate("");
    setDescription("");
    setPhotos([]);
    setError("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function addFiles(selected: FileList | null) {
    if (!selected?.length) return;
    const next = [...photos, ...Array.from(selected)];
    if (next.length > 5) { setError(text.maxPhotos); return; }
    if (next.reduce((sum, file) => sum + file.size, 0) > maxBytes) { setError(text.maxSize); return; }
    if (next.some((file) => !/\.(png|jpe?g)$/i.test(file.name) || (file.type && !["image/png", "image/jpeg"].includes(file.type)))) {
      setError(text.photoTypesError); return;
    }
    setPhotos(next);
    setError("");
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date || !description.trim()) { setError(text.required); return; }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("observedDate", date);
      form.set("description", description.trim());
      for (const file of photos) form.append("photos", file, file.name);
      const response = await fetch(`/api/vehicles/${vehicleId}/anomalies`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(localizeClientError(result.error, locale, { fr: "Impossible de signaler l’anomalie. Vérifiez les informations et réessayez.", en: "Could not report the anomaly. Check the details and try again." }));
      onCreated(result.anomaly as VehicleAnomaly);
      setOpen(false);
      reset();
      router.refresh();
    } catch (cause) {
      setError(localizeClientError(cause instanceof Error ? cause.message : undefined, locale, { fr: "Impossible de signaler l’anomalie. Vérifiez les informations et réessayez.", en: "Could not report the anomaly. Check the details and try again." }));
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) reset(); }}>
      <Button onClick={() => setOpen(true)}><Plus /> {text.add}</Button>
      <DialogContent className="flex max-h-[min(90vh,760px)] max-w-xl flex-col gap-0 overflow-hidden p-0">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader className="border-b px-5 py-4 sm:px-6">
            <DialogTitle>{text.title}</DialogTitle>
            <DialogDescription>{text.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 overflow-y-auto px-5 py-5 sm:px-6">
            <div className="grid gap-2">
              <Label htmlFor="anomaly-observed-date">{text.observedDate}</Label>
              <Input id="anomaly-observed-date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="anomaly-description">{text.details}</Label>
              <Textarea id="anomaly-description" required maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={text.placeholder} />
              <p className="text-xs text-muted-foreground">{text.reportedBy} {reporterName}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="anomaly-photos">{text.photos} <span className="font-normal text-muted-foreground">{text.optional}</span></Label>
              <input ref={fileInput} id="anomaly-photos" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" multiple className="sr-only" onChange={(event) => addFiles(event.currentTarget.files)} />
              <Button type="button" variant="outline" className="justify-start" onClick={() => fileInput.current?.click()}><ImagePlus /> {text.choosePhotos}</Button>
              {photos.length > 0 && <ul className="divide-y rounded-lg border">
                {photos.map((file, index) => <li key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{file.name}</span>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={locale === "fr" ? `Supprimer ${file.name}` : `Remove ${file.name}`} onClick={() => setPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X /></Button>
                </li>)}
              </ul>}
              <p className="text-xs text-muted-foreground">{text.photoTypes}</p>
            </div>
            {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" disabled={busy} onClick={() => { setOpen(false); reset(); }}>{text.cancel}</Button>
            <Button type="submit" disabled={busy}>{busy ? text.save : text.add}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
