import "server-only";
import { pool } from "@/lib/db";
import { DASHBOARD_ALERT_WINDOW_DAYS } from "@/lib/alert-window";

export type DashboardAlertType =
  | "technical_inspection"
  | "vehicle_insurance"
  | "vehicle_document"
  | "driver_licence"
  | "driver_document"
  | "vehicle_anomaly"
  | "fine_deadline";

export type DashboardAlert = {
  id: string;
  type: DashboardAlertType;
  title: string;
  details: string;
  date: string;
  status: string;
  isOpenItem: boolean;
  targetId: string;
  targetType: "vehicle" | "driver" | "anomaly" | "fine";
};

type AlertRow = {
  id: string;
  type: DashboardAlertType;
  title: string;
  details: string;
  date: string;
  status: string;
  is_open_item: boolean;
  target_id: string;
  target_type: DashboardAlert["targetType"];
};

/**
 * Return tenant-owned attention items for the dashboard. The tenant is always
 * taken from the authenticated organization session by the page that calls this
 * helper; every source table and parent join is scoped again in the query.
 */
export async function getDashboardAlerts(tenantId: string): Promise<{
  alerts: DashboardAlert[];
  count: number;
}> {
  const result = await pool.query<AlertRow & { total_count: number }>(
    `WITH alert_sources AS (
      SELECT
        'technical_inspection'::text AS type,
        v.id::text AS id,
        'Technical inspection'::text AS title,
        'Vehicle ' || v.registration || ' · Periodic inspection due' AS details,
        (SELECT i.technical_due_date FROM vehicle_inspection i
         WHERE i.tenant_id = v.tenant_id AND i.vehicle_id = v.id
         ORDER BY i.recorded_at DESC, i.id DESC LIMIT 1) AS attention_date,
        false AS is_open_item,
        v.id::text AS target_id,
        'vehicle'::text AS target_type
      FROM vehicle v
      WHERE v.tenant_id = $1 AND v.archived_at IS NULL
        AND EXISTS (SELECT 1 FROM vehicle_inspection i WHERE i.tenant_id = v.tenant_id AND i.vehicle_id = v.id)

      UNION ALL

      SELECT
        'vehicle_insurance', v.id::text, 'Vehicle insurance',
        CASE
          WHEN v.insurance_status = 'insured' AND v.insurance_expiry_date IS NOT NULL
            THEN 'Vehicle ' || v.registration || ' · Insurance policy expiry'
          WHEN v.insurance_status = 'insured'
            THEN 'Vehicle ' || v.registration || ' · Insurance expiry date missing'
          ELSE 'Vehicle ' || v.registration || ' · Coverage status: ' ||
            CASE v.insurance_status
              WHEN 'suspended' THEN 'Suspended'
              WHEN 'unpaid' THEN 'Unpaid'
              ELSE 'To complete'
            END
        END,
        CASE WHEN v.insurance_status = 'insured' AND v.insurance_expiry_date IS NOT NULL
          THEN v.insurance_expiry_date ELSE CURRENT_DATE END,
        v.insurance_status <> 'insured', v.id::text, 'vehicle'
      FROM vehicle v
      WHERE v.tenant_id = $1 AND v.archived_at IS NULL
        AND (v.insurance_status <> 'insured' OR v.insurance_expiry_date IS NOT NULL)

      UNION ALL

      SELECT
        'vehicle_document', d.id::text, 'Vehicle document',
        d.name || ' · Vehicle ' || v.registration,
        d.expiry_date, false, v.id::text, 'vehicle'
      FROM vehicle_document d
      JOIN vehicle v ON v.id = d.vehicle_id AND v.tenant_id = d.tenant_id
      WHERE d.tenant_id = $1 AND v.tenant_id = $1 AND v.archived_at IS NULL
        AND d.status = 'ready' AND d.expiry_date IS NOT NULL

      UNION ALL

      SELECT
        'driver_licence', d.id::text, 'Driver licence',
        d.full_name || ' · Licence expiry',
        d.licence_expiry_date, false, d.id::text, 'driver'
      FROM driver d
      WHERE d.tenant_id = $1 AND d.archived_at IS NULL AND d.licence_expiry_date IS NOT NULL

      UNION ALL

      SELECT
        'driver_document', doc.id::text, 'Driver document',
        doc.name || ' · ' || d.full_name,
        doc.expiry_date, false, d.id::text, 'driver'
      FROM driver_document doc
      JOIN driver d ON d.id = doc.driver_id AND d.tenant_id = doc.tenant_id
      WHERE doc.tenant_id = $1 AND d.tenant_id = $1 AND d.archived_at IS NULL
        AND doc.status = 'ready' AND doc.expiry_date IS NOT NULL

      UNION ALL

      SELECT
        'driver_document', doc.id::text, 'Driver document',
        doc.name || ' · ' || d.full_name || ' · Expiry date required',
        CURRENT_DATE, true, d.id::text, 'driver'
      FROM driver_document doc
      JOIN driver d ON d.id = doc.driver_id AND d.tenant_id = doc.tenant_id
      WHERE doc.tenant_id = $1 AND d.tenant_id = $1 AND d.archived_at IS NULL
        AND doc.status = 'ready' AND doc.expiry_date IS NULL
        AND doc.category IN ('driving_licence', 'identity_document')

      UNION ALL

      SELECT
        'vehicle_anomaly', a.id::text, 'Vehicle anomaly',
        'Vehicle ' || v.registration || ' · ' || left(a.description, 160),
        a.observed_date, true, a.id::text, 'anomaly'
      FROM vehicle_anomaly a
      JOIN vehicle v ON v.id = a.vehicle_id AND v.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1 AND v.tenant_id = $1 AND a.status = 'open'

      UNION ALL

      SELECT
        'fine_deadline', f.id::text, 'Fine payment deadline',
        'Fine ' || f.reference || ' · Vehicle ' || v.registration,
        f.payment_deadline, false, f.id::text, 'fine'
      FROM fine f
      JOIN vehicle v ON v.id = f.vehicle_id AND v.tenant_id = f.tenant_id
      WHERE f.tenant_id = $1 AND v.tenant_id = $1 AND f.status = 'open'
    ), attention AS (
      SELECT *, CASE
        WHEN is_open_item THEN 'Open'
        WHEN attention_date < CURRENT_DATE THEN 'Overdue'
        WHEN attention_date = CURRENT_DATE THEN 'Due today'
        ELSE 'Due in ' || (attention_date - CURRENT_DATE)::text || ' days'
      END AS status
      FROM alert_sources
      WHERE is_open_item OR attention_date <= CURRENT_DATE + $2::int
    )
    SELECT
      id, type, title, details, attention_date::text AS date, status,
      is_open_item, target_id, target_type,
      count(*) OVER ()::int AS total_count
    FROM attention
    ORDER BY
      CASE WHEN status = 'Overdue' THEN 0 WHEN is_open_item THEN 2 ELSE 1 END,
      attention_date ASC, title ASC, id ASC`,
    [tenantId, DASHBOARD_ALERT_WINDOW_DAYS],
  );

  return {
    alerts: result.rows.map((row) => ({
      id: `${row.type}:${row.id}`,
      type: row.type,
      title: row.title,
      details: row.details,
      date: row.date,
      status: row.status,
      isOpenItem: row.is_open_item,
      targetId: row.target_id,
      targetType: row.target_type,
    })),
    count: result.rows[0]?.total_count ?? 0,
  };
}
