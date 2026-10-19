import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db";

export type Driver = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  user_email: string | null;
  full_name: string;
  licence_number: string | null;
  licence_expiry_date: string | null;
  date_of_birth: string | null;
  street_number: string | null;
  street_name: string | null;
  postal_code: string | null;
  city: string | null;
  current_vehicle_id: string | null;
  current_vehicle_registration: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type DriverInput = {
  fullName: string;
  licenceNumber: string | null;
  licenceExpiryDate: string | null;
  userId: string | null;
  dateOfBirth: string;
  streetNumber: string;
  streetName: string;
  postalCode: string;
  city: string;
};

export type EligibleDriverUser = { id: string; name: string; email: string };

export type DriverWorkspaceVehicle = {
  driver_id: string;
  driver_name: string;
  vehicle_id: string | null;
  registration: string | null;
  make: string | null;
  model: string | null;
  current_mileage: number | null;
};

export class DriverLinkError extends Error {}

const columns = `d.id, d.tenant_id, d.user_id, u.email AS user_email,
  d.full_name, d.licence_number, d.licence_expiry_date::text,
  d.date_of_birth::text, d.street_number, d.street_name, d.postal_code, d.city,
  v.id::text AS current_vehicle_id, v.registration AS current_vehicle_registration,
  d.created_at::text, d.updated_at::text, d.archived_at::text`;

export async function listEligibleDriverUsers(tenantId: string, currentDriverId?: string) {
  const result = await pool.query<EligibleDriverUser>(
    `SELECT u.id, membership.display_name AS name, u.email FROM "user" u
     JOIN organization_membership membership ON membership.user_id=u.id
     LEFT JOIN driver d ON d.user_id = u.id AND d.tenant_id=membership.tenant_id
     WHERE membership.tenant_id = $1 AND membership.role = 'driver' AND membership.disabled_at IS NULL
       AND (d.id IS NULL OR d.id = $2)
     ORDER BY membership.display_name ASC, u.email ASC`,
    [tenantId, currentDriverId ?? null],
  );
  return result.rows;
}

async function checkAccountLink(client: PoolClient, tenantId: string, userId: string | null, driverId?: string) {
  if (!userId) return;
  const account = await client.query(
    `SELECT user_id FROM organization_membership WHERE user_id = $1 AND tenant_id = $2 AND role = 'driver' AND disabled_at IS NULL FOR UPDATE`,
    [userId, tenantId],
  );
  if (!account.rows[0]) throw new DriverLinkError("Select a Driver account from this organization.");
  const linked = await client.query(
    `SELECT id FROM driver WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2::uuid) AND tenant_id=$3`,
    [userId, driverId ?? null, tenantId],
  );
  if (linked.rows[0]) throw new DriverLinkError("This account is already linked to a driver.");
}

export async function listDrivers(tenantId: string, view: "active" | "archived" = "active") {
  const result = await pool.query<Driver>(
    `SELECT ${columns} FROM driver d LEFT JOIN "user" u ON u.id = d.user_id
     LEFT JOIN assignment a ON a.tenant_id = d.tenant_id AND a.driver_id = d.id AND a.ended_at IS NULL
     LEFT JOIN vehicle v ON v.tenant_id = d.tenant_id AND v.id = a.vehicle_id
     WHERE d.tenant_id = $1
       AND (($2 = 'active' AND d.archived_at IS NULL) OR ($2 = 'archived' AND d.archived_at IS NOT NULL))
     ORDER BY d.full_name ASC, d.id ASC`,
    [tenantId, view],
  );
  return result.rows;
}

export async function getDriver(tenantId: string, id: string) {
  const result = await pool.query<Driver>(
    `SELECT ${columns} FROM driver d LEFT JOIN "user" u ON u.id = d.user_id
     LEFT JOIN assignment a ON a.tenant_id = d.tenant_id AND a.driver_id = d.id AND a.ended_at IS NULL
     LEFT JOIN vehicle v ON v.tenant_id = d.tenant_id AND v.id = a.vehicle_id
     WHERE d.tenant_id = $1 AND d.id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ?? null;
}

export async function getDriverWorkspaceVehicle(tenantId: string, userId: string) {
  const result = await pool.query<DriverWorkspaceVehicle>(
    `SELECT d.id AS driver_id, d.full_name AS driver_name,
       v.id::text AS vehicle_id, v.registration, v.make, v.model,
       latest_mileage.mileage AS current_mileage
     FROM driver d
     JOIN "user" u ON u.id = d.user_id
       AND EXISTS (SELECT 1 FROM organization_membership membership WHERE membership.user_id=u.id AND membership.tenant_id=d.tenant_id AND membership.role='driver' AND membership.disabled_at IS NULL)
     LEFT JOIN assignment a ON a.tenant_id = d.tenant_id
       AND a.driver_id = d.id AND a.ended_at IS NULL
     LEFT JOIN vehicle v ON v.tenant_id = a.tenant_id AND v.id = a.vehicle_id
     LEFT JOIN LATERAL (
       SELECT r.mileage FROM vehicle_mileage_reading r
       WHERE r.tenant_id = v.tenant_id AND r.vehicle_id = v.id AND r.status = 'valid'
       ORDER BY r.reading_date DESC, r.created_at DESC, r.id DESC
       LIMIT 1
     ) latest_mileage ON true
     WHERE d.tenant_id = $1 AND d.user_id = $2 AND d.archived_at IS NULL
       AND (v.archived_at IS NULL OR v.id IS NULL)
     LIMIT 1`,
    [tenantId, userId],
  );
  return result.rows[0] ?? null;
}

export async function createDriver(tenantId: string, input: DriverInput) {
  const client = await pool.connect();
  const id = randomUUID();
  try {
    await client.query("BEGIN");
    await checkAccountLink(client, tenantId, input.userId);
    await client.query(
      `INSERT INTO driver
       (id, tenant_id, user_id, full_name, licence_number, licence_expiry_date,
        date_of_birth, street_number, street_name, postal_code, city)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11)`,
      [id, tenantId, input.userId, input.fullName, input.licenceNumber, input.licenceExpiryDate,
        input.dateOfBirth, input.streetNumber, input.streetName, input.postalCode, input.city],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return (await getDriver(tenantId, id))!;
}

export async function updateDriver(tenantId: string, id: string, input: DriverInput) {
  const client = await pool.connect();
  let found = false;
  try {
    await client.query("BEGIN");
    const existing = await client.query(`SELECT id FROM driver WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL FOR UPDATE`, [tenantId, id]);
    found = Boolean(existing.rows[0]);
    if (found) {
      await checkAccountLink(client, tenantId, input.userId, id);
      await client.query(
        `UPDATE driver SET user_id = $3, full_name = $4, licence_number = $5,
          licence_expiry_date = $6, date_of_birth = $7::date, street_number = $8,
          street_name = $9, postal_code = $10, city = $11, updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, input.userId, input.fullName, input.licenceNumber, input.licenceExpiryDate,
          input.dateOfBirth, input.streetNumber, input.streetName, input.postalCode, input.city],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return found ? await getDriver(tenantId, id) : null;
}
