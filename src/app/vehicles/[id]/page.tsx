import Link from "next/link";
import { AssignmentHistoryTable } from "@/components/assignment-history-table";
import { VehicleDetailTabs } from "@/components/vehicle-detail-tabs";
import { VehicleDocumentsPanel } from "@/components/vehicle-documents-panel";
import { VehicleAnomaliesPanel } from "@/components/vehicle-anomalies-panel";
import { VehicleMileagePanel } from "@/components/vehicle-mileage-panel";
import { VehicleInsurancePanel } from "@/components/vehicle-insurance-panel";
import { VehicleInspectionsPanel } from "@/components/vehicle-inspections-panel";
import { VehicleMaintenancePanel } from "@/components/vehicle-maintenance-panel";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CarFront, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AssignmentDialog } from "@/components/assignment-dialog";
import { VehicleFormDialog } from "@/components/vehicle-form-dialog";
import { RecordArchiveAction } from "@/components/record-archive-action";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getOrganizationSession } from "@/lib/organization-session";
import { getVehicle } from "@/lib/vehicles";
import { listDrivers } from "@/lib/drivers";
import { listVehicleAssignmentHistory } from "@/lib/assignments";
import { listVehicleAnomalies } from "@/lib/anomalies";
import { listVehicleMileageReadings } from "@/lib/vehicle-mileage";
import { listVehicleInsuranceEvents } from "@/lib/insurance-events";
import { listVehicleInspections } from "@/lib/vehicle-inspections";

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ view?: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dateLabel(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b py-4 last:border-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

const ownershipLabels = {
  owned: "Véhicule appartenant à l'entreprise",
  long_term_rental: "Location longue durée / crédit-bail",
  short_term_rental: "Location courte durée",
  loan: "Véhicule prêté",
} as const;

export default async function VehicleDetailPage({ params, searchParams }: Props) {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role === "driver") notFound();

  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const vehicle = await getVehicle(session.tenantId, id);
  if (!vehicle) notFound();
  const fromArchive = vehicle.archived_at !== null || (await searchParams)?.view === "archived";

  const canEdit = session.role === "administrator" || session.role === "fleet_manager";
  const [history, drivers, anomalies, mileageReadings, insuranceEvents, inspections] = await Promise.all([
    listVehicleAssignmentHistory(session.tenantId, id),
    canEdit ? listDrivers(session.tenantId) : Promise.resolve([]),
    listVehicleAnomalies(session.tenantId, id),
    listVehicleMileageReadings(session.tenantId, id),
    listVehicleInsuranceEvents(session.tenantId, id),
    listVehicleInspections(session.tenantId, id),
  ]);
  return (
    <WorkspaceShell userName={session.user.name} role={session.role} active="vehicles">
      <main className="mx-auto w-full max-w-[1220px] px-4 pb-12 pt-7 sm:px-6 lg:px-10 lg:pt-10">
        <Link href={fromArchive ? "/vehicles?view=archived" : "/vehicles"} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
          <ArrowLeft className="size-4" /> Back to vehicles
        </Link>
        <div className="mt-7 flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">Vehicle record</p>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-[clamp(1.9rem,3vw,2.7rem)] leading-tight font-semibold tracking-[-0.04em] text-foreground">{vehicle.registration}</h1>
              {vehicle.archived_at
                ? <Badge variant="outline" className="px-2.5 py-1">Archived</Badge>
                : <Badge variant="outline" className="border-primary/20 bg-primary/10 px-2.5 py-1 text-primary">{vehicle.current_driver_id ? "Assigned" : "Available"}</Badge>}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Make/model not set"}{vehicle.year ? ` · ${vehicle.year}` : ""}</p>
          </div>
          {canEdit && <div className="flex flex-wrap items-center gap-2">
            {vehicle.archived_at ? <RecordArchiveAction kind="vehicle" id={vehicle.id} name={vehicle.registration} archived /> : <>
              <AssignmentDialog vehicles={[vehicle]} drivers={drivers} fixedVehicleId={vehicle.id} />
              <VehicleFormDialog vehicle={vehicle} />
              <RecordArchiveAction kind="vehicle" id={vehicle.id} name={vehicle.registration} archived={false} />
            </>}
          </div>}
        </div>

        <VehicleDetailTabs
          overview={(
            <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
              <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="flex items-center gap-3 border-b px-6 py-5">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><CarFront className="size-[18px]" /></div>
                  <div><h2 className="text-sm font-semibold text-foreground">Vehicle information</h2><p className="mt-0.5 text-xs text-muted-foreground">Core identity and current reading</p></div>
                </div>
                <dl className="px-6">
                  <div className="grid grid-cols-2 gap-4"><Field label="Registration" value={vehicle.registration} /><Field label="Year" value={vehicle.year?.toString() ?? "Not set"} /></div>
                  <div className="grid grid-cols-2 gap-4"><Field label="Make" value={vehicle.make || "Not set"} /><Field label="Model" value={vehicle.model || "Not set"} /></div>
                  <div className="grid grid-cols-2 gap-4"><Field label="Current mileage" value={vehicle.current_mileage === null ? "No reading" : `${vehicle.current_mileage.toLocaleString("en-GB")} km`} /><Field label="Current driver" value={vehicle.current_driver_name || "Unassigned"} /></div>
                  <Field label="Type de propriété ou d'utilisation" value={vehicle.ownership_type ? ownershipLabels[vehicle.ownership_type] : "À compléter"} />
                  {vehicle.ownership_type && vehicle.ownership_type !== "owned" && <Field label="Titulaire de la carte grise" value={vehicle.registered_holder || "À compléter"} />}
                </dl>
              </section>
              <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="flex items-center gap-3 border-b px-6 py-5">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><ShieldCheck className="size-[18px]" /></div>
                  <div><h2 className="text-sm font-semibold text-foreground">Inspection & insurance</h2><p className="mt-0.5 text-xs text-muted-foreground">Upcoming dates and provider</p></div>
                </div>
                <dl className="px-6">
                  <Field label="Next technical inspection" value={dateLabel(inspections[0]?.technical_due_date ?? null)} />
                  <Field label="Next emissions inspection" value={dateLabel(inspections[0]?.emissions_due_date ?? null)} />
                  <Field label="Insurance company" value={vehicle.insurance_company ?? "Not set"} />
                  <Field label="Insurance expiry" value={dateLabel(vehicle.insurance_expiry_date)} />
                  <Field label="Bonus / malus coefficient" value={vehicle.bonus_malus ?? "Not set"} />
                </dl>
              </section>
            </div>
          )}
          mileage={<VehicleMileagePanel vehicleId={vehicle.id} canManage={canEdit && !vehicle.archived_at} initialReadings={mileageReadings} />}
          documents={<VehicleDocumentsPanel vehicleId={vehicle.id} canUpload={canEdit && !vehicle.archived_at} />}
          insurance={<VehicleInsurancePanel vehicleId={vehicle.id} canManage={canEdit && !vehicle.archived_at} initialEvents={insuranceEvents} initialStatus={vehicle.insurance_status} />}
          inspections={<VehicleInspectionsPanel vehicleId={vehicle.id} canManage={canEdit && !vehicle.archived_at} initialInspections={inspections} />}
          maintenance={<VehicleMaintenancePanel vehicleId={vehicle.id} canManage={canEdit && !vehicle.archived_at} />}
          history={<AssignmentHistoryTable history={history} />}
          anomalies={<VehicleAnomaliesPanel vehicleId={vehicle.id} reporterName={session.user.name} canManage={canEdit && !vehicle.archived_at} initialAnomalies={anomalies} />}
        />
      </main>
    </WorkspaceShell>
  );
}

