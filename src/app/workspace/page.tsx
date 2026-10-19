import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOrganizationSession, listAccountMemberships } from "@/lib/organization-session";
import { AccountWelcome } from "@/components/account-welcome";
import { OnboardingShell } from "@/components/onboarding-shell";
import { WorkspaceShell } from "@/components/workspace-shell";
import { DashboardCounts } from "@/components/dashboard-counts";
import { DashboardAttention } from "@/components/dashboard-attention";
import { DASHBOARD_EXPIRY_ATTENTION_DAYS, getDashboardCounts } from "@/lib/dashboard";
import { getDashboardAlerts } from "@/lib/dashboard-alerts";

export default async function WorkspacePage({ searchParams }: { searchParams?: Promise<{ invitation?: string | string[] }> }) {
  const value = (await searchParams)?.invitation;
  const invitation = typeof value === "string" && value.length <= 80 ? value : undefined;
  const organizationSession = await getOrganizationSession();

  if (!organizationSession) {
    const rawSession = await auth.api.getSession({ headers: await headers() });
    if (!rawSession) redirect(invitation ? `/login?invitation=${encodeURIComponent(invitation)}` : "/login");

    return <OnboardingShell><AccountWelcome name={rawSession.user.name} memberships={await listAccountMemberships(rawSession.user.id)} /></OnboardingShell>;
  }

  const { user, tenantId, role } = organizationSession;
  if (role === "driver") redirect(invitation ? `/my-vehicle?invitation=${encodeURIComponent(invitation)}` : "/my-vehicle");

  const [counts, attention] = await Promise.all([
    getDashboardCounts(tenantId),
    getDashboardAlerts(tenantId),
  ]);

  return (
    <WorkspaceShell userName={user.name} role={role} active="overview">
      <main className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:py-10">
        <DashboardCounts counts={counts} attentionDays={DASHBOARD_EXPIRY_ATTENTION_DAYS} />
        <DashboardAttention alerts={attention.alerts} count={attention.count} role={role} />
      </main>
    </WorkspaceShell>
  );
}
