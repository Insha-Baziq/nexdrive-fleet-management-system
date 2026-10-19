"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Check, Circle, Search, Trash2, UsersRound, UserPlus } from "lucide-react";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PlatformHeader } from "@/components/platform-header";
import { PlatformShell } from "@/components/platform-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AppRole } from "@/lib/organization-session";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";

type OrganizationUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  disabledAt: string | null;
  lastSeenAt: string | null;
};

type Organization = {
  id: string;
  name: string;
  createdAt: string;
  countryCode: string;
  timezone: string;
  currencyCode: string;
  users: OrganizationUser[];
};

const roleLabels: Record<string, string> = {
  administrator: "Administrator",
  fleet_manager: "Fleet Manager",
  manager: "Manager",
  driver: "Driver",
};

const roles: AppRole[] = ["administrator", "fleet_manager", "manager", "driver"];

function presenceFor(user: OrganizationUser, now: number) {
  if (user.disabledAt) return { text: "Suspended", online: false };
  if (!now) return { text: "Checking status…", online: false };
  if (!user.lastSeenAt) return { text: "Never online", online: false };

  const seconds = Math.max(0, Math.floor((now - Date.parse(user.lastSeenAt)) / 1000));
  if (seconds <= 120) return { text: "Online", online: true };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { text: `Last online ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`, online: false };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { text: `Last online ${hours} ${hours === 1 ? "hour" : "hours"} ago`, online: false };
  const days = Math.floor(hours / 24);
  return { text: `Last online ${days} ${days === 1 ? "day" : "days"} ago`, online: false };
}

export function PlatformOrganizationUsers({ organization, currentUserId }: { organization: Organization; currentUserId: string }) {
  const [users, setUsers] = useState(organization.users);
  const [now, setNow] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState<AppRole>("administrator");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<OrganizationUser | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const validPasswordLength = newUserPassword.length >= 8 && newUserPassword.length <= 128;
  const passwordsMatch = passwordConfirmation.length > 0 && newUserPassword === passwordConfirmation;

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    updateNow();
    const timer = window.setInterval(updateNow, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? users.filter((user) =>
        `${user.name} ${user.email} ${roleLabels[user.role] ?? user.role}`.toLocaleLowerCase().includes(query),
      )
      : users;
  }, [users, search]);
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleUsers = filteredUsers.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError("");
    setNotice("");
    if (newUserPassword !== passwordConfirmation) {
      setCreateError("Passwords do not match.");
      return;
    }
    setCreateBusy(true);
    try {
      const response = await fetch(`/api/platform/organizations/${encodeURIComponent(organization.id)}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newUserName, email: newUserEmail, role: newUserRole, password: newUserPassword }),
      });
      const result = await response.json() as { user?: OrganizationUser; error?: string };
      if (!response.ok || !result.user) throw new Error(result.error || "The user account could not be created.");
      setUsers((current) => [result.user!, ...current]);
      setPage(1);
      setSearch("");
      setNotice(`Account created for ${result.user.email}. The user must verify their email before signing in; share the initial password securely.`);
      setCreateUserOpen(false);
      setNewUserName("");
      setNewUserEmail("");
      setNewUserRole("administrator");
      setNewUserPassword("");
      setPasswordConfirmation("");
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : "The user account could not be created.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function deleteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteTarget || deleteConfirmation !== deleteTarget.email) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/platform/users/${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: deleteConfirmation }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The user account could not be deleted.");
      setUsers((current) => current.filter((user) => user.id !== deleteTarget.id));
      setNotice(`The account for ${deleteTarget.email} was deleted. Sign-in access was removed and membership details were anonymized.`);
      setDeleteTarget(null);
      setDeleteConfirmation("");
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "The user account could not be deleted.");
    } finally {
      setDeleteBusy(false);
    }
  }

  function openCreateUser() {
    setNotice("");
    setCreateError("");
    setCreateUserOpen(true);
  }

  function openDeleteUser(user: OrganizationUser) {
    setNotice("");
    setDeleteError("");
    setDeleteConfirmation("");
    setDeleteTarget(user);
  }

  function presence(user: OrganizationUser) {
    const state = presenceFor(user, now);
    return (
      <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden="true" className={`size-2 rounded-full ${state.online ? "bg-emerald-500" : user.disabledAt ? "bg-muted-foreground/40" : "bg-muted-foreground/50"}`} />
        <span className="min-w-0 max-w-[18ch] whitespace-normal break-words">{state.text}</span>
      </span>
    );
  }

  function access(user: OrganizationUser) {
    return <Badge variant={user.disabledAt ? "secondary" : "outline"}>{user.disabledAt ? "Suspended" : "Enabled"}</Badge>;
  }

  return (
    <PlatformShell active="organizations">
    <main className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-8 sm:px-6 lg:py-10">
      <PlatformHeader
        title={organization.name}
        description={`${organization.countryCode} · ${organization.timezone} · ${organization.currencyCode} · Created ${organization.createdAt.slice(0, 10)}`}
        backHref="/platform"
        action={<Button type="button" onClick={openCreateUser}><UserPlus data-icon="inline-start" />Create user</Button>}
      />

      {notice ? <p role="status" className="-mt-2 text-sm text-primary">{notice}</p> : null}

      <section aria-labelledby="platform-organization-users-heading" className="space-y-4">
        <h2 id="platform-organization-users-heading" className="text-base font-semibold tracking-tight">Users</h2>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Label htmlFor="platform-organization-user-search" className="sr-only">Search users</Label>
          <Input
            id="platform-organization-user-search"
            type="search"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder="Search users…"
            aria-label="Search users"
            className="pl-9"
          />
        </div>

        <Card className="nexdrive-user-cards gap-0 py-0">
          <CardContent className="p-0">
            {filteredUsers.length ? (
              <>
                <div className="hidden xl:block">
                  <Table className="table-fixed" containerClassName="overflow-x-hidden">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[13%] overflow-hidden text-ellipsis">Name</TableHead>
                        <TableHead className="w-[22%] overflow-hidden text-ellipsis">Email address</TableHead>
                        <TableHead className="w-[16%] overflow-hidden text-ellipsis">Role</TableHead>
                        <TableHead className="w-[15%] overflow-hidden text-ellipsis">Status</TableHead>
                        <TableHead className="w-[12%] overflow-hidden text-ellipsis">Access</TableHead>
                        <TableHead className="w-[22%] overflow-hidden text-ellipsis text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleUsers.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell className="max-w-0 overflow-hidden font-medium">
                            <Link href={`/platform/users/${encodeURIComponent(user.id)}`} className="block max-w-[16ch] truncate hover:underline" title={user.name} data-no-translate>{user.name}</Link>
                          </TableCell>
                          <TableCell className="max-w-0 overflow-hidden" data-no-translate><span className="block max-w-[24ch] truncate" title={user.email}>{user.email}</span></TableCell>
                          <TableCell className="max-w-0 overflow-hidden"><Badge variant="outline" className="max-w-full truncate" title={roleLabels[user.role] ?? user.role}>{roleLabels[user.role] ?? user.role}</Badge></TableCell>
                          <TableCell className="max-w-0 overflow-hidden">{presence(user)}</TableCell>
                          <TableCell className="max-w-0 overflow-hidden">{access(user)}</TableCell>
                          <TableCell className="max-w-0 overflow-hidden text-right">
                            <Button type="button" variant="destructive" size="sm" disabled={user.id === currentUserId} onClick={() => openDeleteUser(user)}>
                              <Trash2 data-icon="inline-start" />Delete account
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="nexdrive-mobile-list xl:hidden">
                  {visibleUsers.map((user) => (
                    <article key={user.id} className="min-w-0 space-y-3">
                      <Link href={`/platform/users/${encodeURIComponent(user.id)}`} className="block min-w-0 break-words font-semibold hover:underline" title={user.name} data-no-translate>{user.name}</Link>
                      <p className="break-all text-sm leading-relaxed text-muted-foreground" data-no-translate>{user.email}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{roleLabels[user.role] ?? user.role}</Badge>
                        {presence(user)}
                      </div>
                      <div className="flex items-center justify-between gap-3 border-t pt-3">
                        <span className="text-xs font-medium text-muted-foreground">Account access</span>
                        {access(user)}
                      </div>
                      <div className="flex justify-end">
                        <Button type="button" variant="destructive" size="sm" disabled={user.id === currentUserId} onClick={() => openDeleteUser(user)}>
                          <Trash2 data-icon="inline-start" />Delete account
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center px-4 py-10 text-center">
                <UsersRound className="size-7 text-muted-foreground/50" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">{users.length ? "No users match your search." : "No users are associated with this organization."}</p>
                {users.length ? <p className="mt-1 text-sm text-muted-foreground">Try another name, email address, or role.</p> : <Button className="mt-4" onClick={openCreateUser}><UserPlus data-icon="inline-start" />Create first user</Button>}
              </div>
            )}
            <DataTablePagination page={currentPage} total={filteredUsers.length} onPageChange={setPage} noun="users" />
          </CardContent>
        </Card>
      </section>

      <Dialog open={createUserOpen} onOpenChange={(open) => { if (!createBusy) { setCreateUserOpen(open); if (!open) { setCreateError(""); setNewUserPassword(""); setPasswordConfirmation(""); } } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <form onSubmit={createUser}>
            <DialogHeader>
              <DialogTitle>Create user account</DialogTitle>
              <DialogDescription>This creates an account and an enabled membership in this organization. The user must verify their email before they can sign in. Share the initial password through a secure channel.</DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="space-y-2"><Label htmlFor="platform-new-user-name">Full name</Label><Input id="platform-new-user-name" autoComplete="name" maxLength={120} required value={newUserName} onChange={(event) => setNewUserName(event.target.value)} disabled={createBusy} /></div>
              <div className="space-y-2"><Label htmlFor="platform-new-user-email">Email address</Label><Input id="platform-new-user-email" type="email" autoComplete="email" maxLength={254} required value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} disabled={createBusy} /></div>
              <div className="space-y-2"><Label htmlFor="platform-new-user-role">Organization role</Label><Select value={newUserRole} onValueChange={(value) => { if (value) setNewUserRole(value as AppRole); }} disabled={createBusy}><SelectTrigger id="platform-new-user-role"><SelectValue /></SelectTrigger><SelectContent>{roles.map((role) => <SelectItem key={role} value={role}>{roleLabels[role]}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor="platform-new-user-password">Initial password</Label><Input id="platform-new-user-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} disabled={createBusy} aria-describedby="platform-user-password-requirements" /></div>
              <div className="space-y-2"><Label htmlFor="platform-new-user-password-confirm">Confirm initial password</Label><Input id="platform-new-user-password-confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} disabled={createBusy} aria-describedby="platform-user-password-requirements" /></div>
              <div id="platform-user-password-requirements" className="rounded-lg border border-border bg-muted/30 px-4 py-3" aria-live="polite">
                <p className="text-sm font-medium text-foreground">Password requirements</p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  <li className={`flex items-center gap-2 ${validPasswordLength ? "text-primary" : "text-muted-foreground"}`}>{validPasswordLength ? <Check className="size-4 shrink-0" aria-hidden="true" /> : <Circle className="size-4 shrink-0" aria-hidden="true" />}<span>8 to 128 characters</span></li>
                  <li className={`flex items-center gap-2 ${passwordsMatch ? "text-primary" : "text-muted-foreground"}`}>{passwordsMatch ? <Check className="size-4 shrink-0" aria-hidden="true" /> : <Circle className="size-4 shrink-0" aria-hidden="true" />}<span>Passwords match</span></li>
                </ul>
              </div>
            </div>
            {createError ? <p role="alert" className="mt-3 text-sm text-destructive">{createError}</p> : null}
            <DialogFooter className="mt-5">
              <Button type="button" variant="outline" disabled={createBusy} onClick={() => setCreateUserOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createBusy || !validPasswordLength || !passwordsMatch}>{createBusy ? "Creating…" : "Create account"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !deleteBusy) { setDeleteTarget(null); setDeleteConfirmation(""); setDeleteError(""); } }}>
        <DialogContent>
          <form onSubmit={deleteUser}>
            <DialogHeader>
              <DialogTitle>Delete user account</DialogTitle>
              <DialogDescription>
                This removes sign-in access, email, credentials, and personal documents. Organization memberships become disabled and anonymous so fleet history keeps its actor references. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-2">
              <Label htmlFor="delete-platform-user-confirmation">Type the email address to confirm</Label>
              <Input id="delete-platform-user-confirmation" type="email" autoComplete="off" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} disabled={deleteBusy} required />
              <p className="text-sm text-muted-foreground">{deleteTarget?.email}</p>
            </div>
            {deleteError ? <p className="mt-3 text-sm text-destructive" role="alert">{deleteError}</p> : null}
            <DialogFooter className="mt-5">
              <Button type="button" variant="outline" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={deleteBusy || deleteConfirmation !== deleteTarget?.email}>
                <Trash2 data-icon="inline-start" />{deleteBusy ? "Deleting…" : "Delete account everywhere"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
    </PlatformShell>
  );
}
