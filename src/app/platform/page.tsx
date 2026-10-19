import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PlatformAdministration } from "@/components/platform-administration";
import { getPlatformAccess, listPlatformOrganizations } from "@/lib/platform-administration";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const access = await getPlatformAccess(await headers());
  if (access.status === 401) redirect("/platform/login");
  if (access.status === 403) redirect("/workspace");

  const organizations = await listPlatformOrganizations();
  return (
    <PlatformAdministration
      initialOrganizations={organizations.map((organization) => ({
        ...organization,
        createdAt: organization.createdAt.toISOString(),
      }))}
    />
  );
}
