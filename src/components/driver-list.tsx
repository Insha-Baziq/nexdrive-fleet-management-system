"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/locale-provider";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { flexRender, getCoreRowModel, getPaginationRowModel, useReactTable } from "@tanstack/react-table";
import { Eye, Search, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DriverFormDialog } from "@/components/driver-form-dialog";
import { DriverImportDialog } from "@/components/driver-import-dialog";
import { RecordArchiveAction } from "@/components/record-archive-action";
import type { Driver, EligibleDriverUser } from "@/lib/drivers";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";

function hasIncompletePersonalDetails(driver: Driver) {
  return !driver.date_of_birth || !driver.street_number || !driver.street_name || !driver.postal_code || !driver.city;
}

export function licenceExpiry(value: string | null, french = false) {
  if (!value) return <span className="text-muted-foreground">{french ? "Non renseignée" : "Not set"}</span>;
  const label = new Intl.DateTimeFormat(french ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
  const days = Math.ceil((Date.parse(`${value}T00:00:00Z`) - Date.now()) / 86400000);
  if (days < 0) return <Badge variant="destructive" className="h-auto rounded-sm px-1.5 py-0.5">{french ? "Expiré" : "Expired"} · {label}</Badge>;
  if (days < 30) return <Badge variant="outline" className="h-auto rounded-sm border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">{label}</Badge>;
  return <span className="tabular-nums">{label}</span>;
}

function driverColumns(eligibleUsers: EligibleDriverUser[], canEdit: boolean, view: "active" | "archived", french: boolean): ColumnDef<Driver>[] { return [
  {
    accessorKey: "full_name", header: french ? "Nom" : "Name",
    cell: ({ row }) => <div className="flex flex-wrap items-center gap-2">
      <Link href={`/drivers/${row.original.id}${view === "archived" ? "?view=archived" : ""}`} className="font-medium text-foreground underline-offset-4 hover:underline">{row.original.full_name}</Link>
      {hasIncompletePersonalDetails(row.original) && <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-200">{french ? "Informations à compléter" : "Details incomplete"}</Badge>}
    </div>,
  },
  {
    accessorKey: "licence_number", header: french ? "Numéro de permis" : "Licence number",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.licence_number || "—"}</span>,
  },
  {
    accessorKey: "licence_expiry_date", header: french ? "Expiration du permis" : "Licence expiry",
    cell: ({ row }) => licenceExpiry(row.original.licence_expiry_date, french),
  },
  {
    id: "current_vehicle", header: french ? "Véhicule actuel" : "Current vehicle",
    cell: ({ row }) => row.original.current_vehicle_id
      ? <Link href={`/vehicles/${row.original.current_vehicle_id}`} className="font-mono text-xs text-foreground underline-offset-4 hover:underline">{row.original.current_vehicle_registration}</Link>
      : <span className="text-muted-foreground">{french ? "Non attribué" : "Unassigned"}</span>,
  },
  {
    id: "actions", header: () => <span className="block text-right">{french ? "Actions" : "Actions"}</span>,
    cell: ({ row }) => <div className="flex items-center justify-end gap-1">
      {canEdit && !row.original.archived_at && <DriverFormDialog driver={row.original} eligibleUsers={eligibleUsers} compact />}
      <Button nativeButton={false} render={<Link href={`/drivers/${row.original.id}${view === "archived" ? "?view=archived" : ""}`} aria-label={french ? `Voir le dossier du conducteur ${row.original.full_name}` : `View details for driver ${row.original.full_name}`} title={french ? `Voir le dossier de ${row.original.full_name}` : `View details for ${row.original.full_name}`} />} variant="ghost" size="icon"><Eye /></Button>
      {canEdit && <RecordArchiveAction kind="driver" id={row.original.id} name={row.original.full_name} archived={Boolean(row.original.archived_at)} compact />}
    </div>,
  },
]; }

function DriverTable({ drivers, emptyTitle, eligibleUsers, canEdit, view, french }: { drivers: Driver[]; emptyTitle: string; eligibleUsers: EligibleDriverUser[]; canEdit: boolean; view: "active" | "archived"; french: boolean }) {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: TABLE_PAGE_SIZE });
  const columns = useMemo(() => driverColumns(eligibleUsers, canEdit, view, french), [eligibleUsers, canEdit, view, french]);
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: drivers, columns, getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(), onPaginationChange: setPagination,
    state: { pagination },
  });
  const rows = table.getRowModel().rows;
  const pageIndex = table.getState().pagination.pageIndex;

  if (!drivers.length) return (
    <Empty className="min-h-[200px] rounded-none border-0 bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon"><UsersRound /></EmptyMedia>
        <EmptyTitle>{emptyTitle}</EmptyTitle>
        <EmptyDescription>{french ? "Les dossiers correspondant à cette vue apparaîtront ici." : "Driver records that match this view will appear here."}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );

  return <>
    <div className="hidden xl:block">
      <Table>
        <TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id}>
          {group.headers.map((header) => <TableHead key={header.id} className={`h-14 text-muted-foreground first:pl-5 last:pr-5 ${header.id === "actions" ? "w-48 min-w-48 max-w-48" : ""}`}>
            {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
          </TableHead>)}
        </TableRow>)}</TableHeader>
        <TableBody>{rows.map((row) => <TableRow key={row.id} className="h-16">
          {row.getVisibleCells().map((cell) => <TableCell key={cell.id} className={`first:pl-5 last:pr-5 ${cell.column.id === "actions" ? "w-48 min-w-48 max-w-48" : ""}`}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>)}
        </TableRow>)}</TableBody>
      </Table>
    </div>
    <div className="nexdrive-mobile-list xl:hidden">
      {rows.map(({ original: driver }) => <article key={driver.id} className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/drivers/${driver.id}${view === "archived" ? "?view=archived" : ""}`} className="min-w-0 break-words text-base font-semibold tracking-tight">{driver.full_name}</Link>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            {hasIncompletePersonalDetails(driver) && <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200">{french ? "Informations à compléter" : "Details incomplete"}</Badge>}
            {driver.archived_at && <Badge variant="outline">{french ? "Archivé" : "Archived"}</Badge>}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-muted/40 p-3 text-sm">
          <div className="min-w-0"><dt className="text-xs text-muted-foreground">{french ? "Véhicule actuel" : "Current vehicle"}</dt><dd className="mt-0.5 break-words font-medium">{driver.current_vehicle_registration || (french ? "Non attribué" : "Unassigned")}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-muted-foreground">{french ? "Expiration du permis" : "Licence expiry"}</dt><dd className="mt-0.5 font-medium">{licenceExpiry(driver.licence_expiry_date, french)}</dd></div>
          <div className="col-span-2 min-w-0"><dt className="text-xs text-muted-foreground">{french ? "Numéro de permis" : "Licence number"}</dt><dd className="mt-0.5 break-all font-mono text-xs font-medium">{driver.licence_number || "—"}</dd></div>
        </dl>
        <div className="nexdrive-mobile-actions mt-4 flex items-center gap-2 border-t pt-3">
          <Button nativeButton={false} render={<Link href={`/drivers/${driver.id}${view === "archived" ? "?view=archived" : ""}`} aria-label={french ? `Voir le dossier du conducteur ${driver.full_name}` : `View details for driver ${driver.full_name}`} />} variant="outline" size="sm" className="min-w-0 flex-1 justify-center">{french ? "Voir le dossier" : "View details"} <Eye /></Button>
          {canEdit && !driver.archived_at && <DriverFormDialog driver={driver} eligibleUsers={eligibleUsers} compact />}
          {canEdit && <RecordArchiveAction kind="driver" id={driver.id} name={driver.full_name} archived={Boolean(driver.archived_at)} compact />}
        </div>
      </article>)}
    </div>
    <DataTablePagination page={pageIndex + 1} total={drivers.length} noun={drivers.length === 1 ? "driver" : "drivers"} onPageChange={(nextPage) => table.setPageIndex(nextPage - 1)} />
  </>;
}

export function DriverList({ drivers, eligibleUsers, canEdit, canImport = false, view = "active" }: { drivers: Driver[]; eligibleUsers: EligibleDriverUser[]; canEdit: boolean; canImport?: boolean; view?: "active" | "archived" }) {
  const { locale } = useLocale();
  const french = locale === "fr";
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const matches = drivers.filter((driver) =>
    `${driver.full_name} ${driver.licence_number ?? ""} ${driver.current_vehicle_registration ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return <main className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-7 sm:px-6">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{french ? "Conducteurs" : "Drivers"}</h1>{view === "archived" && <Badge variant="outline">{french ? "Dossiers archivés" : "Archived records"}</Badge>}</div><p className="mt-1 text-sm text-muted-foreground">{view === "archived" ? french ? "Les dossiers archivés conservent leur historique et leurs documents." : "Archived drivers keep their history and documents." : french ? "Gérez les dossiers des conducteurs actifs de votre flotte." : "Manage your fleet’s active driver records."}</p></div>
      <div className="grid w-full grid-cols-1 gap-2 min-[330px]:grid-cols-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
        {canEdit && <Button nativeButton={false} render={<Link href={view === "archived" ? "/drivers" : "/drivers?view=archived"} />} variant="outline" size="sm">{view === "archived" ? french ? "Conducteurs actifs" : "Active drivers" : french ? "Conducteurs archivés" : "Archived drivers"}</Button>}
        {canImport && view === "active" && <DriverImportDialog />}
        {canEdit && view === "active" && <DriverFormDialog eligibleUsers={eligibleUsers} onSaved={() => setNotice(french ? "Conducteur enregistré." : "Driver saved successfully.")} />}
      </div>
    </div>
    {notice && <div role="status" className="mb-5 rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">{notice}</div>}
    <div className="relative mb-4 w-full sm:w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={french ? "Rechercher un conducteur" : "Search drivers"} aria-label={french ? "Rechercher un conducteur" : "Search drivers"} className="h-9 rounded-md pl-9" />
    </div>
    <Card className="nexdrive-wide-cards w-full gap-0 py-0"><DriverTable key={`${query.trim().toLowerCase()}:${view}`} drivers={matches} eligibleUsers={eligibleUsers} canEdit={canEdit} view={view} french={french} emptyTitle={query ? french ? "Aucun conducteur correspondant" : "No matching drivers" : view === "archived" ? french ? "Aucun conducteur archivé" : "No archived drivers" : french ? "Aucun conducteur pour le moment" : "No drivers yet"} /></Card>
  </main>;
}
