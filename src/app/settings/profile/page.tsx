import { redirect } from "next/navigation";
import { ProfileSettings } from "@/components/profile-settings";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getOrganizationSession } from "@/lib/organization-session";

export default async function ProfilePage() {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  return <WorkspaceShell userName={session.user.name} role={session.role} active="profile">
    <ProfileSettings userName={session.user.name} email={session.user.email} />
  </WorkspaceShell>;
}
