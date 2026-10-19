import "server-only";
import { pool } from "@/lib/db";
import { DASHBOARD_ALERT_WINDOW_DAYS } from "@/lib/alert-window";

export const DASHBOARD_EXPIRY_ATTENTION_DAYS = DASHBOARD_ALERT_WINDOW_DAYS;

export type DashboardCounts = {
  total_vehicles: number;
  available_vehicles: number;
  total_drivers: number;
  inspection_attention: number;
  insurance_attention: number;
  active_fines: number;
  open_claims: number;
};

/**
 * Returns the small operational snapshot for a session-derived tenant.
 * Every subquery is explicitly tenant-scoped; callers must pass the tenant
 * from getOrganizationSession(), never a value supplied by the browser.
 */
export async function getDashboardCounts(tenantId: string): Promise<DashboardCounts> {
  const result = await pool.query<DashboardCounts>(
    `SELECT
      (SELECT count(*)::int FROM vehicle v WHERE v.tenant_id = $1 AND v.archived_at IS NULL) AS total_vehicles,
      (SELECT count(*)::int
       FROM vehicle v
       WHERE v.tenant_id = $1 AND v.archived_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM assignment a
           WHERE a.tenant_id = v.tenant_id
             AND a.vehicle_id = v.id
             AND a.ended_at IS NULL
         )) AS available_vehicles,
      (SELECT count(*)::int FROM driver d WHERE d.tenant_id = $1 AND d.archived_at IS NULL) AS total_drivers,
      (SELECT count(*)::int
       FROM vehicle v
       WHERE v.tenant_id = $1 AND v.archived_at IS NULL
         AND (SELECT i.technical_due_date FROM vehicle_inspection i
              WHERE i.tenant_id = v.tenant_id AND i.vehicle_id = v.id
              ORDER BY i.recorded_at DESC, i.id DESC LIMIT 1) <= CURRENT_DATE + $2::int) AS inspection_attention,
      (SELECT count(*)::int
       FROM vehicle v
       WHERE v.tenant_id = $1 AND v.archived_at IS NULL
         AND (v.insurance_status <> 'insured' OR v.insurance_expiry_date IS NULL
           OR v.insurance_expiry_date <= CURRENT_DATE + $2::int)) AS insurance_attention,
      (SELECT count(*)::int FROM fine f WHERE f.tenant_id = $1 AND f.status = 'open') AS active_fines,
      (SELECT count(*)::int FROM claim c WHERE c.tenant_id = $1 AND c.status = 'open') AS open_claims`,
    [tenantId, DASHBOARD_EXPIRY_ATTENTION_DAYS],
  );

  return result.rows[0];
}
