"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { translateText } from "@/lib/locale";
import type { CompanyInformation } from "@/lib/company-settings";

type CompanyFormValues = {
  legalName: string;
  siret: string;
  vatNumber: string;
  registeredAddress: string;
  administrativeContactName: string;
  administrativeContactEmail: string;
  administrativeContactPhone: string;
};

function toFormValues(company: CompanyInformation): CompanyFormValues {
  return {
    legalName: company.legal_name,
    siret: company.siret ?? "",
    vatNumber: company.vat_number ?? "",
    registeredAddress: company.registered_address ?? "",
    administrativeContactName: company.administrative_contact_name ?? "",
    administrativeContactEmail: company.administrative_contact_email ?? "",
    administrativeContactPhone: company.administrative_contact_phone ?? "",
  };
}

export function CompanySettingsForm({ initialCompany }: { initialCompany: CompanyInformation }) {
  const router = useRouter();
  const { locale } = useLocale();
  const french = locale === "fr";
  const [values, setValues] = useState(() => toFormValues(initialCompany));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function setField(field: keyof CompanyFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/settings/company", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = await response.json() as { company?: CompanyInformation; error?: string };
      if (!response.ok || !result.company) throw new Error(result.error ?? "Could not save company information.");
      setValues(toFormValues(result.company));
      setMessage(french ? "Informations de l’entreprise enregistrées." : "Company information saved.");
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save company information.";
      setError(french ? translateText(message, "fr") : message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="mx-auto w-full max-w-[900px] space-y-6 px-4 py-8 sm:px-6 lg:py-10">
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">{french ? "Informations de l’entreprise" : "Company information"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{french ? "Gérez les informations légales et administratives de votre organisation." : "Manage the legal and administrative details associated with this organization."}</p>
    </header>

    <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <form onSubmit={(event) => { void save(event); }} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-2 sm:col-span-2">
            <Label htmlFor="company-legal-name">{french ? "Raison sociale" : "Legal name"} *</Label>
            <Input id="company-legal-name" required maxLength={160} value={values.legalName} onChange={(event) => setField("legalName", event.target.value)} />
          </div>
          <div className="grid content-start gap-2">
            <Label htmlFor="company-siret">SIRET</Label>
            <Input id="company-siret" inputMode="numeric" maxLength={14} pattern="[0-9]{14}" placeholder="12345678901234" value={values.siret} onChange={(event) => setField("siret", event.target.value)} />
          </div>
          <div className="grid content-start gap-2">
            <Label htmlFor="company-vat">{french ? "Numéro de TVA" : "VAT number"}</Label>
            <Input id="company-vat" maxLength={32} value={values.vatNumber} onChange={(event) => setField("vatNumber", event.target.value)} />
          </div>
          <div className="grid content-start gap-2 sm:col-span-2">
            <Label htmlFor="company-registered-address">{french ? "Adresse du siège social" : "Registered address"}</Label>
            <Textarea id="company-registered-address" maxLength={500} rows={3} value={values.registeredAddress} onChange={(event) => setField("registeredAddress", event.target.value)} />
          </div>
        </div>

        <div className="border-t pt-5">
          <h2 className="text-sm font-semibold">{french ? "Contact administratif" : "Administrative contact"}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-2 sm:col-span-2">
              <Label htmlFor="company-contact-name">{french ? "Nom du contact administratif" : "Administrative contact name"}</Label>
              <Input id="company-contact-name" maxLength={120} value={values.administrativeContactName} onChange={(event) => setField("administrativeContactName", event.target.value)} />
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor="company-contact-email">{french ? "E-mail du contact administratif" : "Administrative contact email"}</Label>
              <Input id="company-contact-email" type="email" maxLength={254} autoComplete="email" value={values.administrativeContactEmail} onChange={(event) => setField("administrativeContactEmail", event.target.value)} />
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor="company-contact-phone">{french ? "Téléphone du contact administratif" : "Administrative contact phone"}</Label>
              <Input id="company-contact-phone" type="tel" maxLength={40} autoComplete="tel" value={values.administrativeContactPhone} onChange={(event) => setField("administrativeContactPhone", event.target.value)} />
            </div>
          </div>
        </div>

        {message ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="border-t pt-4">
          <Button type="submit" disabled={busy || !values.legalName.trim()}>{busy ? (french ? "Enregistrement…" : "Saving…") : (french ? "Enregistrer les informations" : "Save company information")}</Button>
        </div>
      </form>
    </section>
  </main>;
}
