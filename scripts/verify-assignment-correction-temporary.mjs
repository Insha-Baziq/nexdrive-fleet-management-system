import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.BETTER_AUTH_SECRET || !process.env.DATABASE_URL) throw new Error("Local auth and database environment is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
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
const tenantA = randomUUID(), tenantB = randomUUID();
const driverRequiredFields = {
  dateOfBirth: "1990-08-15", streetNumber: "12 bis", streetName: "Rue de la Paix", postalCode: "75002", city: "Paris",
};
const password = randomBytes(24).toString("base64url");
const users = [
  { role: "administrator", tenant: tenantA, name: "Correction Administrator" },
  { role: "fleet_manager", tenant: tenantA, name: "Correction Fleet Manager" },
  { role: "manager", tenant: tenantA, name: "Correction Manager" },
  { role: "driver", tenant: tenantA, name: "Correction Driver" },
  { role: "administrator", tenant: tenantB, name: "Other Tenant Administrator" },
].map((user, index) => ({ ...user, email: `assignment-correction-${runId}-${index}@example.invalid` }));

async function request(path, method = "GET", cookie, body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json", origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
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

const at = (daysAgo, hours = 8) => {
  const value = new Date(Date.now() - daysAgo * 86_400_000);
  value.setUTCHours(hours, 0, 0, 0);
  return value.toISOString();
};
const before = (value, minutes) => new Date(Date.parse(value) - minutes * 60_000).toISOString();
const after = (value, minutes) => new Date(Date.parse(value) + minutes * 60_000).toISOString();
let setupStarted = false;

try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Correction QA A'), ($2, 'Correction QA B')", [tenantA, tenantB]);
  setupStarted = true;
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2 WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = saved.rows[0].id;
  }
  const [admin, fleet, manager, driver, otherAdmin] = await Promise.all(users.map((user) => signIn(user.email)));
  const vehicle0 = (await request("/api/vehicles", "POST", admin, { registration: "CORR-A-AA", make: "Renault", model: "Kangoo", ownershipType: "owned" })).data.vehicle.id;
  const vehicle1 = (await request("/api/vehicles", "POST", admin, { registration: "CORR-B-AA", make: "Ford", model: "Transit", ownershipType: "owned" })).data.vehicle.id;
  const driver0 = (await request("/api/drivers", "POST", fleet, { fullName: "Correction Driver One", ...driverRequiredFields })).data.driver.id;
  const driver1 = (await request("/api/drivers", "POST", fleet, { fullName: "Correction Driver Two", ...driverRequiredFields })).data.driver.id;
  const otherVehicle = (await request("/api/vehicles", "POST", otherAdmin, { registration: "CORR-C-AA", make: "Peugeot", model: "Partner", ownershipType: "owned" })).data.vehicle.id;
  const otherDriver = (await request("/api/drivers", "POST", otherAdmin, { fullName: "Other Tenant Driver", ...driverRequiredFields })).data.driver.id;
  const otherAssignment = await request("/api/assignments", "POST", otherAdmin, {
    vehicleId: otherVehicle, driverId: otherDriver, startedAt: at(2),
  });
  assert.equal(otherAssignment.status, 201);

  const firstStart = at(20);
  const replacementStart = at(10);
  const otherAssignmentStart = at(9);
  const createdFirst = await request("/api/assignments", "POST", admin, { vehicleId: vehicle0, driverId: driver0, startedAt: firstStart });
  assert.equal(createdFirst.status, 201);
  const createdReplacement = await request("/api/assignments", "POST", fleet, {
    vehicleId: vehicle0, driverId: driver1, startedAt: replacementStart, closureReason: "Driver change",
  });
  assert.equal(createdReplacement.status, 201);
  const createdOther = await request("/api/assignments", "POST", fleet, { vehicleId: vehicle1, driverId: driver0, startedAt: otherAssignmentStart });
  assert.equal(createdOther.status, 201);

  const journal = await request("/api/assignments/history", "GET", manager);
  assert.equal(journal.status, 200);
  const ended = journal.data.assignments.find((assignment) => assignment.vehicle_id === vehicle0 && assignment.driver_id === driver0);
  const active = journal.data.assignments.find((assignment) => assignment.vehicle_id === vehicle0 && assignment.driver_id === driver1);
  assert.ok(ended && active);
  assert.deepEqual(ended.corrections, []);

  const endedId = ended.id;
  const endedCorrectedStart = after(firstStart, 60);
  const endedCorrectedEnd = before(replacementStart, 60);
  const activeCorrectedStart = after(replacementStart, 60);
  const correct = (id, startedAt, endedAt, reason, cookie = admin) => request(
    `/api/assignments/history/${id}`, "PATCH", cookie, { startedAt, endedAt, reason },
  );

  assert.equal((await correct(endedId, endedCorrectedStart, endedCorrectedEnd, "Corrected from signed timesheet")).status, 200);
  const correctedActive = await correct(active.id, activeCorrectedStart, null, "Start time was recorded incorrectly");
  assert.equal(correctedActive.status, 200, "Administrator can correct both active and ended intervals");

  const freshAdmin = await signIn(users[0].email);
  const refreshedJournal = await request("/api/assignments/history", "GET", freshAdmin);
  const savedEnded = refreshedJournal.data.assignments.find((assignment) => assignment.id === endedId);
  const savedActive = refreshedJournal.data.assignments.find((assignment) => assignment.id === active.id);
  assert.equal(savedEnded.corrections.length, 1);
  assert.equal(Date.parse(savedEnded.corrections[0].old_started_at), Date.parse(firstStart));
  assert.equal(Date.parse(savedEnded.corrections[0].old_ended_at), Date.parse(replacementStart));
  assert.equal(Date.parse(savedEnded.corrections[0].new_started_at), Date.parse(endedCorrectedStart));
  assert.equal(Date.parse(savedEnded.corrections[0].new_ended_at), Date.parse(endedCorrectedEnd));
  assert.equal(savedEnded.corrections[0].reason, "Corrected from signed timesheet");
  assert.equal(savedEnded.corrections[0].corrected_by_name, users[0].name);
  assert.ok(Number.isFinite(Date.parse(savedEnded.corrections[0].corrected_at)), "correction timestamp is retained");
  assert.equal(savedActive.corrections.length, 1);
  assert.equal(Date.parse(savedActive.started_at), Date.parse(activeCorrectedStart));

  const noLongerRecorded = await request(
    `/api/assignments/lookup?vehicleId=${vehicle0}&at=${encodeURIComponent(replacementStart)}`, "GET", manager,
  );
  assert.equal(noLongerRecorded.status, 200);
  assert.equal(noLongerRecorded.data.recordedAssignment, null, "historical lookup follows the corrected interval");
  const atCorrectedStart = await request(
    `/api/assignments/lookup?vehicleId=${vehicle0}&at=${encodeURIComponent(activeCorrectedStart)}`, "GET", manager,
  );
  assert.equal(atCorrectedStart.data.recordedAssignment.driver_id, driver1);

  assert.equal((await correct(endedId, endedCorrectedStart, after(replacementStart, 120), "Overlap vehicle", admin)).status, 409,
    "correction cannot overlap another assignment on the same vehicle");
  assert.equal((await correct(endedId, endedCorrectedStart, after(otherAssignmentStart, 60), "Overlap driver", admin)).status, 409,
    "correction cannot overlap another assignment for the same driver");
  assert.equal((await correct(endedId, endedCorrectedStart, before(endedCorrectedStart, 60), "End before start", admin)).status, 400);
  assert.equal((await correct(endedId, "2026-02-30T08:00:00Z", endedCorrectedEnd, "Invalid calendar", admin)).status, 400);
  assert.equal((await correct(endedId, after(new Date().toISOString(), 60), endedCorrectedEnd, "Future start", admin)).status, 400);
  assert.equal((await request(`/api/assignments/history/${endedId}`, "PATCH", admin, { startedAt: endedCorrectedStart, endedAt: endedCorrectedEnd })).status, 400,
    "reason is mandatory");
  assert.equal((await correct(endedId, endedCorrectedStart, endedCorrectedEnd, "   ")).status, 400);
  assert.equal((await correct(endedId, endedCorrectedStart, endedCorrectedEnd, "x".repeat(501))).status, 400);
  assert.equal((await request(`/api/assignments/history/${endedId}`, "PATCH", admin, {
    startedAt: endedCorrectedStart, endedAt: endedCorrectedEnd, reason: "Tampered tenant", tenantId: tenantB,
  })).status, 400);
  assert.equal((await correct(endedId, endedCorrectedStart, null, "Changed ended state")).status, 400);
  assert.equal((await correct(active.id, activeCorrectedStart, after(activeCorrectedStart, 60), "Closed active row")).status, 400);

  assert.equal((await correct(endedId, endedCorrectedStart, endedCorrectedEnd, "Manager denied", manager)).status, 403);
  assert.equal((await correct(endedId, endedCorrectedStart, endedCorrectedEnd, "Fleet Manager denied", fleet)).status, 403);
  assert.equal((await correct(endedId, endedCorrectedStart, endedCorrectedEnd, "Driver denied", driver)).status, 403);
  assert.equal((await request(`/api/assignments/history/${endedId}`, "PATCH", null, {
    startedAt: endedCorrectedStart, endedAt: endedCorrectedEnd, reason: "Anonymous denied",
  })).status, 401);
  assert.equal((await correct(endedId, endedCorrectedStart, endedCorrectedEnd, "Cross tenant denied", otherAdmin)).status, 404);
  assert.equal((await correct(otherAssignment.data.assignment.id, at(1), null, "Other tenant ID", admin)).status, 404,
    "an assignment ID belonging to another tenant cannot be corrected");
  assert.equal((await request(`/api/assignments/history/${endedId}`, "GET", otherAdmin)).status, 404);
  assert.equal((await correct("not-a-uuid", endedCorrectedStart, endedCorrectedEnd, "Bad path")).status, 404);
  assert.equal((await request(`/api/assignments/history/${endedId}`, "GET", driver)).status, 403);
  assert.equal((await request("/api/assignments/history", "GET", driver)).status, 403);
  const otherTenantJournal = await request("/api/assignments/history", "GET", otherAdmin);
  assert.equal(otherTenantJournal.data.assignments.length, 1);
  assert.equal(otherTenantJournal.data.assignments[0].id, otherAssignment.data.assignment.id);
  assert.ok(!otherTenantJournal.data.assignments.some((assignment) => assignment.id === endedId));

  assert.equal((await request("/assignments/journal", "GET", admin)).status, 200);
  assert.equal((await request("/assignments/journal", "GET", manager)).status, 200);
  assert.equal((await request("/assignments/journal", "GET", fleet)).status, 200);
  assert.equal((await request("/assignments/journal", "GET", driver)).status, 404);
  const adminHtml = (await request("/assignments/journal", "GET", freshAdmin)).data;
  const managerHtml = (await request("/assignments/journal", "GET", manager)).data;
  assert.ok(/Correct assignment|Corriger l.affectation/.test(adminHtml), "administrator gets a correction action");
  assert.ok(/Correction history|Historique des corrections/.test(adminHtml), "correction history is shown in the journal");
  assert.ok(/Correction history|Historique des corrections/.test(managerHtml));
  assert.ok(!/Correct assignment|Corriger l.affectation/.test(managerHtml), "read-only roles do not get correction controls");

  const persistedCount = await pool.query("SELECT count(*)::int AS count FROM assignment_correction WHERE tenant_id=$1 AND assignment_id=$2", [tenantA, endedId]);
  assert.equal(persistedCount.rows[0].count, 1, "rejected requests leave correction history unchanged");
  process.stdout.write("Assignment-correction verification passed: Admin-only corrections; append-only old/new interval, actor, timestamp and reason; fresh-session persistence; corrected historical lookup; overlap, interval, date and input bounds; cross-tenant, other-role, Driver and anonymous denial.\n");
} finally {
  if (setupStarted) {
    await pool.query("DELETE FROM assignment_correction WHERE tenant_id=ANY($1::text[])", [[tenantA, tenantB]]);
    await pool.query("DELETE FROM assignment WHERE tenant_id=ANY($1::text[])", [[tenantA, tenantB]]);
    await pool.query("DELETE FROM driver WHERE tenant_id=ANY($1::text[])", [[tenantA, tenantB]]);
    await pool.query("DELETE FROM vehicle WHERE tenant_id=ANY($1::text[])", [[tenantA, tenantB]]);
    await pool.query('DELETE FROM "user" WHERE email=ANY($1::text[])', [users.map((user) => user.email)]);
    await pool.query("DELETE FROM tenant WHERE id=ANY($1::text[])", [[tenantA, tenantB]]);
  }
  await pool.end();
}
