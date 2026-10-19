import { notFound, redirect } from "next/navigation";
import { CarFront } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { getOrganizationSession } from "@/lib/organization-session";
import { getDriverWorkspaceVehicle } from "@/lib/drivers";
import { listVehicleDocuments } from "@/lib/vehicle-documents";
import { DriverPaperworkList } from "@/components/driver-paperwork-list";
import { DriverAnomalyReportDialog } from "@/components/driver-anomaly-report-dialog";
import { DriverMileageEntry } from "@/components/driver-mileage-entry";
import { DriverWorkspaceCopy, DriverWorkspaceMileage } from "@/components/driver-workspace-copy";

export default async function MyVehiclePage() {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role !== "driver") notFound();

  const driver = await getDriverWorkspaceVehicle(session.tenantId, session.user.id);
  const vehicleDocuments = driver?.vehicle_id
    ? await listVehicleDocuments(session.tenantId, driver.vehicle_id, { id: session.user.id }, session.role)
    : [];

  return (
    <WorkspaceShell userName={session.user.name} role={session.role} active="my-vehicle">
      <main className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:py-10">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold text-primary"><DriverWorkspaceCopy id="workspaceLabel" /></p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground"><DriverWorkspaceCopy id="vehicleTitle" /></h1>
          <p className="mt-2 text-sm text-muted-foreground"><DriverWorkspaceCopy id="vehicleDescription" /></p>
        </div>

        {driver?.vehicle_id ? (
          <Card className="mt-6 max-w-5xl">
            <CardContent className="grid gap-6 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
              <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-1">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CarFront aria-hidden="true" className="size-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground"><DriverWorkspaceCopy id="registration" /></p>
                  <p className="mt-1 truncate text-lg font-semibold text-foreground">{driver.registration ?? "—"}</p>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground"><DriverWorkspaceCopy id="vehicle" /></p>
                <p className="mt-1 text-lg font-semibold text-foreground">{[driver.make, driver.model].filter(Boolean).join(" ") || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground"><DriverWorkspaceCopy id="currentMileage" /></p>
                <p className="mt-1 text-lg font-semibold text-foreground" data-testid="driver-current-mileage"><DriverWorkspaceMileage mileage={driver.current_mileage} /></p>
                <DriverMileageEntry registration={driver.registration ?? ""} />
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="mt-6 max-w-3xl">
            <CardContent className="p-0">
              <Empty className="min-h-64 border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><CarFront aria-hidden="true" /></EmptyMedia>
                  <EmptyTitle><DriverWorkspaceCopy id={driver ? "noAssignedVehicle" : "setupIncomplete"} /></EmptyTitle>
                  <EmptyDescription>
                    {driver
                      ? <DriverWorkspaceCopy id="vehicleWillAppear" />
                      : <DriverWorkspaceCopy id="accountNotLinked" />}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </CardContent>
          </Card>
        )}

        {driver?.vehicle_id && driver.registration && (
          <div className="mt-5 max-w-5xl">
            <DriverAnomalyReportDialog vehicleRegistration={driver.registration} reporterName={session.user.name} />
          </div>
        )}

        <DriverPaperworkList
          title="Vehicle documents"
          description="Paperwork shared with you for your currently assigned vehicle."
          documents={vehicleDocuments.map((document) => ({
            id: document.id,
            name: document.name,
            category: document.category,
            expiry_date: document.expiry_date,
            file_name: document.file_name,
            open_url: `/api/vehicles/${driver?.vehicle_id}/documents/${document.id}/content`,
          }))}
          emptyMessage={driver?.vehicle_id
            ? "No vehicle documents have been shared with you."
            : "Vehicle documents appear here only while a vehicle is assigned to you."}
        />
      </main>
    </WorkspaceShell>
  );
}
