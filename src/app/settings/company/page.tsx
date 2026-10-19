import { notFound, redirect } from "next/navigation";
import { CompanySettingsForm } from "@/components/company-settings-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getCompanyInformation } from "@/lib/company-settings";
import { getOrganizationSession } from "@/lib/organization-session";

export default async function CompanySettingsPage() {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role !== "administrator") notFound();
  const company = await getCompanyInformation(session.tenantId);
  if (!company) notFound();

  return <WorkspaceShell userName={session.user.name} role={session.role} active="company">
    <CompanySettingsForm initialCompany={company} />
  </WorkspaceShell>;
}
