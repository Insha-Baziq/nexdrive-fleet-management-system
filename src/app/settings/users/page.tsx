import { notFound, redirect } from "next/navigation";
import { getOrganizationSession } from "@/lib/organization-session";
import { listOrganizationUsers } from "@/lib/organization-users";
import { listInvitations, listInvitableDrivers } from "@/lib/onboarding";
import { WorkspaceShell } from "@/components/workspace-shell";
import { OrganizationUserManagement } from "@/components/organization-user-management";

export default async function UsersPage() {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role !== "administrator") notFound();
  const [users, invitations, invitableDrivers] = await Promise.all([
    listOrganizationUsers(session.tenantId),
    listInvitations(session.tenantId),
    listInvitableDrivers(session.tenantId),
  ]);
  return <WorkspaceShell userName={session.user.name} role={session.role} active="users">
    <OrganizationUserManagement
      currentUserId={session.user.id}
      initialUsers={users.map((user) => ({
        ...user,
        accountDisabledAt: user.accountDisabledAt?.toISOString() ?? null,
        lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      }))}
      initialInvitations={invitations.map((invite) => ({
        id: invite.id, email: invite.email, role: invite.role,
        created_at: invite.created_at.toISOString(), expires_at: invite.expires_at.toISOString(), copyable: invite.copyable,
        email_delivery_status: invite.email_delivery_status,
        email_last_attempt_at: invite.email_last_attempt_at?.toISOString() ?? null,
        email_last_sent_at: invite.email_last_sent_at?.toISOString() ?? null,
        target_driver_id: invite.target_driver_id,
        target_driver_name: invite.target_driver_name,
      }))}
      initialDrivers={invitableDrivers}
    />
  </WorkspaceShell>;
}
