"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { flexRender, getCoreRowModel, getPaginationRowModel, useReactTable } from "@tanstack/react-table";
import { CarFront, Eye, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale } from "@/components/locale-provider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VehicleFormDialog } from "@/components/vehicle-form-dialog";
import { VehicleImportDialog } from "@/components/vehicle-import-dialog";
import { RecordArchiveAction } from "@/components/record-archive-action";
import type { Vehicle } from "@/lib/vehicles";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";

function dateLabel(value: string | null, locale: "fr" | "en") {
  if (!value) return locale === "fr" ? "Non renseigné" : "Not set";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

function dateTone(value: string | null) {
  if (!value) return "text-muted-foreground";
  const days = Math.ceil((Date.parse(`${value}T00:00:00Z`) - Date.now()) / 86400000);
  if (days < 0) return "text-destructive";
  if (days <= 30) return "text-amber-700 dark:text-amber-300";
  return "text-foreground";
}

function mileageLabel(value: number | null, locale: "fr" | "en") {
  return value === null ? (locale === "fr" ? "Aucun relevé" : "No reading") : `${value.toLocaleString(locale === "fr" ? "fr-FR" : "en-GB")} km`;
}

function vehicleName(vehicle: Vehicle) {
  return [vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Make/model not set";
}

const insuranceStatusLabels: Record<Vehicle["insurance_status"], string> = {
  to_complete: "À compléter", insured: "Assuré", suspended: "Suspendu", unpaid: "Impayé",
};

function vehicleColumns(canEdit: boolean, view: "active" | "archived", locale: "fr" | "en"): ColumnDef<Vehicle>[] { return [
  {
    accessorKey: "registration",
    header: "Registration",
    cell: ({ row }) => (
      <Link href={`/vehicles/${row.original.id}${view === "archived" ? "?view=archived" : ""}`} className="font-medium text-foreground underline-offset-4 hover:underline">
        {row.original.registration}
      </Link>
    ),
  },
  {
    id: "vehicle",
    header: "Vehicle",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{vehicleName(row.original)}</span>
        <span className="text-xs text-muted-foreground">{row.original.year ?? "Year not set"}{!row.original.ownership_type ? " · Propriété à compléter" : ""}</span>
      </div>
    ),
  },
  {
    accessorKey: "current_mileage",
    header: "Mileage",
    cell: ({ row }) => <span className="tabular-nums">{mileageLabel(row.original.current_mileage, locale)}</span>,
  },
  {
    id: "driver",
    header: "Current driver",
    cell: ({ row }) => row.original.current_driver_name
      ? <span className="text-foreground">{row.original.current_driver_name}</span>
      : <span className="text-muted-foreground">Unassigned</span>,
  },
  {
    accessorKey: "technical_inspection_date",
    header: "Technical inspection",
    cell: ({ row }) => <span className={`tabular-nums ${dateTone(row.original.technical_inspection_date)}`}>{dateLabel(row.original.technical_inspection_date, locale)}</span>,
  },
  {
    accessorKey: "insurance_expiry_date",
    header: "Insurance expiry",
    cell: ({ row }) => <span className={`tabular-nums ${dateTone(row.original.insurance_expiry_date)}`}>{dateLabel(row.original.insurance_expiry_date, locale)}</span>,
  },
  {
    accessorKey: "insurance_status",
    header: "Assurance",
    cell: ({ row }) => <Badge variant="outline">{insuranceStatusLabels[row.original.insurance_status]}</Badge>,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => row.original.archived_at
      ? <Badge variant="outline" className="h-auto rounded-sm px-1.5 py-0.5">Archived</Badge>
      : <Badge className="h-auto rounded-sm bg-primary/10 px-1.5 py-0.5 text-primary hover:bg-primary/10">{row.original.current_driver_id ? "Assigned" : "Available"}</Badge>,
  },
  {
    id: "actions",
    header: () => <span className="block text-right">Actions</span>,
    cell: ({ row }) => <div className="flex items-center justify-end gap-1">
      {canEdit && !row.original.archived_at && <VehicleFormDialog vehicle={row.original} compact />}
      <Button
        nativeButton={false}
        render={<Link href={`/vehicles/${row.original.id}${view === "archived" ? "?view=archived" : ""}`} aria-label={`View details for vehicle ${row.original.registration}`} title={`View details for ${row.original.registration}`} />}
        variant="ghost"
        size="icon"
      >
        <Eye />
      </Button>
      {canEdit && <RecordArchiveAction kind="vehicle" id={row.original.id} name={row.original.registration} archived={Boolean(row.original.archived_at)} compact />}
    </div>,
  },
]; }

function VehicleTable({ vehicles, emptyTitle, canEdit, view }: { vehicles: Vehicle[]; emptyTitle: string; canEdit: boolean; view: "active" | "archived" }) {
  const { locale } = useLocale();
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: TABLE_PAGE_SIZE });
  const columns = useMemo(() => vehicleColumns(canEdit, view, locale), [canEdit, view, locale]);
  // TanStack Table owns pagination state so the rendered rows and page controls stay in sync.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: vehicles,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onPaginationChange: setPagination,
    state: { pagination },
  });
  const rows = table.getRowModel().rows;
  const pageIndex = table.getState().pagination.pageIndex;

  if (!vehicles.length) {
    return (
      <Empty className="min-h-[200px] rounded-none border-0 bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon"><CarFront /></EmptyMedia>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>Vehicle records that match this view will appear here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <div className="hidden xl:block">
        <Table className="min-w-[1080px]">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className={`h-14 text-muted-foreground first:pl-5 last:pr-5 ${header.id === "actions" ? "w-48 min-w-48 max-w-48" : ""}`}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="h-16">
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={`first:pl-5 last:pr-5 ${cell.column.id === "actions" ? "w-48 min-w-48 max-w-48" : ""}`}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="nexdrive-mobile-list xl:hidden">
        {rows.map(({ original: vehicle }) => (
          <article key={vehicle.id} className="min-w-0">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/vehicles/${vehicle.id}${view === "archived" ? "?view=archived" : ""}`} className="min-w-0">
                <div className="text-base font-semibold tracking-tight">{vehicle.registration}</div>
                <div className="mt-0.5 break-words text-sm text-muted-foreground">{vehicleName(vehicle)}{vehicle.year ? ` · ${vehicle.year}` : ""}{!vehicle.ownership_type ? " · Propriété à compléter" : ""}</div>
              </Link>
              {vehicle.archived_at
                ? <Badge variant="outline" className="h-auto rounded-sm px-1.5 py-0.5">Archived</Badge>
                : <Badge className="h-auto rounded-sm bg-primary/10 px-1.5 py-0.5 text-primary hover:bg-primary/10">{vehicle.current_driver_id ? "Assigned" : "Available"}</Badge>}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-muted/40 p-3 text-sm">
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Current driver</dt><dd className="mt-0.5 break-words font-medium">{vehicle.current_driver_name || "Unassigned"}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Mileage</dt><dd className="mt-0.5 font-medium tabular-nums">{mileageLabel(vehicle.current_mileage, locale)}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Inspection</dt><dd className={`mt-0.5 font-medium tabular-nums ${dateTone(vehicle.technical_inspection_date)}`}>{dateLabel(vehicle.technical_inspection_date, locale)}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Insurance expiry</dt><dd className={`mt-0.5 font-medium tabular-nums ${dateTone(vehicle.insurance_expiry_date)}`}>{dateLabel(vehicle.insurance_expiry_date, locale)}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Assurance</dt><dd className="mt-0.5 font-medium">{insuranceStatusLabels[vehicle.insurance_status]}</dd></div>
            </dl>
            <div className="nexdrive-mobile-actions mt-4 flex items-center gap-2 border-t pt-3">
              <Button nativeButton={false} render={<Link href={`/vehicles/${vehicle.id}${view === "archived" ? "?view=archived" : ""}`} />} variant="outline" size="sm" className="min-w-0 flex-1 justify-center">View details <Eye /></Button>
              {canEdit && !vehicle.archived_at && <VehicleFormDialog vehicle={vehicle} compact />}
              {canEdit && <RecordArchiveAction kind="vehicle" id={vehicle.id} name={vehicle.registration} archived={Boolean(vehicle.archived_at)} compact />}
            </div>
          </article>
        ))}
      </div>

      <DataTablePagination page={pageIndex + 1} total={vehicles.length} noun={vehicles.length === 1 ? "vehicle" : "vehicles"} onPageChange={(nextPage) => table.setPageIndex(nextPage - 1)} />
    </>
  );
}

export function VehicleList({ vehicles, canEdit, canImport = false, view = "active", attention = null, initialAvailability = "all" }: { vehicles: Vehicle[]; canEdit: boolean; canImport?: boolean; view?: "active" | "archived"; attention?: "inspection" | "insurance" | null; initialAvailability?: "all" | "available" }) {
  const { locale } = useLocale();
  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState<"all" | "available" | "assigned">(initialAvailability);
  const [notice, setNotice] = useState("");
  const matches = vehicles.filter((vehicle) =>
    `${vehicle.registration} ${vehicle.make} ${vehicle.model} ${vehicle.current_driver_name ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())
    && (view === "archived" || availability === "all" || (availability === "assigned") === Boolean(vehicle.current_driver_id)),
  );

  return (
    <main className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-7 sm:px-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">Vehicles</h1>{view === "archived" && <Badge variant="outline">Archived records</Badge>}</div>
          <p className="mt-1 text-sm text-muted-foreground">{view === "archived" ? "Archived vehicles keep their history and documents." : "Manage your fleet’s active vehicle records."}</p>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 min-[330px]:grid-cols-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          {canEdit && <Button nativeButton={false} render={<Link href={view === "archived" ? "/vehicles" : "/vehicles?view=archived"} />} variant="outline" size="sm">{view === "archived" ? "Active vehicles" : "Archived vehicles"}</Button>}
          {canImport && view === "active" && <VehicleImportDialog />}
          {canEdit && view === "active" && <VehicleFormDialog onSaved={() => setNotice("Vehicle saved successfully.")} />}
        </div>
      </div>

      {notice && <div role="status" className="mb-5 rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">{notice}</div>}
      {attention && <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm">
        <span>{attention === "inspection" ? "Véhicules dont le contrôle technique arrive à échéance ou est en retard" : "Véhicules dont l’assurance exige une attention"}</span>
        <Link href="/vehicles" className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Afficher tous les véhicules</Link>
      </div>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vehicles" aria-label="Search vehicles" className="h-9 rounded-md pl-9" />
        </div>
        {view === "active" && <Select value={availability} onValueChange={(value) => setAvailability((value ?? "all") as typeof availability)}>
          <SelectTrigger aria-label={locale === "fr" ? "Filtrer la disponibilité des véhicules" : "Filter vehicle availability"} className="h-9 w-full bg-background sm:w-40"><SelectValue>{(value: string) => locale === "fr" ? value === "available" ? "Disponible" : value === "assigned" ? "Affecté" : "Tous les véhicules" : value === "available" ? "Available" : value === "assigned" ? "Assigned" : "All vehicles"}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{locale === "fr" ? "Tous les véhicules" : "All vehicles"}</SelectItem>
            <SelectItem value="available">{locale === "fr" ? "Disponible" : "Available"}</SelectItem>
            <SelectItem value="assigned">{locale === "fr" ? "Affecté" : "Assigned"}</SelectItem>
          </SelectContent>
        </Select>}
      </div>

      <Card className="nexdrive-wide-cards w-full gap-0 py-0">
        <VehicleTable key={`${query.trim().toLowerCase()}:${availability}:${view}`} vehicles={matches} canEdit={canEdit} view={view} emptyTitle={query || (view === "active" && availability !== "all") ? "No matching vehicles" : view === "archived" ? "No archived vehicles" : "No vehicles yet"} />
      </Card>
    </main>
  );
}
