"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/locale-provider";
import { localizeClientError } from "@/lib/client-error-message";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type { ClaimContact } from "@/lib/claim-dossiers";
import type { ClaimContactRole } from "@/lib/claim-contact-validation";

const roleLabels: Record<"fr" | "en", Record<ClaimContactRole, string>> = {
  fr: { insurer: "Assureur", expert: "Expert", garage: "Garage / réparateur", other: "Autre" },
  en: { insurer: "Insurer", expert: "Expert", garage: "Garage / repairer", other: "Other" },
};
const copy = {
  fr: {
    contacts: "Contacts", add: "Ajouter un contact", addTitle: "Ajouter un contact au sinistre", addDescription: "Enregistrez les coordonnées liées à ce sinistre. NexDrive n’envoie aucun message à ces contacts.",
    role: "Rôle", unknownRole: "Rôle inconnu", name: "Nom", phone: "Téléphone", email: "E-mail", note: "Note", notePlaceholder: "Référence interne ou information utile.",
    noteLimit: "1 000 caractères maximum.", cancel: "Annuler", saving: "Enregistrement…", save: "Enregistrer le contact", noContacts: "Aucun contact n’a été ajouté à ce sinistre.",
    saveError: "Impossible d’enregistrer ce contact. Réessayez.", connection: "Connexion impossible. Réessayez.",
  },
  en: {
    contacts: "Contacts", add: "Add contact", addTitle: "Add claim contact", addDescription: "Save contact details related to this claim. NexDrive does not send messages to these contacts.",
    role: "Role", unknownRole: "Unknown role", name: "Name", phone: "Phone", email: "Email", note: "Note", notePlaceholder: "Internal reference or useful context.",
    noteLimit: "Up to 1,000 characters.", cancel: "Cancel", saving: "Saving…", save: "Save contact", noContacts: "No contacts have been added to this claim.",
    saveError: "Could not save this contact. Please try again.", connection: "Could not connect. Please try again.",
  },
} as const;

export function ClaimContacts({ claimId, initialContacts, canManage }: {
  claimId: string;
  initialContacts: ClaimContact[];
  canManage: boolean;
}) {
  const { locale } = useLocale();
  const text = copy[locale];
  const localizedRoleLabels = roleLabels[locale];
  const [contacts, setContacts] = useState(initialContacts);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<ClaimContactRole>("insurer");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pageCount = Math.max(1, Math.ceil(contacts.length / TABLE_PAGE_SIZE));
  const visible = contacts.slice((page - 1) * TABLE_PAGE_SIZE, page * TABLE_PAGE_SIZE);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch(`/api/claims/${claimId}/contacts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role,
          name: form.get("name"),
          phone: form.get("phone"),
          email: form.get("email"),
          note: form.get("note"),
        }),
      });
      const result = await response.json();
      if (!response.ok) { setError(localizeClientError(result.error, locale, { fr: copy.fr.saveError, en: copy.en.saveError })); return; }
      const nextContacts = [...contacts, result.contact as ClaimContact];
      setContacts(nextContacts);
      setPage(Math.ceil(nextContacts.length / TABLE_PAGE_SIZE));
      setRole("insurer");
      setOpen(false);
      formElement.reset();
    } catch {
      setError(text.connection);
    } finally {
      setSaving(false);
    }
  }

  return <Card className="mt-5 overflow-hidden rounded-xl shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
      <h2 className="text-sm font-semibold">{text.contacts}</h2>
      {canManage ? <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button className="h-9 gap-2 px-3"><Plus className="size-4" /> {text.add}</Button>} />
        <DialogContent className="flex max-h-[min(88dvh,760px)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]">
          <DialogHeader className="shrink-0 border-b px-6 py-5 sm:px-7">
            <DialogTitle className="text-xl font-semibold tracking-[-0.03em]">{text.addTitle}</DialogTitle>
            <DialogDescription>{text.addDescription}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-6 sm:px-7">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid content-start gap-2">
                  <Label htmlFor={`claim-contact-role-${claimId}`}>{text.role} *</Label>
                  <Select value={role} onValueChange={(value) => { if (value) setRole(value as ClaimContactRole); }}>
                    <SelectTrigger id={`claim-contact-role-${claimId}`} aria-label={text.role} className="h-10 w-full"><SelectValue>{(value: string) => localizedRoleLabels[value as ClaimContactRole] ?? text.unknownRole}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {Object.entries(localizedRoleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid content-start gap-2">
                  <Label htmlFor={`claim-contact-name-${claimId}`}>{text.name} *</Label>
                  <Input id={`claim-contact-name-${claimId}`} name="name" required maxLength={160} autoComplete="organization" />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid content-start gap-2"><Label htmlFor={`claim-contact-phone-${claimId}`}>{text.phone}</Label><Input id={`claim-contact-phone-${claimId}`} name="phone" type="tel" maxLength={80} autoComplete="tel" /></div>
                <div className="grid content-start gap-2"><Label htmlFor={`claim-contact-email-${claimId}`}>{text.email}</Label><Input id={`claim-contact-email-${claimId}`} name="email" type="email" maxLength={254} autoComplete="email" /></div>
              </div>
              <div className="grid content-start gap-2"><Label htmlFor={`claim-contact-note-${claimId}`}>{text.note}</Label><Textarea id={`claim-contact-note-${claimId}`} name="note" maxLength={1000} rows={4} placeholder={text.notePlaceholder} /><p className="text-xs text-muted-foreground">{text.noteLimit}</p></div>
              {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            </div>
            <DialogFooter className="shrink-0 px-6 py-4 sm:px-7">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>{text.cancel}</Button>
              <Button type="submit" disabled={saving}>{saving ? text.saving : text.save}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog> : null}
    </div>

    {contacts.length ? <>
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-[15%] px-6 text-xs text-muted-foreground">{text.role}</TableHead><TableHead className="w-[25%] text-xs text-muted-foreground">{text.name}</TableHead><TableHead className="w-[22%] text-xs text-muted-foreground">{text.phone}</TableHead><TableHead className="text-xs text-muted-foreground">{text.email}</TableHead></TableRow></TableHeader>
          <TableBody>{visible.map((contact) => <TableRow key={contact.id}>
            <TableCell className="px-6 font-medium">{localizedRoleLabels[contact.role]}</TableCell>
            <TableCell className="whitespace-normal font-medium">{contact.name}{contact.note ? <p className="mt-1 line-clamp-2 text-xs font-normal text-muted-foreground">{contact.note}</p> : null}</TableCell>
            <TableCell>{contact.phone ?? <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell className="whitespace-normal">{contact.email ?? <span className="text-muted-foreground">—</span>}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div>
      <div className="divide-y md:hidden">{visible.map((contact) => <article key={contact.id} className="grid gap-3 px-5 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-muted-foreground">{localizedRoleLabels[contact.role]}</p><p className="mt-1 font-medium">{contact.name}</p></div></div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {contact.phone ? <div><dt className="text-xs text-muted-foreground">{text.phone}</dt><dd className="mt-0.5 break-all">{contact.phone}</dd></div> : null}
          {contact.email ? <div><dt className="text-xs text-muted-foreground">{text.email}</dt><dd className="mt-0.5 break-all">{contact.email}</dd></div> : null}
          {contact.note ? <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">{text.note}</dt><dd className="mt-0.5 whitespace-pre-wrap">{contact.note}</dd></div> : null}
        </dl>
      </article>)}</div>
      <DataTablePagination page={Math.min(page, pageCount)} total={contacts.length} noun={locale === "fr" ? "contact" : "contact"} onPageChange={setPage} />
    </> : <div className="px-5 py-8 text-center sm:px-6"><p className="text-sm text-muted-foreground">{text.noContacts}</p></div>}
  </Card>;
}
