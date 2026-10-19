"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, Search, UsersRound } from "lucide-react";
import type { AppRole } from "@/lib/organization-session";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import { InvitationPanel, type ActiveInvitation } from "@/components/invitation-panel";
import { useLocale } from "@/components/locale-provider";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type User = { id: string; name: string; email: string; role: AppRole; accountDisabledAt: string | null; lastSeenAt: string | null };
const roleNames: Record<AppRole, { en: string; fr: string }> = {
  administrator: { en: "Administrator", fr: "Administrateur" },
  fleet_manager: { en: "Fleet Manager", fr: "Gestionnaire de flotte" },
  manager: { en: "Manager", fr: "Gestionnaire" },
  driver: { en: "Driver", fr: "Conducteur" },
};
const editableRoles: AppRole[] = ["administrator", "fleet_manager", "manager", "driver"];
const roleLabel = (role: AppRole, french: boolean) => roleNames[role][french ? "fr" : "en"];

function lastOnline(user: User, now: number, french: boolean) {
  if (user.accountDisabledAt) return { text: french ? "Suspendu" : "Suspended", online: false };
  if (!now) return { text: french ? "Vérification du statut…" : "Checking status…", online: false };
  if (!user.lastSeenAt) return { text: french ? "Jamais connecté" : "Never online", online: false };
  const seconds = Math.max(0, Math.floor((now - Date.parse(user.lastSeenAt)) / 1000));
  if (seconds <= 120) return { text: french ? "En ligne" : "Online", online: true };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { text: french ? "En ligne il y a " + minutes + " min" : "Last online " + minutes + " " + (minutes === 1 ? "minute" : "minutes") + " ago", online: false };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { text: french ? "En ligne il y a " + hours + " h" : "Last online " + hours + " " + (hours === 1 ? "hour" : "hours") + " ago", online: false };
  const days = Math.floor(hours / 24);
  return { text: french ? "En ligne il y a " + days + " j" : "Last online " + days + " " + (days === 1 ? "day" : "days") + " ago", online: false };
}

export function OrganizationUserManagement({ currentUserId, initialUsers, initialInvitations, initialDrivers }: {
  currentUserId: string;
  initialUsers: User[];
  initialInvitations: ActiveInvitation[];
  initialDrivers: { id: string; full_name: string }[];
}) {
  const { locale } = useLocale();
  const french = locale === "fr";
  const [users, setUsers] = useState(initialUsers);
  const [now, setNow] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [editRole, setEditRole] = useState<AppRole>("manager");
  const [editError, setEditError] = useState("");

  function startEdit(user: User) {
    const [first, ...rest] = user.name.trim().split(/\s+/);
    setEditingUser(user);
    setFirstName(first ?? "");
    setLastName(rest.join(" "));
    setEditRole(user.role);
    setEditError("");
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUser) return;
    setBusyId(editingUser.id);
    setEditError("");
    const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
    try {
      const response = await fetch(`/api/organization-users/${encodeURIComponent(editingUser.id)}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, role: editRole }),
      });
      const result = await response.json() as { name?: string; role?: AppRole; error?: string };
      if (!response.ok) throw new Error(result.error ?? (french ? "Impossible de modifier cet utilisateur." : "Could not update this user."));
      setUsers((current) => current.map((user) => user.id === editingUser.id
        ? { ...user, name: result.name ?? name, role: result.role ?? editRole } : user));
      setEditingUser(null);
    } catch (cause) {
      setEditError(french ? "Impossible de modifier cet utilisateur. Vérifiez vos droits et réessayez." : cause instanceof Error ? cause.message : "Please try again.");
    } finally { setBusyId(null); }
  }

  useEffect(() => {
    async function refresh() {
      try {
        const response = await fetch("/api/organization-users", { cache: "no-store" });
        if (response.ok) setUsers((await response.json() as { users: User[] }).users);
      } catch { /* Keep the last known list until connectivity returns. */ }
      setNow(Date.now());
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? users.filter((user) => `${user.name} ${user.email} ${roleLabel(user.role, french)}`.toLocaleLowerCase().includes(query)) : users;
  }, [french, search, users]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE);

  async function setEnabled(user: User, enabled: boolean) {
    setBusyId(user.id); setError("");
    try {
      const response = await fetch(`/api/organization-users/${encodeURIComponent(user.id)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ disabled: !enabled }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not update account access.");
      setUsers((current) => current.map((item) => item.id === user.id
        ? { ...item, accountDisabledAt: enabled ? null : new Date().toISOString() } : item));
    } catch (cause) { setError(french ? "Impossible de modifier l’accès à ce compte. Vérifiez vos droits et réessayez." : cause instanceof Error ? cause.message : "Could not update account access."); }
    finally { setBusyId(null); }
  }

  function status(user: User) {
    const presence = lastOnline(user, now, french);
    return <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <span aria-hidden className={`size-2 rounded-full ${presence.online ? "bg-emerald-500" : user.accountDisabledAt ? "bg-muted-foreground/40" : "bg-muted-foreground/50"}`} />
      <span>{presence.text}</span>
    </span>;
  }

  function access(user: User) {
    const enabled = !user.accountDisabledAt;
    return <div className="flex items-center gap-2">
      <Switch checked={enabled} disabled={user.id === currentUserId || busyId === user.id}
        onCheckedChange={(checked) => { void setEnabled(user, checked); }}
        aria-label={(enabled ? (french ? "Suspendre " : "Suspend ") : (french ? "Réactiver " : "Reactivate ")) + user.name} />
      <span className="text-xs text-muted-foreground">{enabled ? (french ? "Actif" : "Enabled") : (french ? "Suspendu" : "Suspended")}</span>
    </div>;
  }

  return <main className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-8 sm:px-6 lg:py-10">
    <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><h1 className="text-2xl font-semibold tracking-tight">{french ? "Utilisateurs" : "Users"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{french ? "Gérez les utilisateurs de l’organisation." : "Manage organization users."}</p></div>
      <InvitationPanel initialInvitations={initialInvitations} initialDrivers={initialDrivers} />
    </div>
    <div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={french ? "Rechercher des utilisateurs…" : "Search users…"} aria-label={french ? "Rechercher des utilisateurs" : "Search users"} className="pl-9" />
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <Card className="nexdrive-user-cards gap-0 py-0"><CardContent className="p-0">{filtered.length ? <>
      <div className="hidden lg:block"><Table><TableHeader><TableRow><TableHead>{french ? "Nom" : "Name"}</TableHead><TableHead>{french ? "Adresse e-mail" : "Email address"}</TableHead><TableHead>{french ? "Rôle" : "Role"}</TableHead><TableHead>{french ? "Statut" : "Status"}</TableHead><TableHead>{french ? "Accès" : "Access"}</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
        <TableBody>{visible.map((user) => <TableRow key={user.id}>
          <TableCell className="font-medium"><span data-no-translate>{user.name}</span>{user.id === currentUserId ? <Badge variant="secondary" className="ml-2">{french ? "Vous" : "You"}</Badge> : null}</TableCell>
          <TableCell data-no-translate>{user.email}</TableCell><TableCell><Badge variant="outline">{roleLabel(user.role, french)}</Badge></TableCell>
          <TableCell>{status(user)}</TableCell><TableCell>{access(user)}</TableCell>
          <TableCell><Button variant="ghost" size="sm" onClick={() => startEdit(user)}><Pencil data-icon="inline-start" />{french ? "Modifier" : "Edit"}</Button></TableCell>
        </TableRow>)}</TableBody></Table></div>
      <div className="nexdrive-mobile-list lg:hidden">{visible.map((user) => <article key={user.id} className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2"><p className="min-w-0 break-words font-semibold" data-no-translate>{user.name}</p>{user.id === currentUserId ? <Badge variant="secondary">{french ? "Vous" : "You"}</Badge> : null}</div>
        <p className="break-all text-sm leading-relaxed text-muted-foreground" data-no-translate>{user.email}</p>
        <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{roleLabel(user.role, french)}</Badge>{status(user)}</div>
        <div className="flex items-center justify-between gap-3 border-t pt-3"><span className="text-xs font-medium text-muted-foreground">{french ? "Accès au compte" : "Account access"}</span>{access(user)}</div>
        <Button variant="outline" size="sm" onClick={() => startEdit(user)}><Pencil data-icon="inline-start" />{french ? "Modifier l’utilisateur" : "Edit user"}</Button>
      </article>)}</div>
    </> : <div className="py-12 text-center"><UsersRound className="mx-auto size-7 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">{french ? "Aucun utilisateur trouvé." : "No users found."}</p><p className="mt-1 text-sm text-muted-foreground">{french ? "Essayez une autre recherche." : "Try a different search."}</p></div>}
    <DataTablePagination page={currentPage} total={filtered.length} onPageChange={setPage} />
    </CardContent></Card>
    <Dialog open={Boolean(editingUser)} onOpenChange={(open) => { if (!open && busyId !== editingUser?.id) setEditingUser(null); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{french ? "Modifier l’utilisateur" : "Edit user"}</DialogTitle>
          <DialogDescription>{french ? "Modifiez le nom et le rôle de ce compte. L’adresse e-mail reste inchangée." : "Update this account’s name and role. The email address stays unchanged."}</DialogDescription></DialogHeader>
        <form onSubmit={(event) => { void saveUser(event); }} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2"><Label htmlFor="user-first-name">{french ? "Prénom" : "First name"}</Label><Input id="user-first-name" required maxLength={80} value={firstName} onChange={(event) => setFirstName(event.target.value)} /></div>
            <div className="grid gap-2"><Label htmlFor="user-last-name">{french ? "Nom" : "Last name"}</Label><Input id="user-last-name" maxLength={80} value={lastName} onChange={(event) => setLastName(event.target.value)} /></div>
          </div>
          <div className="grid gap-2"><Label htmlFor="user-role">{french ? "Rôle" : "Role"}</Label>
            <Select value={editRole} disabled={editingUser?.id === currentUserId} onValueChange={(value) => { if (value) setEditRole(value as AppRole); }}>
              <SelectTrigger id="user-role" className="w-full"><SelectValue>{roleLabel(editRole, french)}</SelectValue></SelectTrigger>
              <SelectContent>{editableRoles.map((role) => <SelectItem key={role} value={role}>{roleLabel(role, french)}</SelectItem>)}</SelectContent>
            </Select>
            {editingUser?.id === currentUserId ? <p className="text-xs text-muted-foreground">{french ? "Vous ne pouvez pas modifier votre propre rôle." : "You cannot change your own role."}</p> : null}
          </div>
          {editError ? <p role="alert" className="text-sm text-destructive">{editError}</p> : null}
          <DialogFooter><Button type="button" variant="outline" disabled={busyId === editingUser?.id} onClick={() => setEditingUser(null)}>{french ? "Annuler" : "Cancel"}</Button>
            <Button type="submit" disabled={busyId === editingUser?.id || !firstName.trim()}>{busyId === editingUser?.id ? (french ? "Enregistrement…" : "Saving…") : (french ? "Enregistrer" : "Save changes")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </main>;
}
