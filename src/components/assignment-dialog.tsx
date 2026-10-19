"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale } from "@/components/locale-provider";
import { localizeClientError } from "@/lib/client-error-message";
import type { Driver } from "@/lib/drivers";
import type { Vehicle } from "@/lib/vehicles";

const copy = {
  fr: {
    assignDriver: "Affecter un conducteur", changeDriver: "Changer de conducteur", assignVehicle: "Affecter un véhicule", changeVehicle: "Changer de véhicule",
    assignSelected: "Affecter les éléments sélectionnés", title: "Affecter un conducteur et un véhicule", description: "Indiquez la date de début de l’affectation. Les affectations précédentes restent dans l’historique.",
    vehicle: "Véhicule", chooseVehicle: "Choisir un véhicule", driver: "Conducteur", chooseDriver: "Choisir un conducteur", available: "Disponible",
    alreadyAssigned: "{driver} est déjà affecté au véhicule {vehicle}.", currentVehicle: "{driver} conduit actuellement le véhicule {vehicle}.", currentDriver: "{vehicle} est actuellement affecté à {driver}.",
    existingWillEnd: "L’affectation existante prendra fin à la date et l’heure ci-dessous.", existingPluralWillEnd: "Les affectations existantes prendront fin à la date et l’heure ci-dessous.",
    startDate: "Date et heure de début", startReason: "Motif de l’affectation (facultatif)", optionalNote: "Note facultative", endingReason: "Motif de fin de l’affectation", changeReason: "Pourquoi l’affectation change-t-elle ?",
    selectRequired: "Sélectionnez un véhicule et un conducteur.", invalidDate: "Saisissez une date et une heure de début valides.", saveError: "Impossible d’enregistrer l’affectation. Vérifiez les informations et réessayez.", connection: "Connexion impossible. Réessayez.",
    cancel: "Annuler", saving: "Enregistrement…", save: "Enregistrer l’affectation",
  },
  en: {
    assignDriver: "Assign driver", changeDriver: "Change driver", assignVehicle: "Assign vehicle", changeVehicle: "Change vehicle",
    assignSelected: "Assign selected records", title: "Assign a driver and vehicle", description: "Record when this assignment began. Previous assignments stay in the history.",
    vehicle: "Vehicle", chooseVehicle: "Select vehicle", driver: "Driver", chooseDriver: "Select driver", available: "Available",
    alreadyAssigned: "{driver} is already assigned to {vehicle}.", currentVehicle: "{driver} currently has {vehicle}.", currentDriver: "{vehicle} is currently assigned to {driver}.",
    existingWillEnd: "The existing assignment will end at the start time below.", existingPluralWillEnd: "The existing assignments will end at the start time below.",
    startDate: "Start date and time", startReason: "Assignment reason (optional)", optionalNote: "Optional note", endingReason: "Reason for ending the current assignment", changeReason: "Why is the assignment changing?",
    selectRequired: "Select a vehicle and a driver.", invalidDate: "Enter a valid start date and time.", saveError: "Could not save the assignment. Check the details and try again.", connection: "Could not connect. Please try again.",
    cancel: "Cancel", saving: "Saving…", save: "Save assignment",
  },
} as const;

function localNow() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function AssignmentDialog({ vehicles, drivers, fixedVehicleId, fixedDriverId, triggerLabel, triggerDisabled = false, onSuccess }: {
  vehicles: Vehicle[];
  drivers: Driver[];
  fixedVehicleId?: string;
  fixedDriverId?: string;
  triggerLabel?: string;
  triggerDisabled?: boolean;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const text = copy[locale];
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [chosenVehicleId, setChosenVehicleId] = useState("none");
  const [chosenDriverId, setChosenDriverId] = useState("none");
  // Fixed IDs come from the current picker/detail-page selection. Read them
  // directly from props so an already-mounted dialog cannot submit stale IDs.
  const vehicleId = fixedVehicleId ?? chosenVehicleId;
  const driverId = fixedDriverId ?? chosenDriverId;
  const [startedAt, setStartedAt] = useState(localNow);
  const [error, setError] = useState("");
  const vehicle = vehicles.find((item) => item.id === vehicleId);
  const driver = drivers.find((item) => item.id === driverId);
  const alreadyAssigned = Boolean(vehicle && driver && vehicle.current_driver_id === driver.id);
  const closureRequired = Boolean(
    vehicle && driver && !alreadyAssigned &&
    (vehicle.current_driver_id || driver.current_vehicle_id),
  );

  function reset() {
    setChosenVehicleId("none");
    setChosenDriverId("none");
    setStartedAt(localNow());
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!vehicle || !driver) { setError(text.selectRequired); return; }
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsedDate = new Date(startedAt);
    if (!Number.isFinite(parsedDate.getTime())) { setError(text.invalidDate); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vehicleId, driverId, startedAt: parsedDate.toISOString(),
          startReason: String(data.get("startReason") ?? ""),
          closureReason: String(data.get("closureReason") ?? ""),
        }),
      });
      const result = await response.json();
      if (!response.ok) { setError(localizeClientError(result.error ?? Object.values(result.errors ?? {})[0], locale, { fr: copy.fr.saveError, en: copy.en.saveError })); return; }
      setOpen(false);
      reset();
      form.reset();
      onSuccess?.();
      router.refresh();
    } catch {
      setError(text.connection);
    } finally {
      setSaving(false);
    }
  }

  const defaultLabel = fixedDriverId ? driver?.current_vehicle_id ? text.changeVehicle : text.assignVehicle : vehicle?.current_driver_id ? text.changeDriver : text.assignDriver;
  const label = triggerLabel ? triggerLabel === "Assign selected records" ? text.assignSelected : triggerLabel : defaultLabel;
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); else setStartedAt(localNow()); }}>
    <DialogTrigger render={<Button className="h-9 gap-2" disabled={triggerDisabled} />}><Link2 className="size-4" />{label}</DialogTrigger>
    <DialogContent className="flex max-h-[min(88dvh,760px)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]">
      <DialogHeader className="shrink-0 border-b px-6 py-5 sm:px-7">
        <DialogTitle className="text-xl font-semibold tracking-[-0.03em]">{text.title}</DialogTitle>
        <DialogDescription>{text.description}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-col">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-6 sm:px-7">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="assignmentVehicle">{text.vehicle} *</Label>
                <Select value={vehicleId} onValueChange={(value) => setChosenVehicleId(value ?? "none")} disabled={Boolean(fixedVehicleId)}>
                <SelectTrigger id="assignmentVehicle" aria-label={locale === "fr" ? "Véhicule" : "Vehicle"} className="h-10 w-full min-w-0 max-w-full bg-background">
                  <SelectValue className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{(value: string) => vehicles.find((item) => item.id === value)?.registration ?? text.chooseVehicle}</SelectValue>
                </SelectTrigger>
                <SelectContent>{vehicles.map((item) => <SelectItem key={item.id} value={item.id}>{item.registration} · {item.make} {item.model}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="assignmentDriver">{text.driver} *</Label>
                <Select value={driverId} onValueChange={(value) => setChosenDriverId(value ?? "none")} disabled={Boolean(fixedDriverId)}>
                <SelectTrigger id="assignmentDriver" aria-label={locale === "fr" ? "Conducteur" : "Driver"} className="h-10 w-full min-w-0 max-w-full bg-background">
                  <SelectValue className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{(value: string) => drivers.find((item) => item.id === value)?.full_name ?? text.chooseDriver}</SelectValue>
                </SelectTrigger>
                <SelectContent>{drivers.map((item) => <SelectItem key={item.id} value={item.id}>{item.full_name}{item.current_vehicle_registration ? ` · ${item.current_vehicle_registration}` : ` · ${text.available}`}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {alreadyAssigned && driver && vehicle && <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{text.alreadyAssigned.replace("{driver}", driver.full_name).replace("{vehicle}", vehicle.registration)}</p>}
          {closureRequired && <p className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
            {vehicle?.current_driver_name ? `${text.currentVehicle.replace("{driver}", vehicle.current_driver_name).replace("{vehicle}", vehicle.registration)} ` : ""}
            {driver?.current_vehicle_registration ? text.currentDriver.replace("{vehicle}", driver.current_vehicle_registration).replace("{driver}", driver.full_name) : ""}
            {" "}{vehicle?.current_driver_id && driver?.current_vehicle_id ? text.existingPluralWillEnd : text.existingWillEnd}
          </p>}
          <div className="grid gap-2">
            <Label htmlFor="assignmentStartedAt">{text.startDate} *</Label>
            <Input id="assignmentStartedAt" type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} required className="h-10 bg-background" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="assignmentStartReason">{text.startReason}</Label>
            <Input id="assignmentStartReason" name="startReason" maxLength={500} placeholder={text.optionalNote} className="h-10 bg-background" />
          </div>
          {closureRequired && <div className="grid gap-2">
            <Label htmlFor="assignmentClosureReason">{text.endingReason} *</Label>
            <Input id="assignmentClosureReason" name="closureReason" required maxLength={500} placeholder={text.changeReason} className="h-10 bg-background" />
          </div>}
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 border-t bg-muted/30 px-6 py-4 sm:px-7">
          <DialogClose render={<Button type="button" variant="outline" disabled={saving} />}>{text.cancel}</DialogClose>
          <Button type="submit" disabled={saving || alreadyAssigned || !vehicles.length || !drivers.length} className="h-9 px-4">{saving ? text.saving : text.save}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
