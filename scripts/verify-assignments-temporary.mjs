import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.BETTER_AUTH_SECRET || !process.env.DATABASE_URL) throw new Error("Local auth and database environment is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const auth = betterAuth({
  baseURL: origin, secret: process.env.BETTER_AUTH_SECRET,
  database: { dialect: new PostgresDialect({ pool }), type: "postgres" },
  emailAndPassword: { enabled: true },
  user: { additionalFields: {
    tenantId: { type: "string", required: false, input: false },
    appRole: { type: ["administrator", "fleet_manager", "manager", "driver"], required: false, input: false },
  } },
});
const runId = randomUUID();
const tenantA = randomUUID(), tenantB = randomUUID();
const driverRequiredFields = {
  dateOfBirth: "1990-08-15", streetNumber: "12 bis", streetName: "Rue de la Paix", postalCode: "75002", city: "Paris",
};
const password = randomBytes(24).toString("base64url");
const users = [
  { role: "administrator", tenant: tenantA }, { role: "fleet_manager", tenant: tenantA },
  { role: "manager", tenant: tenantA }, { role: "driver", tenant: tenantA },
  { role: "administrator", tenant: tenantB },
].map((user, index) => ({ ...user, name: `Assignment QA ${index}`, email: `assignment-${runId}-${index}@example.invalid` }));
async function request(path, method = "GET", cookie, body) {
  const response = await fetch(`${origin}${path}`, {
    method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json", origin } : {}) },
    body: body ? JSON.stringify(body) : undefined, redirect: "manual",
  });
  const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, data, response };
}
async function signIn(email) {
  const result = await request("/api/auth/sign-in/email", "POST", null, { email, password });
  assert.equal(result.status, 200);
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}
const time = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
async function constraintFailure(sql, args, code) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let actual;
    try { await client.query(sql, args); } catch (error) { actual = error.code; }
    assert.equal(actual, code);
  } finally { await client.query("ROLLBACK"); client.release(); }
}
try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Assignment QA A'), ($2, 'Assignment QA B')", [tenantA, tenantB]);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const result = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2, "emailVerified"=true WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = result.rows[0].id;
  }
  const [admin, fleet, manager, driver, otherAdmin] = await Promise.all(users.map((user) => signIn(user.email)));
  const vehicles = [], drivers = [];
  for (let index = 0; index < 3; index++) {
    const v = await request("/api/vehicles", "POST", admin, { registration: `QA-${index}-AA`, make: "Renault", model: "Kangoo", ownershipType: "owned" });
    const d = await request("/api/drivers", "POST", fleet, { fullName: `Assignment Driver ${index}`, ...driverRequiredFields });
    assert.equal(v.status, 201); assert.equal(d.status, 201);
    vehicles.push(v.data.vehicle.id); drivers.push(d.data.driver.id);
  }
  const otherVehicle = (await request("/api/vehicles", "POST", otherAdmin, { registration: "QA-B-AA", make: "Renault", model: "Kangoo", ownershipType: "owned" })).data.vehicle.id;
  const otherDriver = (await request("/api/drivers", "POST", otherAdmin, { fullName: "Other Tenant Driver", ...driverRequiredFields })).data.driver.id;
  const initialStartedAt = time(120);
  const body = { vehicleId: vehicles[0], driverId: drivers[0], startedAt: initialStartedAt, startReason: "Initial allocation" };
  assert.equal((await request("/api/assignments", "POST", null, body)).status, 401);
  assert.equal((await request("/api/assignments", "POST", manager, body)).status, 403);
  assert.equal((await request("/api/assignments", "POST", driver, body)).status, 403);
  assert.equal((await request("/api/assignments", "POST", admin, { ...body, tenantId: tenantB })).status, 400);
  assert.equal((await request("/api/assignments", "POST", admin, { ...body, createdByUserId: users[4].id })).status, 400);
  assert.equal((await request("/api/assignments", "POST", admin, { ...body, vehicleId: otherVehicle })).status, 400);
  assert.equal((await request("/api/assignments", "POST", admin, { ...body, driverId: otherDriver })).status, 400);
  assert.equal((await request("/api/assignments", "POST", admin, { ...body, startedAt: "not a date" })).status, 400);
  assert.equal((await request("/api/assignments", "POST", admin, { ...body, startedAt: "2026-02-30T10:00:00Z" })).status, 400);
  assert.equal((await request("/api/assignments", "POST", admin, { ...body, startedAt: time(-30) })).status, 400);
  assert.equal((await request("/api/assignments", "POST", admin, body)).status, 201);
  assert.equal((await request("/api/assignments", "POST", admin, body)).status, 409);
  assert.equal((await request(`/api/vehicles/${vehicles[0]}`, "GET", admin)).data.vehicle.current_driver_id, drivers[0]);
  assert.equal((await request(`/api/drivers/${drivers[0]}`, "GET", fleet)).data.driver.current_vehicle_id, vehicles[0]);
  assert.equal((await request("/api/assignments", "POST", fleet, { vehicleId: vehicles[1], driverId: drivers[1], startedAt: time(90) })).status, 201);
  const transition = { vehicleId: vehicles[0], driverId: drivers[1], startedAt: time(60), closureReason: "Vehicle reassigned" };
  assert.equal((await request("/api/assignments", "POST", fleet, { ...transition, closureReason: "" })).status, 400);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM assignment WHERE tenant_id=$1 AND ended_at IS NULL", [tenantA])).rows[0].n, 2);
  assert.equal((await request("/api/assignments", "POST", fleet, transition)).status, 201);
  const journal = await request("/api/assignments/history", "GET", manager);
  assert.equal(journal.status, 200, "Manager can read the assignment journal");
  const endedEntry = journal.data.assignments.find((entry) => entry.driver_id === drivers[0]);
  const activeEntry = journal.data.assignments.find((entry) => entry.vehicle_id === vehicles[0] && entry.ended_at === null);
  assert.ok(endedEntry && activeEntry, "journal exposes ended and active rows for reassignment");
  assert.equal(endedEntry.end_reason, "Vehicle reassigned");
  assert.equal(endedEntry.created_by_name, users[0].name);
  assert.equal((await request("/api/assignments/history", "GET", driver)).status, 403, "Driver cannot read the organization journal");
  assert.deepEqual((await request("/api/assignments/history", "GET", otherAdmin)).data.assignments, [], "journal is tenant scoped");
  const historyDetail = await request("/api/assignments/history/" + endedEntry.id, "GET", admin);
  assert.equal(historyDetail.status, 200);
  assert.equal(historyDetail.data.assignment.end_reason, "Vehicle reassigned");
  assert.equal(historyDetail.data.assignment.created_by_name, users[0].name);
  assert.equal((await request("/api/assignments/history/" + endedEntry.id, "GET", otherAdmin)).status, 404);
  assert.equal((await request("/api/assignments/history/" + endedEntry.id, "GET", driver)).status, 403);

  assert.equal((await request("/assignments/quick", "GET", admin)).status, 200, "Administrator can open Quick Assignment");
  assert.equal((await request("/assignments/quick", "GET", fleet)).status, 200, "Fleet Manager can open Quick Assignment");
  assert.equal((await request("/assignments/quick", "GET", manager)).status, 404, "Manager cannot use Quick Assignment");
  assert.equal((await request("/assignments/quick", "GET", driver)).status, 404, "Driver cannot use Quick Assignment");
  assert.equal((await request("/assignments/journal", "GET", manager)).status, 200);
  assert.equal((await request("/assignments/journal", "GET", driver)).status, 404);
  assert.equal((await request("/assignments/lookup", "GET", manager)).status, 200);
  assert.equal((await request("/assignments/lookup", "GET", driver)).status, 404);

  const lookup = (vehicleId, at, cookie = manager) => request("/api/assignments/lookup?vehicleId=" + vehicleId + "&at=" + encodeURIComponent(at), "GET", cookie);
  const beforeTransition = await lookup(vehicles[0], new Date(Date.parse(transition.startedAt) - 1).toISOString());
  assert.equal(beforeTransition.status, 200);
  assert.equal(beforeTransition.data.recordedAssignment.driver_id, drivers[0]);
  const atInitialStart = await lookup(vehicles[0], initialStartedAt);
  assert.equal(atInitialStart.data.recordedAssignment.driver_id, drivers[0], "assignment start boundary is inclusive");
  const atTransitionBoundary = await lookup(vehicles[0], transition.startedAt);
  assert.equal(atTransitionBoundary.data.recordedAssignment.driver_id, drivers[1], "ended boundary is exclusive and replacement start is inclusive");
  const beforeInitialStart = await lookup(vehicles[0], new Date(Date.parse(initialStartedAt) - 1).toISOString());
  assert.equal(beforeInitialStart.status, 200);
  assert.equal(beforeInitialStart.data.recordedAssignment, null, "outside every period returns a no-assignment result");
  assert.equal((await lookup(otherVehicle, transition.startedAt, admin)).status, 404, "cross-tenant vehicle IDs cannot be looked up");
  assert.equal((await lookup(vehicles[0], transition.startedAt, driver)).status, 403);
  assert.equal((await lookup(vehicles[0], "not-a-date")).status, 400);

  const history = await pool.query("SELECT * FROM assignment WHERE tenant_id=$1 ORDER BY started_at", [tenantA]);
  assert.equal(history.rows.length, 3);
  assert.equal(history.rows.filter((row) => row.ended_at).length, 2);
  for (const row of history.rows.filter((entry) => entry.ended_at)) {
    assert.equal(row.end_reason, "Vehicle reassigned");
    assert.equal(row.ended_by_user_id, users[1].id);
    assert.equal(row.ended_at.toISOString(), transition.startedAt);
  }
  assert.equal((await request(`/api/vehicles/${vehicles[1]}`, "GET", admin)).data.vehicle.current_driver_id, null);
  assert.equal((await request(`/api/drivers/${drivers[0]}`, "GET", admin)).data.driver.current_vehicle_id, null);
  assert.equal((await request("/api/assignments", "POST", admin, { vehicleId: vehicles[1], driverId: drivers[0], startedAt: time(100) })).status, 409);
  assert.equal((await request("/api/assignments", "POST", admin, { vehicleId: vehicles[2], driverId: drivers[2], startedAt: time(50) })).status, 201);
  const concurrentTime = time(30);
  const race = await Promise.all([drivers[0], drivers[2]].map((driverId) => request("/api/assignments", "POST", admin, {
    vehicleId: vehicles[0], driverId, startedAt: concurrentTime, closureReason: "Concurrent reassignment check",
  })));
  assert.deepEqual(race.map((result) => result.status).sort(), [201, 409]);
  const active = (await pool.query("SELECT * FROM assignment WHERE tenant_id=$1 AND ended_at IS NULL", [tenantA])).rows;
  assert.equal(active.filter((row) => row.vehicle_id === vehicles[0]).length, 1);
  assert.equal(new Set(active.map((row) => row.vehicle_id)).size, active.length);
  assert.equal(new Set(active.map((row) => row.driver_id)).size, active.length);
  const current = active.find((row) => row.vehicle_id === vehicles[0]);
  const insertSql = "INSERT INTO assignment (id,tenant_id,vehicle_id,driver_id,started_at,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)";
  await constraintFailure(insertSql, [randomUUID(), tenantA, current.vehicle_id, drivers[1], time(10), users[0].id], "23505");
  await constraintFailure(insertSql, [randomUUID(), tenantA, vehicles[1], current.driver_id, time(10), users[0].id], "23505");
  await constraintFailure(insertSql, [randomUUID(), tenantA, otherVehicle, drivers[1], time(10), users[0].id], "23503");
  const fresh = await signIn(users[0].email);
  assert.equal((await request(`/api/vehicles/${vehicles[0]}`, "GET", fresh)).data.vehicle.current_driver_id, current.driver_id);
  assert.equal((await request(`/api/vehicles/${vehicles[0]}`, "GET", otherAdmin)).status, 404);
  const managerPage = await request(`/vehicles/${vehicles[0]}`, "GET", manager);
  assert.equal(managerPage.status, 200);
  assert.match(managerPage.data, /Assignment history|Historique/);
  assert.ok(!managerPage.data.includes("Assign driver"));
  assert.ok(!managerPage.data.includes("Change driver"));
  process.stdout.write("Assignment verification passed: create, two-sided reassignment, reasons/history, current state, concurrency, database constraints, two tenants/four roles, request tampering, fresh sign-in and read-only page.\n");
} finally {
  await pool.query("DELETE FROM assignment WHERE tenant_id=ANY($1::text[])", [[tenantA, tenantB]]);
  await pool.query("DELETE FROM driver WHERE tenant_id=ANY($1::text[])", [[tenantA, tenantB]]);
  await pool.query("DELETE FROM vehicle WHERE tenant_id=ANY($1::text[])", [[tenantA, tenantB]]);
  await pool.query('DELETE FROM "user" WHERE email=ANY($1::text[])', [users.map((user) => user.email)]);
  await pool.query("DELETE FROM tenant WHERE id=ANY($1::text[])", [[tenantA, tenantB]]);
  await pool.end();
}
