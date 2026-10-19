import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PlatformOrganizationUsers } from "@/components/platform-organization-users";
import { getPlatformAccess, getPlatformOrganization } from "@/lib/platform-administration";

export const dynamic = "force-dynamic";

export default async function PlatformOrganizationPage({ params }: PageProps<"/platform/organizations/[id]">) {
  const access = await getPlatformAccess(await headers());
  if (access.status === 401) redirect("/platform/login");
  if (access.status === 403) redirect("/workspace");

  const { id } = await params;
  const organization = await getPlatformOrganization(id);
  if (!organization) notFound();

  return (
    <PlatformOrganizationUsers
      currentUserId={access.session.user.id}
      organization={{
        ...organization,
        createdAt: organization.createdAt.toISOString(),
      }}
    />
  );
}
