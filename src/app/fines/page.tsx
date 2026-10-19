import { notFound, redirect } from "next/navigation";
import { FineList } from "@/components/fine-list";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getOrganizationSession } from "@/lib/organization-session";
import { listFines } from "@/lib/fine-dossiers";
import { listVehicles } from "@/lib/vehicles";

export default async function FinesPage({ searchParams }: { searchParams?: Promise<{ status?: string }> }) {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role === "driver") notFound();
  const [fines, vehicles] = await Promise.all([
    listFines(session.tenantId, session.role),
    session.role === "administrator" || session.role === "manager" ? listVehicles(session.tenantId) : Promise.resolve([]),
  ]);
  return <WorkspaceShell userName={session.user.name} role={session.role} active="fines">
    <FineList fines={fines} vehicles={vehicles.map((vehicle) => ({ id: vehicle.id, registration: vehicle.registration, make: vehicle.make, model: vehicle.model }))} canWrite={session.role === "administrator" || session.role === "manager"} initialStatus={(await searchParams)?.status === "open" ? "open" : "all"} />
  </WorkspaceShell>;
}
