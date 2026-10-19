import "server-only";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

export const APP_ROLES = [
  "administrator",
  "fleet_manager",
  "manager",
  "driver",
] as const;

export type AppRole = (typeof APP_ROLES)[number];
export const ACTIVE_ORGANIZATION_COOKIE = "nexdrive.organization";
export type Membership = { tenantId: string; organizationName: string; role: AppRole; displayName: string; disabled: boolean };

export async function listAccountMemberships(userId: string): Promise<Membership[]> {
  const result = await pool.query<Membership>(
    `SELECT m.tenant_id AS "tenantId", t.name AS "organizationName", m.role,
       m.display_name AS "displayName", (m.disabled_at IS NOT NULL) AS disabled
     FROM organization_membership m JOIN tenant t ON t.id=m.tenant_id
     WHERE m.user_id=$1 ORDER BY m.created_at, m.tenant_id`, [userId],
  );
  return result.rows;
}

export async function selectOrganization(sessionId: string, userId: string, tenantId: string) {
  const member = (await listAccountMemberships(userId)).find((item) => item.tenantId === tenantId && !item.disabled);
  if (!member) return false;
  (await cookies()).set(ACTIVE_ORGANIZATION_COOKIE, `${sessionId}:${tenantId}`, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/",
  });
  return true;
}

export async function getOrganizationSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const memberships = await listAccountMemberships(session.user.id);
  const value = (await cookies()).get(ACTIVE_ORGANIZATION_COOKIE)?.value;
  const prefix = `${session.session.id}:`;
  const selected = value?.startsWith(prefix) ? value.slice(prefix.length) : undefined;
  // Explicitly selected suspended or unknown memberships fail closed.
  const member = selected
    ? memberships.find((item) => item.tenantId === selected && !item.disabled)
    : memberships.find((item) => item.tenantId === session.user.tenantId && !item.disabled)
      ?? memberships.find((item) => !item.disabled);
  if (!member || !APP_ROLES.includes(member.role)) return null;

  return {
    user: { ...session.user, name: member.displayName },
    tenantId: member.tenantId,
    tenantName: member.organizationName,
    role: member.role,
  };
}
