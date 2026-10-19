import "server-only";
import { pool } from "@/lib/db";
import type { AppRole } from "@/lib/organization-session";

export type OrganizationUser = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  accountDisabledAt: Date | null;
  lastSeenAt: Date | null;
};

export async function listOrganizationUsers(tenantId: string): Promise<OrganizationUser[]> {
  const result = await pool.query<OrganizationUser>(
    `SELECT u.id, m.display_name AS name, u.email, m.role,
       m.disabled_at AS "accountDisabledAt", m.last_seen_at AS "lastSeenAt"
     FROM "user" u JOIN organization_membership m ON m.user_id=u.id
     WHERE m.tenant_id = $1
       AND u.email NOT ILIKE 'deleted-%@deleted.nexdrive.invalid'
     ORDER BY lower(m.display_name), lower(u.email), u.id`,
    [tenantId],
  );
  return result.rows;
}
