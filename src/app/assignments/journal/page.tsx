import { notFound, redirect } from "next/navigation";
import { AssignmentJournal } from "@/components/assignment-journal";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getOrganizationSession } from "@/lib/organization-session";
import { listAssignmentJournal } from "@/lib/assignments";

export default async function AssignmentJournalPage() {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role === "driver") notFound();
  const assignments = await listAssignmentJournal(session.tenantId);

  return <WorkspaceShell userName={session.user.name} role={session.role} active="assignment-journal">
    <AssignmentJournal assignments={assignments} isAdministrator={session.role === "administrator"}
      canEndAssignments={session.role === "administrator" || session.role === "fleet_manager"} />
  </WorkspaceShell>;
}
