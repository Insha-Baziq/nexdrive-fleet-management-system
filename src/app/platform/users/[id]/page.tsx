import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PlatformHeader } from "@/components/platform-header";
import { PlatformShell } from "@/components/platform-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlatformAccess, getPlatformUserDetail } from "@/lib/platform-administration";

export const dynamic = "force-dynamic";

const roleLabels: Record<string, string> = {
  administrator: "Administrator",
  fleet_manager: "Fleet Manager",
  manager: "Manager",
  driver: "Driver",
};

export default async function PlatformUserDetailPage({ params }: PageProps<"/platform/users/[id]">) {
  const access = await getPlatformAccess(await headers());
  if (access.status === 401) redirect("/platform/login");
  if (access.status === 403) redirect("/workspace");

  const { id } = await params;
  const user = await getPlatformUserDetail(id);
  if (!user) notFound();

  return (
    <PlatformShell active="users">
      <main className="mx-auto w-full max-w-[1200px] space-y-6 px-4 py-8 sm:px-6 lg:py-10">
        <PlatformHeader
          title={user.name}
          description="Account details and organization memberships."
          backHref="/platform/users"
          backLabel="All users"
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid min-w-0 gap-x-8 gap-y-5 sm:grid-cols-2">
              <div className="min-w-0 space-y-1">
                <dt className="text-sm text-muted-foreground">Name</dt>
                <dd className="break-words font-medium" data-no-translate>{user.name}</dd>
              </div>
              <div className="min-w-0 space-y-1">
                <dt className="text-sm text-muted-foreground">Email address</dt>
                <dd className="break-all font-medium" data-no-translate>{user.email}</dd>
              </div>
              <div className="min-w-0 space-y-1">
                <dt className="text-sm text-muted-foreground">Account created (UTC)</dt>
                <dd className="break-all font-mono text-sm" title={user.createdAtExact}>{user.createdAtExact}</dd>
              </div>
              <div className="min-w-0 space-y-1">
                <dt className="text-sm text-muted-foreground">Email verification</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  {user.emailVerified ? <Badge variant="outline">Verified</Badge> : <Badge variant="secondary">Not verified</Badge>}
                  {user.accountDisabled ? <Badge variant="secondary">Disabled</Badge> : null}
                  {user.platformAdministrator ? <Badge variant="outline">Platform administrator</Badge> : null}
                </dd>
                <dd className="break-all font-mono text-sm">
                  {user.emailVerified
                  ? user.emailVerifiedAtExact ?? "Not recorded for accounts verified before timestamp tracking was added."
                    : "No verification time; the account is not verified."}
                </dd>
                {user.emailVerified && user.emailVerifiedAtExact ? <dd className="text-xs text-muted-foreground">UTC, exact database timestamp</dd> : null}
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Organizations ({user.memberships.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {user.memberships.length ? (
              <ul className="divide-y">
                {user.memberships.map((membership) => (
                  <li key={membership.organizationId} className="flex min-w-0 flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <Link
                        href={`/platform/organizations/${encodeURIComponent(membership.organizationId)}`}
                        className="block break-words font-medium hover:underline"
                        title={membership.organizationName}
                      >
                        {membership.organizationName}
                      </Link>
                      <p className="text-sm text-muted-foreground">{roleLabels[membership.role] ?? membership.role}</p>
                    </div>
                    <Badge variant={membership.disabledAt ? "secondary" : "outline"} className="w-fit">
                      {membership.disabledAt ? "Suspended membership" : "Enabled membership"}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">This account is not associated with an organization.</p>
            )}
          </CardContent>
        </Card>
      </main>
    </PlatformShell>
  );
}
