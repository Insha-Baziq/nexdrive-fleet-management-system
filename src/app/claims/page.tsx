import { notFound, redirect } from "next/navigation";
import { ClaimList } from "@/components/claim-list";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getOrganizationSession } from "@/lib/organization-session";
import { listClaims } from "@/lib/claim-dossiers";
import { listVehicles } from "@/lib/vehicles";

export default async function ClaimsPage({ searchParams }: { searchParams?: Promise<{ status?: string }> }) {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role === "driver") notFound();
  const [claims, vehicles] = await Promise.all([
    listClaims(session.tenantId, session.role),
    session.role === "administrator" || session.role === "manager" ? listVehicles(session.tenantId) : Promise.resolve([]),
  ]);
  return <WorkspaceShell userName={session.user.name} role={session.role} active="claims">
    <ClaimList claims={claims} vehicles={vehicles.map((vehicle) => ({ id: vehicle.id, registration: vehicle.registration, make: vehicle.make, model: vehicle.model }))} canWrite={session.role === "administrator" || session.role === "manager"} initialStatus={(await searchParams)?.status === "open" ? "open" : "all"} />
  </WorkspaceShell>;
}
