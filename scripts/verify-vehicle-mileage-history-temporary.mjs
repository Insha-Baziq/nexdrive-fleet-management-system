import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.BETTER_AUTH_SECRET || !process.env.DATABASE_URL) {
  throw new Error("BETTER_AUTH_URL, BETTER_AUTH_SECRET, and DATABASE_URL are required; the app must be running at BETTER_AUTH_URL.");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const auth = betterAuth({
  baseURL: origin,
  secret: process.env.BETTER_AUTH_SECRET,
  database: { dialect: new PostgresDialect({ pool }), type: "postgres" },
  emailAndPassword: { enabled: true },
  user: { additionalFields: {
    tenantId: { type: "string", required: false, input: false },
    appRole: { type: ["administrator", "fleet_manager", "manager", "driver"], required: false, input: false },
  } },
});

const runId = randomUUID();
const tenantA = randomUUID();
const tenantB = randomUUID();
const password = randomBytes(24).toString("base64url");
const users = [
  { name: "Mileage Admin A", role: "administrator", tenant: tenantA },
  { name: "Mileage Fleet A", role: "fleet_manager", tenant: tenantA },
  { name: "Mileage Manager A", role: "manager", tenant: tenantA },
  { name: "Mileage Driver A", role: "driver", tenant: tenantA },
  { name: "Mileage Admin B", role: "administrator", tenant: tenantB },
].map((user, index) => ({ ...user, email: `mileage-verify-${runId}-${index}@example.invalid` }));
const legacyNonzeroId = randomUUID();
const legacyZeroId = randomUUID();
const vehicleIds = [legacyNonzeroId, legacyZeroId];
const driverId = randomUUID();
const migrationSql = await readFile(new URL("../migrations/015_vehicle_mileage_history.sql", import.meta.url), "utf8");

async function request(path, method = "GET", cookie, body) {
  const response = await fetch(new URL(path, origin), {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json", origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : await response.text();
  return { status: response.status, data, response };
}

async function signIn(email) {
  const { status, response } = await request("/api/auth/sign-in/email", "POST", null, { email, password });
  assert.equal(status, 200, `sign-in failed for ${email}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "sign-in did not return a session cookie");
  return cookie;
}

function vehicleInput(registration) {
  return {
    registration,
    make: "Renault",
    model: "Trafic",
    ownershipType: "owned",
    year: "2022",
    technicalInspectionDate: "2026-10-12",
    insuranceCompany: "Groupama",
    insuranceExpiryDate: "2027-03-14",
    bonusMalus: "0.85",
  };
}

async function applyMigration() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(migrationSql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  await pool.query("insert into tenant (id, name) values ($1, $2), ($3, $4)",
    [tenantA, "Mileage Verification A", tenantB, "Mileage Verification B"]);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    await pool.query('update "user" set "tenantId" = $1, "appRole" = $2 where email = $3',
      [user.tenant, user.role, user.email]);
  }

  const accountRows = await pool.query('select id, email from "user" where email = any($1::text[])', [users.map((user) => user.email)]);
  const userIds = new Map(accountRows.rows.map((row) => [row.email, row.id]));
  const [adminA, fleetA, managerA, driverA, adminB] = await Promise.all(users.map((user) => signIn(user.email)));

  await applyMigration();
  await pool.query(
    `insert into vehicle (id, tenant_id, registration, make, model, current_mileage, created_at, updated_at)
     values ($1, $2, 'LEG-100-A', 'Renault', 'Trafic', 54321, '2024-03-10T00:00:00Z', '2025-04-12T00:00:00Z'),
            ($3, $2, 'LEG-000-A', 'Renault', 'Trafic', 0, '2024-03-10T00:00:00Z', '2025-04-13T00:00:00Z')`,
    [legacyNonzeroId, tenantA, legacyZeroId],
  );
  await applyMigration();
  const migrated = await pool.query(
    `select vehicle_id, reading_date::text, mileage, note
     from vehicle_mileage_reading where tenant_id = $1 and vehicle_id = any($2::uuid[])
     order by vehicle_id`,
    [tenantA, vehicleIds],
  );
  assert.equal(migrated.rows.length, 2, "non-null legacy values, including zero, become history rows");
  const migratedNonzero = migrated.rows.find((row) => row.vehicle_id === legacyNonzeroId);
  assert.equal(migratedNonzero.mileage, 54321);
  assert.equal(migratedNonzero.reading_date, "2025-04-12");
  assert.match(migratedNonzero.note, /migrated/i);
  assert.equal(migrated.rows.find((row) => row.vehicle_id === legacyZeroId).mileage, 0);
  await applyMigration();
  assert.equal((await pool.query("select count(*)::int AS count from vehicle_mileage_reading where tenant_id = $1 and vehicle_id = any($2::uuid[])", [tenantA, vehicleIds])).rows[0].count, 2,
    "reapplying the migration does not duplicate imported rows");

  assert.equal((await request(`/api/vehicles/${legacyNonzeroId}/mileage`, "GET")).status, 401);
  assert.equal((await request(`/api/vehicles/${legacyNonzeroId}/mileage`, "POST", null, { readingDate: "2025-04-14", mileage: 60000 })).status, 401);
  assert.equal((await request(`/api/vehicles/${legacyNonzeroId}/mileage`, "GET", driverA)).status, 403);
  assert.equal((await request(`/api/vehicles/${legacyNonzeroId}/mileage`, "POST", managerA, { readingDate: "2025-04-14", mileage: 60000 })).status, 403);
  assert.equal((await request(`/api/vehicles/${legacyNonzeroId}/mileage`, "POST", driverA, { readingDate: "2025-04-14", mileage: 60000 })).status, 403);
  assert.equal((await request(`/api/vehicles/${legacyNonzeroId}/mileage`, "GET", adminB)).status, 404);
  assert.equal((await request(`/api/vehicles/${legacyNonzeroId}/mileage`, "POST", adminB, { readingDate: "2025-04-14", mileage: 60000 })).status, 404);
  assert.equal((await request(`/api/vehicles/${legacyNonzeroId}/mileage/not-a-reading/cancel`, "POST", adminA, { cancellationReason: "wrong row" })).status, 404);

  const legacyList = await request("/api/vehicles", "GET", adminA);
  assert.equal(legacyList.status, 200);
  assert.equal(legacyList.data.vehicles.find((vehicle) => vehicle.id === legacyNonzeroId).current_mileage, 54321);
  assert.equal((await request(`/api/vehicles/${legacyNonzeroId}`, "GET", adminA)).data.vehicle.current_mileage, 54321);
  assert.equal((await request(`/api/vehicles/${legacyZeroId}`, "GET", adminA)).data.vehicle.current_mileage, 0);

  const createdVehicle = await request("/api/vehicles", "POST", adminA, vehicleInput("MILE-100-A"));
  assert.equal(createdVehicle.status, 201, JSON.stringify(createdVehicle.data));
  const vehicleId = createdVehicle.data.vehicle.id;
  assert.equal(createdVehicle.data.vehicle.current_mileage, null, "new vehicles begin without an invented odometer value");
  vehicleIds.push(vehicleId);
  assert.equal((await request("/api/vehicles", "POST", adminA, { ...vehicleInput("MILE-101-A"), currentMileage: "1" })).status, 400,
    "core vehicle forms reject the retired mileage field");
  assert.equal((await request(`/api/vehicles/${vehicleId}`, "PATCH", adminA, { ...vehicleInput("MILE-100-A"), currentMileage: "2" })).status, 400);

  const rejectedBodies = [
    { readingDate: "2025-02-29", mileage: 100 },
    { readingDate: "2024-02-30", mileage: 100 },
    { readingDate: "2025-04-12T00:00:00Z", mileage: 100 },
    { readingDate: "2025-04-12", mileage: -1 },
    { readingDate: "2025-04-12", mileage: 1.5 },
    { readingDate: "2025-04-12", mileage: 2147483648 },
    { readingDate: "2025-04-12", mileage: "not a number" },
    { readingDate: "2025-04-12", mileage: "" },
    { readingDate: "2025-04-12", mileage: true },
    { readingDate: "2025-04-12", mileage: 100, note: "n".repeat(501) },
    { readingDate: "2025-04-12", mileage: 100, tenantId: tenantB },
  ];
  for (const [index, invalid] of rejectedBodies.entries()) {
    const result = await request(`/api/vehicles/${vehicleId}/mileage`, "POST", adminA, invalid);
    assert.equal(result.status, 400, `invalid mileage payload ${index + 1} should be rejected: ${JSON.stringify(result.data)}`);
  }

  const firstReading = await request(`/api/vehicles/${vehicleId}/mileage`, "POST", fleetA,
    { readingDate: "2025-04-12", mileage: "48260", note: "Routine check" });
  assert.equal(firstReading.status, 201, JSON.stringify(firstReading.data));
  assert.equal(firstReading.data.reading.mileage, 48260);
  assert.equal(firstReading.data.reading.recorded_by_name, users[1].name);
  assert.equal(firstReading.data.reading.note, "Routine check");
  const sameDayLatest = await request(`/api/vehicles/${vehicleId}/mileage`, "POST", adminA,
    { readingDate: "2025-04-12", mileage: 48275 });
  assert.equal(sameDayLatest.status, 201);
  assert.equal(sameDayLatest.data.reading.note, null);
  const olderDateLaterEntry = await request(`/api/vehicles/${vehicleId}/mileage`, "POST", fleetA,
    { readingDate: "2025-04-11", mileage: 50000, note: "Older date entered later" });
  assert.equal(olderDateLaterEntry.status, 201);
  const upperBoundary = await request(`/api/vehicles/${vehicleId}/mileage`, "POST", fleetA,
    { readingDate: "2025-04-13", mileage: 2147483647 });
  assert.equal(upperBoundary.status, 201, JSON.stringify(upperBoundary.data));
  assert.equal(upperBoundary.data.reading.mileage, 2147483647);
  const lowerBoundAndNoteLimit = await request(`/api/vehicles/${vehicleId}/mileage`, "POST", fleetA,
    { readingDate: "2024-02-29", mileage: 0, note: "n".repeat(500) });
  assert.equal(lowerBoundAndNoteLimit.status, 201, JSON.stringify(lowerBoundAndNoteLimit.data));
  assert.equal(lowerBoundAndNoteLimit.data.reading.mileage, 0);
  assert.equal(lowerBoundAndNoteLimit.data.reading.note.length, 500);

  const history = await request(`/api/vehicles/${vehicleId}/mileage`, "GET", managerA);
  assert.equal(history.status, 200);
  assert.equal(history.data.readings.length, 5);
  assert.deepEqual(history.data.readings.map((reading) => reading.mileage), [2147483647, 48275, 48260, 50000, 0],
    "history sorts by observed date, then insertion order, not just insert time");
  assert.equal((await request(`/api/vehicles/${vehicleId}/mileage`, "GET", adminB)).status, 404);
  assert.equal((await request(`/api/vehicles/${vehicleId}/mileage`, "GET", driverA)).status, 403);
  assert.equal((await request(`/api/vehicles/${vehicleId}/mileage/${firstReading.data.reading.id}/cancel`, "POST", managerA, { cancellationReason: "Correction" })).status, 403);

  const cancelMissingReason = await request(`/api/vehicles/${vehicleId}/mileage/${upperBoundary.data.reading.id}/cancel`, "POST", fleetA, {});
  assert.equal(cancelMissingReason.status, 400);
  const cancelOversizedReason = await request(`/api/vehicles/${vehicleId}/mileage/${upperBoundary.data.reading.id}/cancel`, "POST", fleetA, { cancellationReason: "r".repeat(1001) });
  assert.equal(cancelOversizedReason.status, 400);
  assert.equal((await request(`/api/vehicles/${legacyNonzeroId}/mileage/${upperBoundary.data.reading.id}/cancel`, "POST", adminA, { cancellationReason: "Changed parent" })).status, 404,
    "a reading cannot be cancelled through an altered same-tenant vehicle ID");
  assert.equal((await request(`/api/vehicles/${vehicleId}/mileage/${upperBoundary.data.reading.id}/cancel`, "POST", adminB, { cancellationReason: "Other tenant" })).status, 404);

  const cancelled = await request(`/api/vehicles/${vehicleId}/mileage/${upperBoundary.data.reading.id}/cancel`, "POST", fleetA,
    { cancellationReason: "r".repeat(1000) });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.reading.status, "cancelled");
  assert.equal(cancelled.data.reading.cancellation_reason.length, 1000);
  assert.equal(cancelled.data.reading.cancelled_by_name, users[1].name);
  assert.equal((await request(`/api/vehicles/${vehicleId}/mileage/${upperBoundary.data.reading.id}/cancel`, "POST", adminA, { cancellationReason: "Again" })).status, 409);

  const fallbackList = await request("/api/vehicles", "GET", adminA);
  assert.equal(fallbackList.data.vehicles.find((vehicle) => vehicle.id === vehicleId).current_mileage, 48275,
    "cancelling latest value recalculates current mileage from the newest remaining valid reading");
  assert.equal((await request(`/api/vehicles/${vehicleId}`, "GET", adminA)).data.vehicle.current_mileage, 48275);
  const afterCancelHistory = await request(`/api/vehicles/${vehicleId}/mileage`, "GET", adminA);
  assert.equal(afterCancelHistory.data.readings.find((reading) => reading.id === upperBoundary.data.reading.id).cancellation_reason.length, 1000);
  const freshAdmin = await signIn(users[0].email);
  assert.equal((await request(`/api/vehicles/${vehicleId}`, "GET", freshAdmin)).data.vehicle.current_mileage, 48275,
    "valid value and cancellation persist across a fresh sign-in");

  await pool.query("insert into driver (id, tenant_id, user_id, full_name) values ($1, $2, $3, $4)",
    [driverId, tenantA, userIds.get(users[3].email), users[3].name]);
  await pool.query(
    `insert into assignment (id, tenant_id, vehicle_id, driver_id, started_at, start_reason, created_by_user_id)
     values ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'Mileage verification fixture', $5)`,
    [randomUUID(), tenantA, vehicleId, driverId, userIds.get(users[0].email)],
  );
  const myVehicle = await request("/my-vehicle", "GET", driverA);
  assert.equal(myVehicle.status, 200);
  assert.match(myVehicle.data, /48(?:,|\s|\u00a0|\u202f)275 km/, "Driver My Vehicle uses the latest valid mileage history row");

  const emptyList = await request("/api/vehicles", "GET", adminA);
  assert.equal(emptyList.data.vehicles.find((vehicle) => vehicle.id === vehicleId).current_mileage, 48275);
  const edit = await request(`/api/vehicles/${vehicleId}`, "PATCH", fleetA, { ...vehicleInput("MILE-100-A"), model: "Master" });
  assert.equal(edit.status, 200, JSON.stringify(edit.data));
  assert.equal(edit.data.vehicle.current_mileage, 48275, "editing core vehicle fields cannot erase mileage history");
  assert.equal((await request("/vehicles", "GET", driverA)).status, 404);

  const lower = { readingDate: "2025-04-16", mileage: 47000, note: "Correction vérifiée" };
  const warning = await request("/api/my-vehicle/mileage", "POST", driverA, lower);
  assert.equal(warning.status, 409, JSON.stringify(warning.data));
  assert.equal(warning.data.warning.type, "lower_mileage");
  assert.equal(warning.data.warning.latest.mileage, 48275);
  const intervening = await request(`/api/vehicles/${vehicleId}/mileage`, "POST", adminA,
    { readingDate: "2025-04-17", mileage: 49000 });
  assert.equal(intervening.status, 201);
  const stale = await request("/api/my-vehicle/mileage", "POST", driverA,
    { ...lower, acknowledgeLowerThanReadingId: warning.data.warning.latest.id });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.warning.latest.id, intervening.data.reading.id,
    "a newer reading requires a fresh acknowledgement");
  const confirmed = await request("/api/my-vehicle/mileage", "POST", driverA,
    { ...lower, acknowledgeLowerThanReadingId: intervening.data.reading.id });
  assert.equal(confirmed.status, 201, JSON.stringify(confirmed.data));
  assert.equal(confirmed.data.reading.lower_reading_acknowledged, true);
  assert.equal(confirmed.data.reading.compared_with_reading_id, intervening.data.reading.id);
  const normal = await request("/api/my-vehicle/mileage", "POST", driverA,
    { readingDate: "2025-04-18", mileage: 50000 });
  assert.equal(normal.status, 201, JSON.stringify(normal.data));
  assert.equal(normal.data.reading.lower_reading_acknowledged, false);

  process.stdout.write("Vehicle mileage verification passed: legacy history, role and tenant denial, cancellation, lower-reading warning, stale comparison, explicit acknowledgement, normal driver submission.\n");
} finally {
  try {
    const readingsTable = await pool.query("select to_regclass('vehicle_mileage_reading') AS name");
    await pool.query("delete from assignment where tenant_id = any($1::text[])", [[tenantA, tenantB]]).catch(() => undefined);
    await pool.query("delete from driver where tenant_id = any($1::text[])", [[tenantA, tenantB]]).catch(() => undefined);
    if (readingsTable.rows[0].name) {
      await pool.query("delete from vehicle_mileage_reading where tenant_id = any($1::text[])", [[tenantA, tenantB]]).catch(() => undefined);
    }
    await pool.query("delete from vehicle where tenant_id = any($1::text[])", [[tenantA, tenantB]]).catch(() => undefined);
    await pool.query('delete from "user" where email = any($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
    await pool.query("delete from tenant where id = any($1::text[])", [[tenantA, tenantB]]).catch(() => undefined);
  } finally {
    await pool.end();
  }
}
