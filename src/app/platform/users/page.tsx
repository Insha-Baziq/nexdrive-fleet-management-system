import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PlatformUserDirectory } from "@/components/platform-user-directory";
import { getPlatformAccess, listPlatformUsers } from "@/lib/platform-administration";

export const dynamic = "force-dynamic";

export default async function PlatformUsersPage() {
  const access = await getPlatformAccess(await headers());
  if (access.status === 401) redirect("/platform/login");
  if (access.status === 403) redirect("/workspace");

  const users = await listPlatformUsers();
  return (
    <PlatformUserDirectory
      currentUserId={access.session.user.id}
      initialUsers={users.map((user) => ({
        ...user,
        createdAt: user.createdAt.toISOString(),
        accountDisabledAt: user.accountDisabledAt?.toISOString() ?? null,
        lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      }))}
    />
  );
}
