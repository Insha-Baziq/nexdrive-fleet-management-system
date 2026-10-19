"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Driver, EligibleDriverUser } from "@/lib/drivers";

function FormField({ id, label, error, children }: {
  id: string; label: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id} className="text-[13px] text-foreground">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}

export function DriverFormDialog({ driver, eligibleUsers, onSaved, compact = false }: { driver?: Driver; eligibleUsers: EligibleDriverUser[]; onSaved?: () => void; compact?: boolean }) {
  const router = useRouter();
  const { locale } = useLocale();
  const french = locale === "fr";
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState(driver?.user_id ?? "none");
  const editing = Boolean(driver);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = Object.fromEntries(
      [
        "fullName", "licenceNumber", "licenceExpiryDate", "dateOfBirth",
        "streetNumber", "streetName", "postalCode", "city",
      ].map((field) => [field, String(data.get(field) ?? "")]),
    );
    body.userId = userId === "none" ? "" : userId;
    try {
      const response = await fetch(editing ? `/api/drivers/${driver?.id}` : "/api/drivers", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) {
        setErrors(result.errors ?? { form: result.error ?? "Could not save this driver." });
        return;
      }
      setOpen(false);
      form.reset();
      setUserId(driver?.user_id ?? "none");
      onSaved?.();
      router.refresh();
    } catch {
      setErrors({ form: "Could not connect. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setErrors({}); setUserId(driver?.user_id ?? "none"); } }}>
      <DialogTrigger render={<Button aria-label={editing && compact ? `Edit driver ${driver?.full_name}` : undefined} title={editing && compact ? `Edit ${driver?.full_name}` : undefined} variant={editing ? compact ? "ghost" : "outline" : "default"} size={editing && compact ? "icon" : "lg"} className={editing ? compact ? "size-8" : "h-9 gap-2" : "h-10 gap-2 px-4 shadow-sm"} />}>
        {editing ? <Pencil className="size-4" /> : <Plus className="size-4" />}
        {!compact && (editing ? "Edit driver" : "Add driver")}
      </DialogTrigger>
      <DialogContent className="flex max-h-[min(88dvh,780px)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[620px]">
        <DialogHeader className="shrink-0 border-b px-6 py-5 sm:px-7">
          <DialogTitle className="text-xl font-semibold tracking-[-0.03em] text-foreground">
            {editing ? (french ? "Modifier le conducteur" : "Edit driver") : (french ? "Ajouter un conducteur" : "Add a driver")}
          </DialogTitle>
          <DialogDescription>
            {editing ? (french ? "Mettez à jour les informations de ce conducteur." : "Update this driver’s information.") : (french ? "Créez une fiche conducteur pour votre organisation." : "Create a driver record for your organization.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6 sm:px-7">
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{french ? "Informations du conducteur" : "Driver details"}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{french ? "Identité, adresse et informations du permis de conduire." : "Driver identity, address, and licence information."}</p>
              </div>
              <FormField id="fullName" label={french ? "Nom complet *" : "Full name *"} error={errors.fullName}>
                <Input id="fullName" name="fullName" required maxLength={160} defaultValue={driver?.full_name ?? ""} placeholder={french ? "Nom complet" : "Full name"} className="h-10 bg-background" aria-invalid={Boolean(errors.fullName)} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="licenceNumber" label="Licence number" error={errors.licenceNumber}>
                  <Input id="licenceNumber" name="licenceNumber" maxLength={80} defaultValue={driver?.licence_number ?? ""} placeholder="Licence number" className="h-10 bg-background" aria-invalid={Boolean(errors.licenceNumber)} />
                </FormField>
                <FormField id="licenceExpiryDate" label="Licence expiry" error={errors.licenceExpiryDate}>
                  <Input id="licenceExpiryDate" name="licenceExpiryDate" type="date" defaultValue={driver?.licence_expiry_date ?? ""} className="h-10 bg-background" aria-invalid={Boolean(errors.licenceExpiryDate)} />
                </FormField>
              </div>
              <FormField id="dateOfBirth" label={french ? "Date de naissance *" : "Date of birth *"} error={errors.dateOfBirth}>
                <Input id="dateOfBirth" name="dateOfBirth" type="date" required defaultValue={driver?.date_of_birth ?? ""} className="h-10 bg-background" aria-invalid={Boolean(errors.dateOfBirth)} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="streetNumber" label={french ? "Numéro de rue *" : "Street number *"} error={errors.streetNumber}>
                  <Input id="streetNumber" name="streetNumber" required maxLength={24} defaultValue={driver?.street_number ?? ""} placeholder={french ? "ex. 12 bis" : "e.g. 12 bis"} className="h-10 bg-background" aria-invalid={Boolean(errors.streetNumber)} />
                </FormField>
                <FormField id="streetName" label={french ? "Nom de la rue *" : "Street name *"} error={errors.streetName}>
                  <Input id="streetName" name="streetName" required maxLength={160} defaultValue={driver?.street_name ?? ""} placeholder={french ? "Nom de la rue" : "Street name"} className="h-10 bg-background" aria-invalid={Boolean(errors.streetName)} />
                </FormField>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="postalCode" label={french ? "Code postal *" : "Postal code *"} error={errors.postalCode}>
                  <Input id="postalCode" name="postalCode" required maxLength={24} defaultValue={driver?.postal_code ?? ""} placeholder={french ? "Code postal" : "Postal code"} className="h-10 bg-background" aria-invalid={Boolean(errors.postalCode)} />
                </FormField>
                <FormField id="city" label={french ? "Ville *" : "City *"} error={errors.city}>
                  <Input id="city" name="city" required maxLength={120} defaultValue={driver?.city ?? ""} placeholder={french ? "Ville" : "City"} className="h-10 bg-background" aria-invalid={Boolean(errors.city)} />
                </FormField>
              </div>
              <FormField id="userId" label="Login account (optional)" error={errors.userId}>
                <Select value={userId} onValueChange={(value) => setUserId(value ?? "none")}>
                  <SelectTrigger id="userId" className="h-10 w-full min-w-0 max-w-full bg-background" aria-invalid={Boolean(errors.userId)}>
                    <SelectValue className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" placeholder="No linked account">
                      {(value: string) => {
                        if (value === "none") return "No linked account";
                        const account = eligibleUsers.find((user) => user.id === value);
                        return account ? `${account.name} · ${account.email}` : "Linked account";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No linked account</SelectItem>
                    {eligibleUsers.map((user) => <SelectItem key={user.id} value={user.id}>{user.name} · {user.email}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Only existing, unlinked Driver accounts in this organization appear here.</p>
              </FormField>
            </section>
            {errors.form && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{errors.form}</p>}
          </div>
          <DialogFooter className="mx-0 mb-0 shrink-0 border-t bg-muted/30 px-6 py-4 sm:px-7">
            <DialogClose render={<Button type="button" variant="outline" disabled={saving} />}>Cancel</DialogClose>
            <Button type="submit" disabled={saving} className="h-9 px-4">
              {saving ? "Saving…" : editing ? "Save changes" : "Create driver"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
