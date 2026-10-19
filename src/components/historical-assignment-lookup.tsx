"use client";

import { useId, useState, type FormEvent } from "react";
import { CalendarClock, CarFront, Search, UserRound } from "lucide-react";
import type { Vehicle } from "@/lib/vehicles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { useLocale } from "@/components/locale-provider";

type LookupResult = {
  vehicle: { id: string; registration: string; make: string; model: string };
  at: string;
  recordedAssignment: { id: string; driver_id: string; driver_name: string; started_at: string; ended_at: string | null } | null;
  currentAssignment: { id: string; driver_id: string; driver_name: string; started_at: string } | null;
};

function localNow() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function dateTime(value: string, locale: "fr" | "en") {
  return new Date(value).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function HistoricalAssignmentLookup({ vehicles }: { vehicles: Vehicle[] }) {
  const { locale } = useLocale();
  const french = locale === "fr";
  const text = french ? {
    title: "Qui conduisait ce véhicule ?", description: "Recherchez l’affectation d’un conducteur à une date et une heure précises.",
    cardTitle: "Rechercher une affectation", timezone: "Les heures sont interprétées selon le fuseau horaire de votre navigateur.",
    vehicle: "Véhicule", currentDriver: "Conducteur actuel", noActiveDriver: "Aucun conducteur actif",
    addVehicle: "Ajoutez un véhicule avant de rechercher dans l’historique des affectations.", searchVehicles: "Rechercher des véhicules", noVehicles: "Aucun véhicule correspondant.",
    dateTime: "Date et heure", search: "Rechercher une affectation", searching: "Recherche en cours…", selectVehicle: "Sélectionnez un véhicule.",
    validDate: "Saisissez une date et une heure valides.", lookupError: "Impossible de rechercher l’affectation.", connectionError: "Connexion impossible. Veuillez réessayer.",
    assignmentAt: "Affectation à", recordedDriver: "Conducteur enregistré", period: "Période d’affectation", active: "En cours",
    noAssignment: "Aucune affectation enregistrée à cette date", noAssignmentDescription: "Le journal ne contient aucune affectation de ce véhicule à la date et à l’heure sélectionnées.",
    currentAssignment: "Affectation actuelle", presentAllocation: "Affectation actuelle enregistrée pour ce véhicule", since: "Depuis", currentVehicleUnassigned: "Ce véhicule n’est actuellement pas affecté.",
    disclaimer: "Cette information reflète les affectations enregistrées dans NexDrive. Elle ne détermine pas la responsabilité juridique ou liée à un accident.",
  } : {
    title: "Who had this vehicle?", description: "Look up a recorded driver assignment at a specific date and time.",
    cardTitle: "Look up a vehicle assignment", timezone: "Times are interpreted in your browser’s local time zone.",
    vehicle: "Vehicle", currentDriver: "Current driver", noActiveDriver: "No active driver",
    addVehicle: "Add a vehicle before searching assignment history.", searchVehicles: "Search vehicles", noVehicles: "No vehicles match your search.",
    dateTime: "Date and time", search: "Search assignment", searching: "Searching…", selectVehicle: "Select a vehicle.",
    validDate: "Enter a valid date and time.", lookupError: "Could not look up the assignment.", connectionError: "Could not connect. Please try again.",
    assignmentAt: "Assignment at", recordedDriver: "Recorded driver", period: "Assignment period", active: "Active",
    noAssignment: "No assignment recorded at this time", noAssignmentDescription: "The journal has no allocation for this vehicle at the selected date and time.",
    currentAssignment: "Current assignment", presentAllocation: "Present allocation recorded for this vehicle", since: "Since", currentVehicleUnassigned: "This vehicle is currently unassigned.",
    disclaimer: "This is a record of allocation in NexDrive. It does not establish legal or accident liability.",
  };
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "none");
  const [at, setAt] = useState(localNow);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const vehicleInputId = useId();
  const vehicleOptions: SearchableSelectOption[] = vehicles.map((vehicle) => {
    const model = [vehicle.make, vehicle.model].filter(Boolean).join(" ");
    return {
      value: vehicle.id,
      label: vehicle.registration,
      description: [model, vehicle.year, vehicle.current_driver_name ? `${text.currentDriver}: ${vehicle.current_driver_name}` : text.noActiveDriver]
        .filter(Boolean)
        .join(" · "),
      keywords: `${model} ${vehicle.year ?? ""} ${vehicle.current_driver_name ?? ""}`,
    };
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (vehicleId === "none") { setError(text.selectVehicle); return; }
    const instant = new Date(at);
    if (!Number.isFinite(instant.getTime())) { setError(text.validDate); return; }
    setSearching(true);
    try {
      const query = new URLSearchParams({ vehicleId, at: instant.toISOString() });
      const response = await fetch(`/api/assignments/lookup?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) { setError(payload.error ?? text.lookupError); return; }
      setResult(payload as LookupResult);
    } catch {
      setError(text.connectionError);
    } finally {
      setSearching(false);
    }
  }

  return <main className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-7 sm:px-6">
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{text.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{text.description}</p>
    </div>
    <Card className="mb-5 gap-0 py-0">
      <CardHeader className="border-b px-5 py-4">
        <CardTitle className="text-base">{text.cardTitle}</CardTitle>
        <CardDescription>{text.timezone}</CardDescription>
      </CardHeader>
      <CardContent className="py-5">
        {!vehicles.length ? <p className="text-sm text-muted-foreground">{text.addVehicle}</p> : <form onSubmit={submit} className="grid items-end gap-4 md:grid-cols-[minmax(220px,1fr)_minmax(210px,0.8fr)_auto]">
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={vehicleInputId}>{text.vehicle}</Label>
            <SearchableSelect
              id={vehicleInputId}
              options={vehicleOptions}
              value={vehicleId === "none" ? "" : vehicleId}
              onValueChange={(value) => { setVehicleId(value || "none"); setResult(null); setError(""); }}
              placeholder={text.searchVehicles}
              emptyMessage={text.noVehicles}
            />
          </div>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor="historyAt">{text.dateTime}</Label>
            <Input id="historyAt" type="datetime-local" value={at} onChange={(event) => { setAt(event.target.value); setResult(null); }} required className="h-10 bg-background" />
          </div>
          <Button type="submit" className="h-10 gap-2" disabled={searching || !vehicles.length}><Search className="size-4" />{searching ? text.searching : text.search}</Button>
        </form>}
        {error && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>

    {result && <section aria-live="polite" className="space-y-4">
      <Card className="gap-0 py-0">
        <CardHeader className="border-b px-5 py-4">
          <CardTitle className="text-base">{text.assignmentAt} {dateTime(result.at, locale)}</CardTitle>
          <CardDescription>{result.vehicle.registration} · {[result.vehicle.make, result.vehicle.model].filter(Boolean).join(" ")}</CardDescription>
        </CardHeader>
        <CardContent className="py-5">
          {result.recordedAssignment ? <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound className="size-5" /></div>
              <div><p className="text-xs text-muted-foreground">{text.recordedDriver}</p><p className="mt-1 font-medium">{result.recordedAssignment.driver_name}</p></div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><CalendarClock className="size-5" /></div>
              <div><p className="text-xs text-muted-foreground">{text.period}</p><p className="mt-1 text-sm font-medium tabular-nums">{dateTime(result.recordedAssignment.started_at, locale)} – {result.recordedAssignment.ended_at ? dateTime(result.recordedAssignment.ended_at, locale) : text.active}</p></div>
            </div>
          </div> : <div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-4">
            <CarFront className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div><p className="text-sm font-medium">{text.noAssignment}</p><p className="mt-1 text-sm text-muted-foreground">{text.noAssignmentDescription}</p></div>
          </div>}
        </CardContent>
      </Card>

      <Card className="gap-0 py-0">
        <CardHeader className="px-5 py-4">
          <CardTitle className="text-sm">{text.currentAssignment}</CardTitle>
          <CardDescription>{text.presentAllocation}</CardDescription>
        </CardHeader>
        <CardContent className="pb-5">
          {result.currentAssignment ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-4">
            <div><p className="text-xs text-muted-foreground">{text.currentDriver}</p><p className="mt-1 font-medium">{result.currentAssignment.driver_name}</p></div>
            <p className="text-sm text-muted-foreground">{text.since} {dateTime(result.currentAssignment.started_at, locale)}</p>
          </div> : <p className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">{text.currentVehicleUnassigned}</p>}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">{text.disclaimer}</p>
    </section>}
  </main>;
}
