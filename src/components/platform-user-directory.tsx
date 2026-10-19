"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Search, Trash2 } from "lucide-react";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PlatformHeader } from "@/components/platform-header";
import { PlatformShell } from "@/components/platform-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import { formatPlatformDate } from "@/lib/platform-date";

type UserMembership = {
  organizationId: string;
  organizationName: string;
  role: string;
  disabledAt: string | null;
};

type PlatformUser = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  emailVerified: boolean;
  accountDisabledAt: string | null;
  lastSeenAt: string | null;
  platformAdministrator: boolean;
  memberships: UserMembership[];
};

const roleLabels: Record<string, string> = {
  administrator: "Administrator",
  fleet_manager: "Fleet Manager",
  manager: "Manager",
  driver: "Driver",
};

function accountStatus(user: PlatformUser) {
  if (user.accountDisabledAt) return <Badge variant="secondary">Disabled</Badge>;
  const label = user.emailVerified ? "Verified" : "Pending verification";
  return <Badge variant={user.emailVerified ? "outline" : "secondary"} className="max-w-full truncate" title={label}>{label}</Badge>;
}

function organizationList(user: PlatformUser) {
  if (!user.memberships.length) {
    return <Badge variant="secondary">No organization</Badge>;
  }

  return (
    <ul className="space-y-1.5">
      {user.memberships.map((membership) => (
        <li key={membership.organizationId} className="min-w-0">
          <span className="block max-w-[24ch] truncate font-medium" title={membership.organizationName} data-no-translate>{membership.organizationName}</span>
          <span className="block max-w-[22ch] truncate text-xs text-muted-foreground" title={`${roleLabels[membership.role] ?? membership.role}${membership.disabledAt ? " · Suspended" : ""}`}>
            {roleLabels[membership.role] ?? membership.role}{membership.disabledAt ? " · Suspended" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PlatformUserDirectory({ initialUsers, currentUserId }: { initialUsers: PlatformUser[]; currentUserId: string }) {
  const [users, setUsers] = useState(initialUsers);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<PlatformUser | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [notice, setNotice] = useState("");

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? users.filter((user) => {
        const membershipText = user.memberships
          .map((membership) => `${membership.organizationName} ${roleLabels[membership.role] ?? membership.role}`)
          .join(" ");
        return `${user.name} ${user.email} ${membershipText}`.toLocaleLowerCase().includes(query);
      })
      : users;
  }, [users, search]);
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleUsers = filteredUsers.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE);

  async function deleteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteTarget || confirmation !== deleteTarget.email) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/platform/users/${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: confirmation }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The user account could not be deleted.");
      setUsers((current) => current.filter((user) => user.id !== deleteTarget.id));
      setNotice(`The account for ${deleteTarget.email} was deleted. Sign-in access was removed and membership details were anonymized.`);
      setDeleteTarget(null);
      setConfirmation("");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "The user account could not be deleted.");
    } finally {
      setDeleteBusy(false);
    }
  }

  function openDelete(user: PlatformUser) {
    setNotice("");
    setDeleteError("");
    setConfirmation("");
    setDeleteTarget(user);
  }

  return (
    <PlatformShell active="users">
      <main className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-8 sm:px-6 lg:py-10">
        <PlatformHeader
          title="Users"
          description="All NexDrive accounts, including users who have not joined an organization."
        />

        {notice ? <p role="status" className="-mt-2 text-sm text-primary">{notice}</p> : null}

        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Label htmlFor="platform-user-search" className="sr-only">Search all users</Label>
          <Input
            id="platform-user-search"
            type="search"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder="Search name, email, or organization…"
            aria-label="Search all users"
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
                        <TableHead className="w-[20%] overflow-hidden text-ellipsis">Email address</TableHead>
                        <TableHead className="w-[21%] overflow-hidden text-ellipsis">Organizations</TableHead>
                        <TableHead className="w-[16%] overflow-hidden text-ellipsis">Account status</TableHead>
                        <TableHead className="w-[10%] overflow-hidden text-ellipsis">Created</TableHead>
                        <TableHead className="w-[20%] overflow-hidden text-ellipsis text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleUsers.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell className="max-w-0 overflow-hidden font-medium">
                            <Link href={`/platform/users/${encodeURIComponent(user.id)}`} className="block max-w-[16ch] truncate hover:underline" title={user.name} data-no-translate>{user.name}</Link>
                            {user.platformAdministrator ? <Badge variant="outline" className="mt-1">Platform administrator</Badge> : null}
                          </TableCell>
                          <TableCell className="max-w-0 overflow-hidden" data-no-translate><span className="block max-w-[24ch] truncate" title={user.email}>{user.email}</span></TableCell>
                          <TableCell className="max-w-0 overflow-hidden whitespace-normal"><div className="min-w-0 max-w-full overflow-hidden">{organizationList(user)}</div></TableCell>
                          <TableCell className="max-w-0 overflow-hidden">{accountStatus(user)}</TableCell>
                          <TableCell className="max-w-0 overflow-hidden"><span className="block max-w-[12ch] truncate" title={formatPlatformDate(user.createdAt)}>{formatPlatformDate(user.createdAt)}</span></TableCell>
                          <TableCell className="max-w-0 overflow-hidden text-right">
                            <Button type="button" variant="destructive" size="sm" disabled={user.id === currentUserId} onClick={() => openDelete(user)}>
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
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/platform/users/${encodeURIComponent(user.id)}`} className="block min-w-0 break-words font-semibold hover:underline" title={user.name} data-no-translate>{user.name}</Link>
                        {user.platformAdministrator ? <Badge variant="outline">Platform administrator</Badge> : null}
                      </div>
                      <p className="break-all text-sm leading-relaxed text-muted-foreground" data-no-translate>{user.email}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        {accountStatus(user)}
                        <span className="text-xs text-muted-foreground">Created {formatPlatformDate(user.createdAt)}</span>
                      </div>
                      <div className="space-y-2 border-t pt-3">
                        <p className="text-xs font-medium text-muted-foreground">Organizations</p>
                        {organizationList(user)}
                      </div>
                      <div className="flex justify-end border-t pt-3">
                        <Button type="button" variant="destructive" size="sm" disabled={user.id === currentUserId} onClick={() => openDelete(user)}>
                          <Trash2 data-icon="inline-start" />Delete account
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
                <DataTablePagination page={currentPage} total={filteredUsers.length} onPageChange={setPage} noun="users" />
              </>
            ) : (
              <Empty className="min-h-48 border-0">
                <EmptyHeader>
                  <EmptyTitle>{users.length ? "No matching users" : "No user accounts yet"}</EmptyTitle>
                  <EmptyDescription>
                    {users.length ? "Try another name, email address, or organization." : "Accounts will appear here when people sign up or are added to an organization."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>

        <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !deleteBusy) { setDeleteTarget(null); setConfirmation(""); setDeleteError(""); } }}>
          <DialogContent>
            <form onSubmit={deleteUser}>
              <DialogHeader>
                <DialogTitle>Delete user account</DialogTitle>
                <DialogDescription>
                  This removes sign-in access, email, credentials, and personal documents. Organization memberships become disabled and anonymous so fleet history keeps its actor references. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-2">
                <Label htmlFor="platform-directory-delete-confirmation">Type the email address to confirm</Label>
                <Input id="platform-directory-delete-confirmation" type="email" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={deleteBusy} required />
                <p className="text-sm text-muted-foreground">{deleteTarget?.email}</p>
              </div>
              {deleteError ? <p className="mt-3 text-sm text-destructive" role="alert">{deleteError}</p> : null}
              <DialogFooter className="mt-5">
                <Button type="button" variant="outline" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>Cancel</Button>
                <Button type="submit" variant="destructive" disabled={deleteBusy || confirmation !== deleteTarget?.email}>
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
