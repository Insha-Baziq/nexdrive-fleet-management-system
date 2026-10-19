import "server-only";
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db";
import { DASHBOARD_ALERT_WINDOW_DAYS } from "@/lib/alert-window";

export type Vehicle = {
  id: string;
  tenant_id: string;
  registration: string;
  make: string;
  model: string;
  year: number | null;
  current_mileage: number | null;
  technical_inspection_date: string | null;
  insurance_company: string | null;
  insurance_expiry_date: string | null;
  bonus_malus: string | null;
  ownership_type: VehicleOwnershipType | null;
  registered_holder: string | null;
  insurance_status: "to_complete" | "insured" | "suspended" | "unpaid";
  current_driver_id: string | null;
  current_driver_name: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export const VEHICLE_OWNERSHIP_TYPES = ["owned", "long_term_rental", "short_term_rental", "loan"] as const;
export type VehicleOwnershipType = (typeof VEHICLE_OWNERSHIP_TYPES)[number];

export type VehicleInput = {
  registration: string;
  make: string;
  model: string;
  year: number | null;
  technicalInspectionDate: string | null;
  insuranceCompany: string | null;
  insuranceExpiryDate: string | null;
  bonusMalus: number | null;
  ownershipType: VehicleOwnershipType;
  registeredHolder: string | null;
};

const vehicleColumns = `
  v.id, v.tenant_id, v.registration, v.make, v.model, v.year,
  latest_mileage.mileage AS current_mileage,
  latest_inspection.technical_due_date::text AS technical_inspection_date, v.insurance_company,
  v.insurance_expiry_date::text, v.bonus_malus::text,
  v.ownership_type, v.registered_holder,
  v.insurance_status,
  d.id::text AS current_driver_id, d.full_name AS current_driver_name,
  v.created_at::text, v.updated_at::text, v.archived_at::text
`;
const vehicleJoins = `FROM vehicle v
  LEFT JOIN LATERAL (
    SELECT r.mileage FROM vehicle_mileage_reading r
    WHERE r.tenant_id = v.tenant_id AND r.vehicle_id = v.id AND r.status = 'valid'
    ORDER BY r.reading_date DESC, r.created_at DESC, r.id DESC
    LIMIT 1
  ) latest_mileage ON true
  LEFT JOIN LATERAL (
    SELECT i.technical_due_date FROM vehicle_inspection i
    WHERE i.tenant_id = v.tenant_id AND i.vehicle_id = v.id
    ORDER BY i.recorded_at DESC, i.id DESC LIMIT 1
  ) latest_inspection ON true
  LEFT JOIN assignment a ON a.tenant_id = v.tenant_id AND a.vehicle_id = v.id AND a.ended_at IS NULL
  LEFT JOIN driver d ON d.tenant_id = v.tenant_id AND d.id = a.driver_id`;

export async function listVehicles(tenantId: string, view: "active" | "archived" = "active", attention: "inspection" | "insurance" | null = null) {
  const result = await pool.query<Vehicle>(
    `SELECT ${vehicleColumns} ${vehicleJoins} WHERE v.tenant_id = $1
       AND (($2 = 'active' AND v.archived_at IS NULL) OR ($2 = 'archived' AND v.archived_at IS NOT NULL))
       AND ($3::text IS NULL
         OR ($3 = 'inspection' AND latest_inspection.technical_due_date <= CURRENT_DATE + $4::int)
         OR ($3 = 'insurance' AND (v.insurance_status <> 'insured' OR v.insurance_expiry_date IS NULL
           OR v.insurance_expiry_date <= CURRENT_DATE + $4::int)))
     ORDER BY v.created_at DESC, v.registration ASC`,
    [tenantId, view, attention, DASHBOARD_ALERT_WINDOW_DAYS],
  );
  return result.rows;
}

export async function getVehicle(tenantId: string, id: string) {
  const result = await pool.query<Vehicle>(
    `SELECT ${vehicleColumns} ${vehicleJoins} WHERE v.tenant_id = $1 AND v.id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ?? null;
}

export async function createVehicle(tenantId: string, input: VehicleInput) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO vehicle (
      id, tenant_id, registration, make, model, year,
      technical_inspection_date, insurance_company, insurance_expiry_date, bonus_malus,
      ownership_type, registered_holder, insurance_status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
      CASE WHEN NULLIF(BTRIM($8::text), '') IS NOT NULL AND $9::date >= CURRENT_DATE
        THEN 'insured' ELSE 'to_complete' END)`,
    [
      id, tenantId, input.registration, input.make, input.model,
      input.year, input.technicalInspectionDate,
      input.insuranceCompany, input.insuranceExpiryDate, input.bonusMalus,
      input.ownershipType, input.registeredHolder,
    ],
  );
  return (await getVehicle(tenantId, id))!;
}

export async function updateVehicle(tenantId: string, id: string, input: VehicleInput) {
  const result = await pool.query<{ id: string }>(
    `UPDATE vehicle SET
      registration = $3, make = $4, model = $5, year = $6,
      technical_inspection_date = COALESCE($7, technical_inspection_date), insurance_company = $8,
      insurance_expiry_date = $9, bonus_malus = $10,
      ownership_type = $11, registered_holder = $12,
      insurance_status = CASE
        WHEN EXISTS (SELECT 1 FROM vehicle_insurance_event e
          WHERE e.tenant_id = $1 AND e.vehicle_id = $2 AND e.status = 'active')
          THEN insurance_status
        WHEN NULLIF(BTRIM($8::text), '') IS NOT NULL AND $9::date >= CURRENT_DATE THEN 'insured'
        ELSE 'to_complete' END,
      updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL
    RETURNING id`,
    [
      tenantId, id, input.registration, input.make, input.model, input.year,
      input.technicalInspectionDate, input.insuranceCompany, input.insuranceExpiryDate,
      input.bonusMalus, input.ownershipType, input.registeredHolder,
    ],
  );
  return result.rows[0] ? await getVehicle(tenantId, id) : null;
}
