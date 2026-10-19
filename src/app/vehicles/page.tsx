import { redirect, notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { VehicleList } from "@/components/vehicle-list";
import { getOrganizationSession } from "@/lib/organization-session";
import { listVehicles } from "@/lib/vehicles";

export default async function VehiclesPage({ searchParams }: { searchParams?: Promise<{ view?: string; availability?: string; attention?: string }> }) {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role === "driver") notFound();

  const canEdit = session.role === "administrator" || session.role === "fleet_manager";
  const canImport = session.role === "administrator";
  const params = await searchParams;
  const requestedView = params?.view ?? "active";
  if (requestedView !== "active" && requestedView !== "archived") notFound();
  if (requestedView === "archived" && !canEdit) notFound();
  const attention = params?.attention === "inspection" || params?.attention === "insurance" ? params.attention : null;
  const initialAvailability = params?.availability === "available" ? "available" : "all";
  if (requestedView === "archived" && (attention || initialAvailability !== "all")) notFound();
  const vehicles = await listVehicles(session.tenantId, requestedView, attention);

  return (
    <WorkspaceShell userName={session.user.name} role={session.role} active="vehicles">
      <VehicleList vehicles={vehicles} canEdit={canEdit} canImport={canImport} view={requestedView} attention={attention} initialAvailability={initialAvailability} />
    </WorkspaceShell>
  );
}
