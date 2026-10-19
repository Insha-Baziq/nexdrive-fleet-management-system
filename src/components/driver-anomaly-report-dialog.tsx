"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, LockKeyhole, Plus, X } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const maxBytes = 15 * 1024 * 1024;

export function DriverAnomalyReportDialog({ vehicleRegistration, reporterName }: { vehicleRegistration: string; reporterName: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  const french = locale === "fr";
  const labels = french ? {
    report: "Signaler un problème", title: "Signaler un problème sur un véhicule",
    description: "Informez votre organisation d’un problème avec le véhicule qui vous est attribué.",
    vehicle: "Véhicule", assignment: "Ce signalement sera associé au véhicule qui vous est actuellement attribué.",
    date: "Date d’observation", details: "Description", detailsPlaceholder: "Décrivez le problème observé",
    photos: "Photos", optional: "(facultatives)", choosePhotos: "Choisir des photos",
    photoRules: "PNG ou JPEG. 5 photos maximum, 15 Mo au total.", reportedBy: "Signalé par",
    cancel: "Annuler", sending: "Envoi…", submit: "Envoyer le signalement",
    success: "Problème signalé. Votre organisation peut l’examiner.",
    tooMany: "Choisissez au maximum 5 photos.", tooLarge: "La taille totale des photos ne peut pas dépasser 15 Mo.",
    unsupported: "Choisissez des photos au format PNG ou JPEG.",
    required: "Saisissez la date d’observation et une description.",
  } : {
    report: "Report problem", title: "Report a vehicle problem",
    description: "Tell your organization about a problem with your assigned vehicle.",
    vehicle: "Vehicle", assignment: "This report will be linked to your currently assigned vehicle.",
    date: "Observed date", details: "Description", detailsPlaceholder: "Describe the problem you observed",
    photos: "Photos", optional: "(optional)", choosePhotos: "Choose photos",
    photoRules: "PNG or JPEG. Up to 5 photos, 15 MB total.", reportedBy: "Reported by",
    cancel: "Cancel", sending: "Sending…", submit: "Report problem",
    success: "Problem reported. Your organization can review it.",
    tooMany: "Choose up to 5 photos.", tooLarge: "Photos must total no more than 15 MB.",
    unsupported: "Choose PNG or JPEG photos.",
    required: "Enter an observed date and description.",
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function localizeError(message: string) {
    if (!french) return message;
    const errors: Record<string, string> = {
      "Could not process the report.": "Impossible de traiter le signalement.",
      "Unauthorized.": "Vous n’êtes pas authentifié.",
      "Forbidden.": "Accès interdit.",
      "Do not provide vehicle or driver identifiers.": "Ne fournissez pas d’identifiant de véhicule ou de conducteur.",
      "A currently assigned vehicle is required to report a problem.": "Un véhicule doit vous être attribué pour signaler un problème.",
      "Invalid form data.": "Les données du formulaire sont invalides.",
      "Invalid form fields.": "Les champs du formulaire sont invalides.",
      "Enter a valid observed date and description, and choose up to 5 photos.": "Saisissez une date d’observation et une description valides, et choisissez au maximum 5 photos.",
      "Remove empty photo selections.": "Retirez les sélections de photos vides.",
      "Choose photos with a combined size up to 15 MB.": "Choisissez des photos dont la taille totale ne dépasse pas 15 Mo.",
      "Photos must be PNG or JPEG images and fit within the 15 MB total limit.": "Les photos doivent être au format PNG ou JPEG et respecter la limite totale de 15 Mo.",
      "A selected photo does not match its image type.": "Une photo sélectionnée ne correspond pas à son type d’image.",
      "Vehicle not found.": "Véhicule introuvable.",
      "Private photo storage is not configured.": "Le stockage privé des photos n’est pas configuré.",
      "Could not save the anomaly and its private photos.": "Impossible d’enregistrer le problème et ses photos privées.",
      "Anomaly could not be loaded after saving.": "Le problème enregistré n’a pas pu être chargé.",
    };
    return errors[message] ?? "Impossible d’envoyer le signalement. Vérifiez les informations et réessayez.";
  }

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
    if (next.length > 5) { setError(labels.tooMany); return; }
    if (next.reduce((sum, file) => sum + file.size, 0) > maxBytes) { setError(labels.tooLarge); return; }
    if (next.some((file) => !/\.(png|jpe?g)$/i.test(file.name) || (file.type && !["image/png", "image/jpeg"].includes(file.type)))) {
      setError(labels.unsupported); return;
    }
    setPhotos(next);
    setError("");
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date || !description.trim()) { setError(labels.required); return; }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("observedDate", date);
      form.set("description", description.trim());
      for (const file of photos) form.append("photos", file, file.name);
      const response = await fetch("/api/my-vehicle/anomalies", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(localizeError(result.error || "Could not process the report."));
      setSubmitted(true);
      setOpen(false);
      reset();
      router.refresh();
    } catch (cause) {
      setError(localizeError(cause instanceof Error ? cause.message : "Could not process the report."));
    } finally { setBusy(false); }
  }

  return (
    <div>
      <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) reset(); else setSubmitted(false); }}>
        <Button onClick={() => setOpen(true)}><Plus /> {labels.report}</Button>
        <DialogContent className="flex max-h-[min(90vh,760px)] max-w-xl flex-col gap-0 overflow-hidden p-0">
          <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
            <DialogHeader className="border-b px-5 py-4 sm:px-6">
              <DialogTitle>{labels.title}</DialogTitle>
              <DialogDescription>{labels.description}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 overflow-y-auto px-5 py-5 sm:px-6">
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground"><LockKeyhole aria-hidden="true" className="size-4" /></div>
                <div><p className="text-xs text-muted-foreground">{labels.vehicle}</p><p className="text-sm font-medium">{vehicleRegistration}</p><p className="mt-0.5 text-xs text-muted-foreground">{labels.assignment}</p></div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="driver-anomaly-observed-date">{labels.date}</Label>
                <Input id="driver-anomaly-observed-date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="driver-anomaly-description">{labels.details}</Label>
                <Textarea id="driver-anomaly-description" required maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={labels.detailsPlaceholder} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="driver-anomaly-photos">{labels.photos} <span className="font-normal text-muted-foreground">{labels.optional}</span></Label>
                <input ref={fileInput} id="driver-anomaly-photos" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" multiple aria-label={labels.choosePhotos} className="sr-only" onChange={(event) => addFiles(event.currentTarget.files)} />
                <Button type="button" variant="outline" className="justify-start" onClick={() => fileInput.current?.click()}><ImagePlus /> {labels.choosePhotos}</Button>
                {photos.length > 0 && <ul className="divide-y rounded-lg border">
                  {photos.map((file, index) => <li key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">{file.name}</span>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={french ? `Retirer ${file.name}` : `Remove ${file.name}`} onClick={() => setPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X /></Button>
                  </li>)}
                </ul>}
                <p className="text-xs text-muted-foreground">{labels.photoRules}</p>
              </div>
              <p className="text-xs text-muted-foreground">{labels.reportedBy} {reporterName}</p>
              {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter className="px-5 py-4 sm:px-6">
              <Button type="button" variant="outline" disabled={busy} onClick={() => { setOpen(false); reset(); }}>{labels.cancel}</Button>
              <Button type="submit" disabled={busy}>{busy ? labels.sending : labels.submit}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {submitted && <p role="status" className="mt-3 text-sm text-primary">{labels.success}</p>}
    </div>
  );
}
