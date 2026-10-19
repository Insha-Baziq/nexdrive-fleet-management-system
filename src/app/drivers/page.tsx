import { notFound, redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { DriverList } from "@/components/driver-list";
import { getOrganizationSession } from "@/lib/organization-session";
import { listDrivers, listEligibleDriverUsers } from "@/lib/drivers";

export default async function DriversPage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role !== "administrator" && session.role !== "fleet_manager" && session.role !== "manager") notFound();
  const canEdit = session.role === "administrator" || session.role === "fleet_manager" || session.role === "manager";
  const canImport = session.role === "administrator" || session.role === "manager";
  const requestedView = (await searchParams)?.view ?? "active";
  if (requestedView !== "active" && requestedView !== "archived") notFound();
  const [drivers, eligibleUsers] = await Promise.all([
    listDrivers(session.tenantId, requestedView), requestedView === "active" ? listEligibleDriverUsers(session.tenantId) : Promise.resolve([]),
  ]);
  return <WorkspaceShell userName={session.user.name} role={session.role} active="drivers">
    <DriverList drivers={drivers} eligibleUsers={eligibleUsers} canEdit={canEdit} canImport={canImport} view={requestedView} />
  </WorkspaceShell>;
}
