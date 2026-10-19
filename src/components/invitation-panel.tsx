"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Copy, Mail, Plus, Ticket, Trash2 } from "lucide-react";
import { postOnboarding } from "@/lib/onboarding-client";
import type { AppRole } from "@/lib/organization-session";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import { useLocale } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ActiveInvitation = {
  id: string; email: string | null; role: AppRole; created_at: string; expires_at: string; copyable: boolean;
  email_delivery_status: "not_sent" | "sent" | "failed";
  email_last_attempt_at: string | null; email_last_sent_at: string | null;
  target_driver_id: string | null; target_driver_name: string | null;
};
type InvitableDriver = { id: string; full_name: string };
type CreatedInvitation = { id: string; code: string; email: string | null; role: AppRole; targetDriverId: string | null; expiresInDays: number };
const roleNames: Record<AppRole, { en: string; fr: string }> = {
  administrator: { en: "Administrator", fr: "Administrateur" },
  fleet_manager: { en: "Fleet Manager", fr: "Gestionnaire de flotte" },
  manager: { en: "Manager", fr: "Gestionnaire" },
  driver: { en: "Driver", fr: "Conducteur" },
};

function dateLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export function InvitationPanel({ initialInvitations, initialDrivers = [] }: { initialInvitations: ActiveInvitation[]; initialDrivers?: InvitableDriver[] }) {
  const { locale } = useLocale();
  const french = locale === "fr";
  const [open, setOpen] = useState(false);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [invitableDrivers, setInvitableDrivers] = useState(initialDrivers);
  const [role, setRole] = useState<AppRole>("driver");
  const [email, setEmail] = useState("");
  const [codesOpen, setCodesOpen] = useState(false);
  const [generated, setGenerated] = useState<CreatedInvitation | null>(null);
  const [delivery, setDelivery] = useState<"sent" | "failed" | null>(null);
  const [targetDriverId, setTargetDriverId] = useState("");
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    async function refresh() {
      try {
        const response = await fetch("/api/invitations", { cache: "no-store" });
        if (response.ok) {
          const data = await response.json() as { invitations: ActiveInvitation[]; invitableDrivers?: InvitableDriver[] };
          setInvitations(data.invitations);
          if (data.invitableDrivers) setInvitableDrivers(data.invitableDrivers);
        }
      } catch { /* Keep the list until connectivity returns. */ }
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [open]);

  function changeOpen(next: boolean) {
    if (busy && !next) return;
    setOpen(next);
    if (!next) { setCreated(null); setRevealed(null); setCopied(false); setConfirmRevokeId(null); setError(""); setEmail(""); setTargetDriverId(""); setRole("driver"); setCodesOpen(false); setGenerated(null); setDelivery(null); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(french ? "Saisissez une adresse e-mail valide." : "Enter a valid email address."); return; }
    setBusy(true); setError(""); setCopied(false);
    try {
      const result = await postOnboarding<CreatedInvitation>("/api/invitations", {
        role, email: email.trim(), targetDriverId: targetDriverId || undefined,
      });
      setCreated(result); setRevealed(null); setPage(1);
      setDelivery(null);
      await deliver(result.id, result.code);
      await refreshInvitations();
    } catch (cause) { setError(french ? "Impossible de créer l’invitation. Vérifiez les informations et réessayez." : cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }

  async function refreshInvitations() {
    try {
      const response = await fetch("/api/invitations", { cache: "no-store" });
      if (response.ok) {
        const data = await response.json() as { invitations: ActiveInvitation[]; invitableDrivers?: InvitableDriver[] };
        setInvitations(data.invitations);
        if (data.invitableDrivers) setInvitableDrivers(data.invitableDrivers);
      }
    } catch { /* Keep existing records if refresh fails. */ }
  }

  async function generateCode() {
    setBusy(true); setError(""); setCopied(false);
    try {
      const result = await postOnboarding<CreatedInvitation>("/api/invitations", { role });
      setGenerated(result); setPage(1);
      await refreshInvitations();
    } catch { setError(french ? "Impossible de générer le code. Réessayez." : "Could not generate the code. Try again."); }
    finally { setBusy(false); }
  }

  async function copy(code: string) {
    try { await navigator.clipboard.writeText(code); setCopied(true); }
    catch { setError(french ? "Impossible de copier le code. Sélectionnez-le et copiez-le manuellement." : "Could not copy the code. Select and copy it manually."); }
  }

  async function reveal(invite: ActiveInvitation) {
    setBusy(true); setError(""); setCopied(false);
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(invite.id)}/code`, { cache: "no-store" });
      const data = await response.json() as { code?: string; error?: string };
      if (!response.ok || !data.code) throw new Error("Invitation not found or expired.");
      setRevealed({ id: invite.id, code: data.code });
      await copy(data.code);
    } catch (cause) { setError(french ? "Cette invitation est introuvable ou a expiré." : cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }

  async function send(invite: { id: string; code?: string }) {
    setBusy(true); setError("");
    try { await deliver(invite.id, invite.code); }
    finally { setBusy(false); }
  }

  async function deliver(invitationId: string, code?: string) {
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(invitationId)}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(code ? { code } : {}),
      });
      const data = await response.json() as { emailDeliveryStatus?: "sent" | "failed"; errorCode?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? (french ? "Impossible d’envoyer l’invitation." : "Could not send this invitation."));
      setDelivery(data.emailDeliveryStatus === "sent" ? "sent" : "failed");
      setInvitations((current) => current.map((item) => item.id === invitationId
        ? { ...item, email_delivery_status: data.emailDeliveryStatus ?? "failed", email_last_attempt_at: new Date().toISOString(), ...(data.emailDeliveryStatus === "sent" ? { email_last_sent_at: new Date().toISOString() } : {}) }
        : item));
      if (data.emailDeliveryStatus === "failed") {
        setError(data.errorCode === "EMAIL_NOT_CONFIGURED"
          ? (french ? "L’envoi des e-mails n’est pas configuré. Vérifiez les paramètres SMTP du serveur." : "Email delivery is not configured. Check the server SMTP settings.")
          : (french ? "L’envoi a échoué. Vous pouvez réessayer ou copier le code manuellement." : "Delivery failed. Retry or copy the code manually."));
      }
    } catch (cause) { setDelivery("failed"); setError(french ? "Impossible d’envoyer l’invitation. Vous pouvez réessayer." : cause instanceof Error ? cause.message : "Please try again."); }
  }

  async function revoke(invite: ActiveInvitation) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(invite.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not revoke invitation.");
      setInvitations((current) => current.filter((item) => item.id !== invite.id));
      setRevealed((current) => current?.id === invite.id ? null : current);
      setGenerated((current) => current?.id === invite.id ? null : current);
      if (created?.id === invite.id) { setCreated(null); setDelivery(null); }
      setConfirmRevokeId(null);
    } catch (cause) { setError(french ? "Impossible de supprimer le code. Vous pouvez réessayer." : cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }

  const totalPages = Math.max(1, Math.ceil(invitations.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = invitations.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE);

  return <>
    <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger render={<Button type="button" className="w-full sm:w-auto" />}><Plus data-icon="inline-start" />{french ? "Inviter un utilisateur" : "Invite user"}</DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{french ? "Inviter un utilisateur" : "Invite user"}</DialogTitle><DialogDescription>{french ? "Envoyez un lien pour rejoindre votre organisation." : "Send a link to join your organization."}</DialogDescription></DialogHeader>
      {created ? <div className="space-y-3 rounded-lg border border-primary/25 bg-primary/5 p-4">
        <p role="status" className="font-medium">{delivery === "sent" ? (french ? "Invitation envoyée" : "Invitation sent") : (french ? "Invitation créée — envoi à réessayer" : "Invitation created — retry delivery")}</p>
        <p className="break-all text-sm" data-no-translate>{created.email}</p>
        {delivery === "failed" ? <Button type="button" disabled={busy} onClick={() => { void send(created); }}>{french ? "Réessayer l’envoi" : "Retry sending"}</Button> : null}
        <Button type="button" variant="outline" disabled={busy} onClick={() => { setCreated(null); setDelivery(null); setError(""); setEmail(""); setTargetDriverId(""); }}>{french ? "Inviter un autre utilisateur" : "Invite another user"}</Button>
      </div> : <>
        <form onSubmit={create} className="grid gap-4">
          <div className="grid min-w-0 gap-2"><Label htmlFor="inviteEmail">{french ? "Adresse e-mail" : "Email address"}</Label><Input id="inviteEmail" type="email" maxLength={254} required disabled={busy} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={french ? "nom@exemple.fr" : "name@example.com"} /></div>
          <div className="grid min-w-0 gap-2"><Label htmlFor="inviteRole">{french ? "Rôle" : "Role"}</Label><Select value={role} disabled={busy || Boolean(targetDriverId)} onValueChange={(value) => { if (value) setRole(value as AppRole); }}>
            <SelectTrigger id="inviteRole" className="w-full data-[size=default]:h-10"><SelectValue>{roleNames[role][french ? "fr" : "en"]}</SelectValue></SelectTrigger>
            <SelectContent side="bottom" align="start" sideOffset={6} alignItemWithTrigger={false}>{(Object.keys(roleNames) as AppRole[]).map((value) => <SelectItem key={value} value={value}>{roleNames[value][french ? "fr" : "en"]}</SelectItem>)}</SelectContent>
          </Select></div>

          {invitableDrivers.length ? <div className="grid min-w-0 gap-2 sm:col-span-2"><Label htmlFor="inviteDriver">{french ? "Associer à un conducteur existant (facultatif)" : "Link to an existing driver (optional)"}</Label><Select disabled={busy} value={targetDriverId || "none"} onValueChange={(value) => { const next = value === "none" ? "" : value ?? ""; setTargetDriverId(next); if (next) setRole("driver"); }}>
            <SelectTrigger id="inviteDriver" className="w-full data-[size=default]:h-10"><SelectValue>{targetDriverId ? invitableDrivers.find((driver) => driver.id === targetDriverId)?.full_name : (french ? "Aucun conducteur sélectionné" : "No driver selected")}</SelectValue></SelectTrigger>
            <SelectContent side="bottom" align="start" sideOffset={6} alignItemWithTrigger={false}><SelectItem value="none">{french ? "Aucun conducteur" : "No driver"}</SelectItem>{invitableDrivers.map((driver) => <SelectItem key={driver.id} value={driver.id}>{driver.full_name}</SelectItem>)}</SelectContent>
          </Select><p className="text-xs text-muted-foreground">{french ? "Le compte sera lié à ce conducteur après l’acceptation." : "The account is linked to this driver after the invitation is accepted."}</p></div> : null}
          <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>{french ? "Annuler" : "Cancel"}</Button><Button type="submit" disabled={busy} className="h-10"><Mail data-icon="inline-start" />{busy ? (french ? "Envoi…" : "Sending…") : (french ? "Envoyer l’invitation" : "Send invitation")}</Button></div>
        </form>
      </>}
      <div className="space-y-3 border-t pt-4">
        <Button type="button" variant="ghost" disabled={busy} className="w-full justify-start" onClick={() => { void generateCode(); }}><Ticket data-icon="inline-start" />{french ? "Obtenir un code d’invitation" : "Get an invitation code"}</Button>
        {generated ? <div className="space-y-2 rounded-lg border bg-muted/30 p-3"><code className="block select-all break-all text-sm" data-no-translate>{generated.code}</code><p className="text-xs text-muted-foreground">{roleNames[generated.role][french ? "fr" : "en"]} · {french ? "Valable 7 jours" : "Valid for 7 days"}</p><Button type="button" variant="outline" size="sm" onClick={() => { void copy(generated.code); }}><Copy />{copied ? (french ? "Copié" : "Copied") : (french ? "Copier le code" : "Copy code")}</Button></div> : null}
        <Dialog open={codesOpen} onOpenChange={(next) => { if (!busy) { setCodesOpen(next); setError(""); setRevealed(null); setConfirmRevokeId(null); } }}>
          <DialogTrigger render={<Button type="button" variant="ghost" disabled={busy} className="w-full justify-start" />}>{french ? "Voir les invitations inutilisées" : "View unused invitations"}</DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader><DialogTitle>{french ? "Invitations inutilisées" : "Unused invitations"}</DialogTitle><DialogDescription>{french ? "Renvoyez une invitation par e-mail ou générez un nouveau code. Un nouveau code remplace le précédent." : "Resend an email invitation or generate a fresh code. A fresh code replaces the previous one."}</DialogDescription></DialogHeader>
            {revealed ? <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm"><p className="font-medium">{copied ? (french ? "Code copié" : "Code copied") : (french ? "Code d’invitation" : "Invitation code")}</p><code className="mt-2 block select-all break-all rounded-md bg-background p-2" data-no-translate>{revealed.code}</code></div> : null}
            <div className="space-y-2"><h3 className="font-medium">{french ? "Invitations inutilisées" : "Unused invitations"}</h3>
              {invitations.length ? <div className="divide-y rounded-lg border">{visible.map((invite) => <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0"><Badge variant="outline">{roleNames[invite.role][french ? "fr" : "en"]}</Badge>
                  <p className="mt-1 text-xs text-muted-foreground">{french ? "Expire le" : "Expires"} {dateLabel(invite.expires_at, locale)}</p>
                  {invite.email ? <p className="mt-1 break-all text-xs text-muted-foreground" data-no-translate>{invite.email}</p> : null}
                  {invite.target_driver_name ? <p className="mt-1 text-xs text-muted-foreground">{french ? "Conducteur" : "Driver"}: <span data-no-translate>{invite.target_driver_name}</span></p> : null}
                  <p role="status" className="mt-1 text-xs text-muted-foreground">{invite.email_delivery_status === "sent" ? (french ? "E-mail envoyé" : "Email sent") : invite.email_delivery_status === "failed" ? (french ? "Échec du dernier envoi" : "Last send failed") : (french ? "E-mail non envoyé" : "Email not sent")}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {invite.email ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { void send(invite); }}><Mail data-icon="inline-start" />{invite.email_delivery_status === "sent" ? (french ? "Renvoyer" : "Resend email") : (french ? "Envoyer" : "Send email")}</Button>
                    : invite.copyable ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { void reveal(invite); }}><Copy data-icon="inline-start" />{french ? "Générer et copier" : "Generate & copy"}</Button>
                      : <span className="text-xs text-muted-foreground">{french ? "Code indisponible. Créez une nouvelle invitation." : "Code unavailable. Create a new invitation."}</span>}
                  {confirmRevokeId === invite.id ? <><Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => { void revoke(invite); }}>{french ? "Confirmer la suppression" : "Confirm deletion"}</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRevokeId(null)}>{french ? "Annuler" : "Cancel"}</Button></>
                    : <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRevokeId(invite.id)}><Trash2 data-icon="inline-start" />{french ? "Supprimer" : "Delete"}</Button>}
                </div>
              </div>)}</div> : <p className="rounded-lg border p-6 text-sm text-muted-foreground">{french ? "Aucune invitation inutilisée." : "No unused invitations."}</p>}
              {totalPages > 1 ? <div className="flex items-center justify-end gap-2 pt-2 text-sm text-muted-foreground"><Button type="button" variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>{french ? "Précédent" : "Previous"}</Button><span>{french ? "Page" : "Page"} {currentPage} {french ? "sur" : "of"} {totalPages}</span><Button type="button" variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>{french ? "Suivant" : "Next"}</Button></div> : null}
            </div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </DialogContent>
        </Dialog>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </DialogContent></Dialog>
  </>;
}
