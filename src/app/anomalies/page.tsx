import { notFound, redirect } from "next/navigation";
import { AnomalyList } from "@/components/anomaly-list";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getOrganizationSession } from "@/lib/organization-session";
import { listAnomalies } from "@/lib/anomalies";

export default async function AnomaliesPage() {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role === "driver") notFound();
  const anomalies = await listAnomalies(session.tenantId);
  return <WorkspaceShell userName={session.user.name} role={session.role} active="anomalies"><AnomalyList anomalies={anomalies} /></WorkspaceShell>;
}
