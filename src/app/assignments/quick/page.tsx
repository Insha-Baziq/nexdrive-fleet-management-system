import { notFound, redirect } from "next/navigation";
import { AssignmentQuickPicker } from "@/components/assignment-quick-picker";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getOrganizationSession } from "@/lib/organization-session";
import { listDrivers } from "@/lib/drivers";
import { listVehicles } from "@/lib/vehicles";

export default async function QuickAssignmentPage() {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role !== "administrator" && session.role !== "fleet_manager") notFound();
  const [drivers, vehicles] = await Promise.all([
    listDrivers(session.tenantId),
    listVehicles(session.tenantId),
  ]);

  return <WorkspaceShell userName={session.user.name} role={session.role} active="quick-assignment">
    <AssignmentQuickPicker drivers={drivers} vehicles={vehicles} />
  </WorkspaceShell>;
}
