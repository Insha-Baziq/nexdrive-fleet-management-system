import { notFound, redirect } from "next/navigation";
import { HistoricalAssignmentLookup } from "@/components/historical-assignment-lookup";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getOrganizationSession } from "@/lib/organization-session";
import { listVehicles } from "@/lib/vehicles";

export default async function HistoricalLookupPage() {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role === "driver") notFound();
  const vehicles = await listVehicles(session.tenantId);

  return <WorkspaceShell userName={session.user.name} role={session.role} active="historical-lookup">
    <HistoricalAssignmentLookup vehicles={vehicles} />
  </WorkspaceShell>;
}
