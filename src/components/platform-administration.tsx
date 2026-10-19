"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Plus, Trash2, UsersRound } from "lucide-react";
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

export function PlatformAdministration({ initialOrganizations }: { initialOrganizations: Organization[] }) {
  const router = useRouter();
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deleteOrganization, setDeleteOrganization] = useState<Organization | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [createOrganizationOpen, setCreateOrganizationOpen] = useState(false);
  const [newOrganizationName, setNewOrganizationName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const filteredOrganizations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return organizations;
    return organizations.filter((organization) =>
      organization.name.toLowerCase().includes(query)
      || organization.users.some((user) => user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query)),
    );
  }, [organizations, search]);
  const pageCount = Math.max(1, Math.ceil(filteredOrganizations.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleOrganizations = filteredOrganizations.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE);

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError("");
    try {
      const response = await fetch("/api/platform/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationName: newOrganizationName }),
      });
      const result = await response.json() as { organization?: { id: string }; error?: string };
      if (!response.ok || !result.organization) throw new Error(result.error || "The organization could not be created.");
      setCreateOrganizationOpen(false);
      setNewOrganizationName("");
      router.push(`/platform/organizations/${encodeURIComponent(result.organization.id)}`);
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : "The organization could not be created.");
    } finally {
      setCreateBusy(false);
    }
  }

  function openOrganization(organizationId: string) {
    router.push(`/platform/organizations/${encodeURIComponent(organizationId)}`);
  }

  async function confirmDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteOrganization || confirmation !== deleteOrganization.name) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/platform/organizations/${encodeURIComponent(deleteOrganization.id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationName: confirmation }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The organization could not be deleted.");
      setOrganizations((current) => current.filter((organization) => organization.id !== deleteOrganization.id));
      setDeleteOrganization(null);
      setConfirmation("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The organization could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  function deleteButton(organization: Organization) {
    return (
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={(event) => {
          event.stopPropagation();
          setDeleteOrganization(organization);
          setConfirmation("");
          setError("");
        }}
      >
        <Trash2 data-icon="inline-start" /> Delete
      </Button>
    );
  }

  function administratorNames(organization: Organization) {
    const administrators = organization.users.filter((user) => user.role === "administrator");
    if (!administrators.length) return <span className="text-muted-foreground">No administrator</span>;
    return <div className="min-w-0 space-y-1">{administrators.map((user) => <div key={user.id} className="min-w-0"><span className="block max-w-[22ch] truncate font-medium" title={user.name}>{user.name}</span><span className="block max-w-[26ch] truncate text-xs text-muted-foreground" title={user.email}>{user.email}</span></div>)}</div>;
  }

  return (
    <PlatformShell active="organizations">
    <main className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:py-10">
      <PlatformHeader
        title="Organizations"
        description="Organizations, administrator accounts, and members."
        action={<Button type="button" onClick={() => { setCreateOrganizationOpen(true); setCreateError(""); }}><Plus data-icon="inline-start" />Create organization</Button>}
      />

      <div className="mb-4 w-full sm:max-w-sm">
        <Label htmlFor="platform-organization-search" className="sr-only">Search organizations and users</Label>
        <Input
          id="platform-organization-search"
          type="search"
          value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(1); }}
          placeholder="Search organizations or users"
          aria-label="Search organizations or users"
        />
      </div>

      {!filteredOrganizations.length ? (
        <Card>
          <CardContent className="p-0">
            <Empty className="min-h-48 border-0">
              <EmptyHeader>
                <EmptyTitle>{organizations.length ? "No matching organizations" : "No organizations yet"}</EmptyTitle>
                <EmptyDescription>{organizations.length ? "Try another organization or user name." : "Organizations will appear here when they are created."}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="hidden xl:block">
                <Table className="table-fixed" containerClassName="overflow-x-hidden">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[26%] overflow-hidden text-ellipsis">Organization</TableHead>
                      <TableHead className="w-[32%] overflow-hidden text-ellipsis">Administrator account</TableHead>
                      <TableHead className="w-[8%] overflow-hidden text-ellipsis">Users</TableHead>
                      <TableHead className="w-[14%] overflow-hidden text-ellipsis">Created</TableHead>
                      <TableHead className="w-[20%] overflow-hidden text-ellipsis text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleOrganizations.map((organization) => (
                      <TableRow
                        key={organization.id}
                        className="cursor-pointer"
                        onClick={() => openOrganization(organization.id)}
                      >
                        <TableCell className="max-w-0 overflow-hidden whitespace-normal">
                          <Link
                            href={`/platform/organizations/${encodeURIComponent(organization.id)}`}
                            className="block max-w-[28ch] truncate font-medium hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title={organization.name}
                            onClick={(event) => event.stopPropagation()}
                          >
                            {organization.name}
                          </Link>
                          <span className="block max-w-[32ch] truncate text-xs text-muted-foreground" title={`${organization.countryCode} · ${organization.timezone} · ${organization.currencyCode}`}>{organization.countryCode} · {organization.timezone} · {organization.currencyCode}</span>
                        </TableCell>
                        <TableCell className="max-w-0 overflow-hidden whitespace-normal">{administratorNames(organization)}</TableCell>
                        <TableCell className="max-w-0 overflow-hidden">{organization.users.length}</TableCell>
                        <TableCell className="max-w-0 overflow-hidden"><span className="block max-w-[12ch] truncate" title={formatPlatformDate(organization.createdAt)}>{formatPlatformDate(organization.createdAt)}</span></TableCell>
                        <TableCell className="max-w-0 overflow-hidden text-right">{deleteButton(organization)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-3 p-3 xl:hidden">
                {visibleOrganizations.map((organization) => (
                  <article
                    key={organization.id}
                    className="cursor-pointer rounded-lg border p-3"
                    onClick={() => openOrganization(organization.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Building2 className="size-4" /></div>
                      <div className="min-w-0 flex-1">
                          <h2 className="break-words font-medium"><Link href={`/platform/organizations/${encodeURIComponent(organization.id)}`} className="hover:underline" onClick={(event) => event.stopPropagation()}>{organization.name}</Link></h2>
                        <p className="break-words text-xs text-muted-foreground">{organization.countryCode} · {organization.timezone} · {organization.currencyCode}</p>
                      </div>
                      <Badge variant="outline"><UsersRound className="mr-1 size-3" />{organization.users.length}</Badge>
                    </div>
                    <div className="mt-3 border-t pt-3">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Administrator account</p>
                      {administratorNames(organization)}
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">Created {formatPlatformDate(organization.createdAt)}</p>
                    <div className="mt-3">{deleteButton(organization)}</div>
                  </article>
                ))}
              </div>
              <DataTablePagination page={currentPage} total={filteredOrganizations.length} onPageChange={setPage} noun="organizations" />
            </CardContent>
          </Card>

        </>
      )}

      <Dialog open={Boolean(deleteOrganization)} onOpenChange={(open) => { if (!open && !busy) { setDeleteOrganization(null); setConfirmation(""); setError(""); } }}>
        <DialogContent>
          <form onSubmit={confirmDeletion}>
            <DialogHeader>
              <DialogTitle>Delete organization</DialogTitle>
              <DialogDescription>
                This permanently removes <strong>{deleteOrganization?.name}</strong>, its data, memberships, and stored files. User accounts and their sign-in credentials remain. Users without another organization will see the workspace welcome screen.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-2">
              <Label htmlFor="delete-organization-confirmation">Type the organization name to confirm</Label>
              <Input
                id="delete-organization-confirmation"
                autoComplete="off"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={busy}
                required
              />
            </div>
            {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
            <DialogFooter className="mt-5">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setDeleteOrganization(null)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={busy || confirmation !== deleteOrganization?.name}>
                <Trash2 data-icon="inline-start" />{busy ? "Deleting…" : "Delete organization"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={createOrganizationOpen} onOpenChange={(open) => { if (!createBusy) { setCreateOrganizationOpen(open); if (!open) { setNewOrganizationName(""); setCreateError(""); } } }}>
        <DialogContent>
          <form onSubmit={createOrganization}>
            <DialogHeader>
              <DialogTitle>Create organization</DialogTitle>
              <DialogDescription>Create an empty organization, then add its administrator and members from the organization detail page. New organizations use the supported France settings.</DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-2">
              <Label htmlFor="new-platform-organization-name">Organization name</Label>
              <Input id="new-platform-organization-name" autoComplete="organization" maxLength={120} required value={newOrganizationName} onChange={(event) => setNewOrganizationName(event.target.value)} disabled={createBusy} />
              <p className="text-xs text-muted-foreground">France · Europe/Paris · EUR</p>
            </div>
            {createError ? <p className="mt-3 text-sm text-destructive" role="alert">{createError}</p> : null}
            <DialogFooter className="mt-5">
              <Button type="button" variant="outline" disabled={createBusy} onClick={() => setCreateOrganizationOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createBusy || !newOrganizationName.trim()}>{createBusy ? "Creating…" : "Create organization"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
    </PlatformShell>
  );
}
