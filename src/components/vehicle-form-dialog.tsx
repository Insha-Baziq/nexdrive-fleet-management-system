"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Vehicle } from "@/lib/vehicles";

const ownershipLabels = {
  owned: "Véhicule appartenant à l'entreprise",
  long_term_rental: "Location longue durée / crédit-bail",
  short_term_rental: "Location courte durée",
  loan: "Véhicule prêté",
} as const;

function FormField({
  id, label, error, children, hint,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id} className="text-[13px] text-foreground">{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function VehicleFormDialog({ vehicle, onSaved, compact = false }: { vehicle?: Vehicle; onSaved?: () => void; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [ownershipType, setOwnershipType] = useState(vehicle?.ownership_type ?? "none");
  const editing = Boolean(vehicle);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    const form = event.currentTarget;
    const data = new FormData(form);
    const fields = [
      "registration", "make", "model", "year",
      "insuranceCompany", "insuranceExpiryDate", "bonusMalus",
      "registeredHolder",
    ];
    const body = { ...Object.fromEntries(fields.map((field) => [field, String(data.get(field) ?? "")])), ownershipType };

    try {
      const response = await fetch(editing ? `/api/vehicles/${vehicle?.id}` : "/api/vehicles", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) {
        setErrors(result.errors ?? { form: result.error ?? "Could not save this vehicle." });
        return;
      }

      setOpen(false);
      form.reset();
      onSaved?.();
      router.refresh();
    } catch {
      setErrors({ form: "Could not connect. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button aria-label={editing && compact ? `Edit vehicle ${vehicle?.registration}` : undefined} title={editing && compact ? `Edit ${vehicle?.registration}` : undefined} variant={editing ? compact ? "ghost" : "outline" : "default"} size={editing && compact ? "icon" : "lg"} className={editing ? compact ? "size-8" : "h-9 gap-2" : "h-10 gap-2 px-4 shadow-sm"} />}>
        {editing ? <Pencil className="size-4" /> : <Plus className="size-4" />}
        {!compact && (editing ? "Edit vehicle" : "Add vehicle")}
      </DialogTrigger>
      <DialogContent className="flex max-h-[min(88dvh,780px)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 border-b px-6 py-5 sm:px-7">
          <DialogTitle className="text-xl font-semibold tracking-[-0.03em] text-foreground">
            {editing ? "Edit vehicle" : "Add a vehicle"}
          </DialogTitle>
          <DialogDescription>
            {editing ? "Update this vehicle’s core information." : "Create a vehicle record for your organization."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6 sm:px-7">
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Vehicle details</h3>
                <p className="mt-1 text-xs text-muted-foreground">Identify the vehicle for your fleet.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="registration" label="Registration *" error={errors.registration}>
                  <Input id="registration" name="registration" required maxLength={24} defaultValue={vehicle?.registration ?? ""} placeholder="AA-123-AA" className="h-10 bg-background uppercase" aria-invalid={Boolean(errors.registration)} />
                </FormField>
                <FormField id="year" label="Year" error={errors.year}>
                  <Input id="year" name="year" type="number" min="1886" max="2100" defaultValue={vehicle?.year ?? ""} placeholder="2022" className="h-10 bg-background" aria-invalid={Boolean(errors.year)} />
                </FormField>
                <FormField id="make" label="Make" error={errors.make}>
                  <Input id="make" name="make" maxLength={80} defaultValue={vehicle?.make ?? ""} placeholder="Renault" className="h-10 bg-background" aria-invalid={Boolean(errors.make)} />
                </FormField>
                <FormField id="model" label="Model" error={errors.model}>
                  <Input id="model" name="model" maxLength={80} defaultValue={vehicle?.model ?? ""} placeholder="Trafic" className="h-10 bg-background" aria-invalid={Boolean(errors.model)} />
                </FormField>
              </div>
            </section>
            <div className="h-px bg-border" />
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Propriété et titulaire</h3>
                <p className="mt-1 text-xs text-muted-foreground">Indiquez comment ce véhicule est utilisé par l’entreprise.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="ownershipType" label="Type de propriété ou d’utilisation *" error={errors.ownershipType}>
                  <Select value={ownershipType} onValueChange={(value) => setOwnershipType(value ?? "none")}>
                    <SelectTrigger id="ownershipType" className="h-10 w-full bg-background" aria-invalid={Boolean(errors.ownershipType)}>
                      <SelectValue placeholder="Choisir un type">
                        {(value: string) => value === "none" ? "Choisir un type" : ownershipLabels[value as keyof typeof ownershipLabels]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Choisir un type</SelectItem>
                      {Object.entries(ownershipLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>
                {ownershipType !== "owned" && ownershipType !== "none" && <FormField id="registeredHolder" label="Titulaire de la carte grise *" error={errors.registeredHolder}>
                  <Input id="registeredHolder" name="registeredHolder" required maxLength={160} defaultValue={vehicle?.registered_holder ?? ""} className="h-10 bg-background" aria-invalid={Boolean(errors.registeredHolder)} />
                </FormField>}
              </div>
              {editing && !vehicle?.ownership_type && <p className="text-xs text-amber-700 dark:text-amber-300">Le type de propriété de ce véhicule existant reste à compléter.</p>}
            </section>
            <div className="h-px bg-border" />
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Assurance</h3>
                <p className="mt-1 text-xs text-muted-foreground">Les contrôles techniques se gèrent dans l’onglet de la fiche véhicule.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="insuranceExpiryDate" label="Insurance expiry" error={errors.insuranceExpiryDate}>
                  <Input id="insuranceExpiryDate" name="insuranceExpiryDate" type="date" defaultValue={vehicle?.insurance_expiry_date ?? ""} className="h-10 bg-background" aria-invalid={Boolean(errors.insuranceExpiryDate)} />
                </FormField>
                <FormField id="insuranceCompany" label="Insurance company" error={errors.insuranceCompany}>
                  <Input id="insuranceCompany" name="insuranceCompany" maxLength={120} defaultValue={vehicle?.insurance_company ?? ""} placeholder="Company name" className="h-10 bg-background" aria-invalid={Boolean(errors.insuranceCompany)} />
                </FormField>
                <FormField id="bonusMalus" label="Bonus / malus" error={errors.bonusMalus} hint="Optional coefficient, for example 0.85.">
                  <Input id="bonusMalus" name="bonusMalus" type="number" min="0" max="999.99" step="0.01" defaultValue={vehicle?.bonus_malus ?? ""} placeholder="0.85" className="h-10 bg-background" aria-invalid={Boolean(errors.bonusMalus)} />
                </FormField>
              </div>
            </section>
            {errors.form && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{errors.form}</p>}
          </div>
          <DialogFooter className="mx-0 mb-0 shrink-0 border-t bg-muted/30 px-6 py-4 sm:px-7">
            <DialogClose render={<Button type="button" variant="outline" disabled={saving} />}>Cancel</DialogClose>
            <Button type="submit" disabled={saving} className="h-9 px-4">
              {saving ? "Saving…" : editing ? "Save changes" : "Create vehicle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
