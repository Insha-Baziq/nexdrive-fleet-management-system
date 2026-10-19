import assert from "node:assert/strict";
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
  { name: "Mileage Driver Assigned", role: "driver", tenantId: tenantA },
  { name: "Mileage Driver Unassigned", role: "driver", tenantId: tenantA },
  { name: "Mileage Manager", role: "manager", tenantId: tenantA },
  { name: "Mileage Driver Other Tenant", role: "driver", tenantId: tenantB },
].map((user, index) => ({ ...user, email: `ticket27-mileage-${runId}-${index}@example.invalid` }));
const emails = users.map((user) => user.email);
const vehicleA = randomUUID();
const vehicleB = randomUUID();
const assignedDriverId = randomUUID();
const unassignedDriverId = randomUUID();
const otherTenantDriverId = randomUUID();
const readingDate = "2026-09-27";

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

async function insertVehicle(id, tenantId, registration) {
  await pool.query(
    `INSERT INTO vehicle (id, tenant_id, registration, make, model, current_mileage)
     VALUES ($1, $2, $3, 'Renault', 'Trafic', NULL)`,
    [id, tenantId, registration],
  );
}

async function insertLinkedDriver(id, tenantId, userId, name) {
  await pool.query(
    `INSERT INTO driver (id, tenant_id, user_id, full_name) VALUES ($1, $2, $3, $4)`,
    [id, tenantId, userId, name],
  );
}

try {
  const table = await pool.query("SELECT to_regclass('vehicle_mileage_reading') AS name");
  assert.ok(table.rows[0].name, "Ticket 19 vehicle mileage history migration must be applied");

  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, $2), ($3, $4)",
    [tenantA, `Ticket 27 Assigned ${runId}`, tenantB, `Ticket 27 Other ${runId}`]);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    await pool.query('UPDATE "user" SET "tenantId" = $1, "appRole" = $2, "emailVerified" = true WHERE email = $3',
      [user.tenantId, user.role, user.email]);
  }
  const accountRows = await pool.query('SELECT id, email FROM "user" WHERE email = ANY($1::text[])', [emails]);
  const userIds = new Map(accountRows.rows.map((row) => [row.email, row.id]));
  const [assignedCookie, unassignedCookie, managerCookie, otherTenantCookie] = await Promise.all(users.map((user) => signIn(user.email)));

  await insertVehicle(vehicleA, tenantA, `T27-${runId.slice(0, 8)}-A`);
  await insertVehicle(vehicleB, tenantB, `T27-${runId.slice(0, 8)}-B`);
  await insertLinkedDriver(assignedDriverId, tenantA, userIds.get(users[0].email), users[0].name);
  await insertLinkedDriver(unassignedDriverId, tenantA, userIds.get(users[1].email), users[1].name);
  await insertLinkedDriver(otherTenantDriverId, tenantB, userIds.get(users[3].email), users[3].name);
  await pool.query(
    `INSERT INTO assignment (id, tenant_id, vehicle_id, driver_id, started_at, start_reason, created_by_user_id)
     VALUES ($1, $2, $3, $4, '2026-01-01T00:00:00Z', 'Ticket 27 verification', $5)`,
    [randomUUID(), tenantA, vehicleA, assignedDriverId, userIds.get(users[2].email)],
  );

  assert.equal((await request("/api/my-vehicle/mileage", "POST", null,
    { readingDate, mileage: 48275 })).status, 401, "anonymous writes are denied");
  assert.equal((await request("/api/my-vehicle/mileage", "POST", managerCookie,
    { readingDate, mileage: 48275 })).status, 403, "non-driver writes are denied");
  assert.equal((await request("/api/my-vehicle/mileage", "POST", unassignedCookie,
    { readingDate, mileage: 48275 })).status, 409, "an unassigned Driver cannot declare mileage");
  assert.equal((await request("/api/my-vehicle/mileage", "POST", otherTenantCookie,
    { readingDate, mileage: 48275 })).status, 409, "a different tenant cannot write through an account without its own assignment");

  const identityQuery = new URLSearchParams({ vehicleId: vehicleB, driverId: otherTenantDriverId, tenantId: tenantB });
  assert.equal((await request(`/api/my-vehicle/mileage?${identityQuery}`, "POST", assignedCookie,
    { readingDate, mileage: 48275 })).status, 400, "query-string IDs cannot redirect the write");
  for (const identity of ["vehicleId", "driverId", "tenantId", "userId"]) {
    const result = await request("/api/my-vehicle/mileage", "POST", assignedCookie,
      { readingDate, mileage: 48275, [identity]: identity === "tenantId" ? tenantB : identity === "vehicleId" ? vehicleB : otherTenantDriverId });
    assert.equal(result.status, 400, `${identity} in the request body is rejected`);
  }

  const invalidReadings = [
    { readingDate: "2025-02-29", mileage: 100 },
    { readingDate: "2024-02-30", mileage: 100 },
    { readingDate: "2024-02-29T00:00:00Z", mileage: 100 },
    { readingDate: "", mileage: 0 },
    { readingDate, mileage: -1 },
    { readingDate, mileage: 1.5 },
    { readingDate, mileage: 2147483648 },
    { readingDate, mileage: Number.MAX_SAFE_INTEGER + 1 },
    { readingDate, mileage: "not a number" },
    { readingDate, mileage: "" },
    { readingDate, mileage: true },
    { readingDate, mileage: 12, note: "n".repeat(501) },
  ];
  for (const [index, invalid] of invalidReadings.entries()) {
    const result = await request("/api/my-vehicle/mileage", "POST", assignedCookie, invalid);
    assert.equal(result.status, 400, `invalid reading ${index + 1} is rejected: ${JSON.stringify(result.data)}`);
  }

  const newest = await request("/api/my-vehicle/mileage", "POST", assignedCookie,
    { readingDate, mileage: "48275", note: "n".repeat(500) });
  assert.equal(newest.status, 201, JSON.stringify(newest.data));
  assert.equal(newest.data.reading.vehicle_id, vehicleA, "vehicle comes from the active server-side assignment");
  assert.equal(newest.data.reading.recorded_by_name, users[0].name, "authenticated Driver is recorded as actor");
  assert.equal(newest.data.reading.note.length, 500, "the maximum permitted note length is accepted");

  const zeroInput = { readingDate: "2026-09-25", mileage: 0, note: "Zero is a valid whole kilometre reading." };
  const zeroWarning = await request("/api/my-vehicle/mileage", "POST", assignedCookie, zeroInput);
  assert.equal(zeroWarning.status, 409, "a lower zero reading asks for acknowledgement");
  const zero = await request("/api/my-vehicle/mileage", "POST", assignedCookie,
    { ...zeroInput, acknowledgeLowerThanReadingId: zeroWarning.data.warning.latest.id });
  assert.equal(zero.status, 201, "zero is an accepted lower-bound reading");
  const maximum = await request("/api/my-vehicle/mileage", "POST", assignedCookie,
    { readingDate: "2026-09-26", mileage: 2147483647 });
  assert.equal(maximum.status, 201, "the maximum database-supported whole kilometre value is accepted");
  const older = await request("/api/my-vehicle/mileage", "POST", assignedCookie,
    { readingDate: "2026-09-20", mileage: 90000 });
  assert.equal(older.status, 201);

  const stored = await pool.query(
    `SELECT id::text, tenant_id, vehicle_id::text, recorded_by_user_id, reading_date::text, mileage, note
     FROM vehicle_mileage_reading WHERE tenant_id = $1 AND vehicle_id = $2 ORDER BY reading_date DESC, created_at DESC, id DESC`,
    [tenantA, vehicleA],
  );
  assert.equal(stored.rows.length, 4, "each accepted Driver entry persists in shared vehicle history");
  assert.equal(stored.rows[0].id, newest.data.reading.id);
  assert.equal(stored.rows[0].recorded_by_user_id, userIds.get(users[0].email));
  assert.equal(stored.rows[0].mileage, 48275);
  assert.equal(stored.rows[0].note.length, 500);

  const freshAssignedCookie = await signIn(users[0].email);
  const freshPage = await request("/my-vehicle", "GET", freshAssignedCookie);
  assert.equal(freshPage.status, 200);
  assert.match(freshPage.data, /48(?:,|\s|\u00a0|\u202f)275 km/, "current mileage uses shared latest-valid-reading logic after a new sign-in");
  assert.match(freshPage.data, /Declare mileage|Déclarer le kilométrage/, "assigned Driver sees the entry action");
  const freshUnassignedCookie = await signIn(users[1].email);
  const emptyPage = await request("/my-vehicle", "GET", freshUnassignedCookie);
  assert.equal(emptyPage.status, 200);
  assert.match(emptyPage.data, /No vehicle is currently assigned|Aucun véhicule n.est actuellement attribué/);
  assert.doesNotMatch(emptyPage.data, /Declare mileage|Déclarer le kilométrage/, "unassigned Driver does not see the action");

  process.stdout.write("Driver mileage-entry verification passed: assigned Driver write into shared dated history; authenticated actor and server-derived vehicle; unassigned and non-driver denial; body/query ID tampering; valid zero and maximum whole-kilometre boundaries; invalid calendar dates, negative/fractional/overflow/malformed values and oversized notes; retained latest-reading calculation; persistence after a fresh sign-in; assigned and unassigned My Vehicle states.\n");
} finally {
  try {
    await pool.query("DELETE FROM assignment WHERE tenant_id = ANY($1::text[])", [[tenantA, tenantB]]).catch(() => undefined);
    await pool.query("DELETE FROM vehicle_mileage_reading WHERE tenant_id = ANY($1::text[])", [[tenantA, tenantB]]).catch(() => undefined);
    await pool.query("DELETE FROM driver WHERE tenant_id = ANY($1::text[])", [[tenantA, tenantB]]).catch(() => undefined);
    await pool.query("DELETE FROM vehicle WHERE tenant_id = ANY($1::text[])", [[tenantA, tenantB]]).catch(() => undefined);
    await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [emails]).catch(() => undefined);
    await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [[tenantA, tenantB]]).catch(() => undefined);
  } finally {
    await pool.end();
  }
}
