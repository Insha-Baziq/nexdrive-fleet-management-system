import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Local app verification configuration is required (${missing.join(", ")}).`);

const origin = process.env.BETTER_AUTH_URL;
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

const tenantA = randomUUID();
const tenantB = randomUUID();
const tenants = [tenantA, tenantB];
const runId = randomUUID();
const password = randomBytes(24).toString("base64url");
const users = [
  ["administrator", tenantA], ["fleet_manager", tenantA], ["manager", tenantA], ["driver", tenantA], ["administrator", tenantB],
].map(([role, tenant], index) => ({
  role, tenant, name: `Insurance QA ${role} ${index}`, email: `insurance-${runId}-${index}@example.invalid`,
}));
const usersByRole = Object.fromEntries(users.map((user) => [user.role === "administrator" && user.tenant === tenantB ? "otherAdmin" : user.role, user]));

async function request(path, method = "GET", cookie, body) {
  const headers = Object.assign({}, cookie ? { cookie } : {}, body !== undefined ? { "content-type": "application/json", origin } : {});
  const response = await fetch(origin + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual",
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, data, response };
}

async function signIn(email) {
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    result = await request("/api/auth/sign-in/email", "POST", null, { email, password });
    if (result.status !== 429 || attempt === 2) break;
    const retryAfter = Number(result.response.headers.get("retry-after"));
    await new Promise((resolve) => setTimeout(resolve, Math.max(10_000, Number.isFinite(retryAfter) ? retryAfter * 1_000 : 0)));
  }
  assert.equal(result.status, 200, "temporary QA user can sign in");
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "sign-in returns an authenticated session cookie");
  return cookie;
}

async function addEvent(cookie, vehicleId, input) {
  const result = await request(`/api/vehicles/${vehicleId}/insurance-events`, "POST", cookie, input);
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.event;
}

function eventInput(overrides = {}) {
  return { eventType: "suspension", eventDate: "2024-02-29", description: "Coverage paused during a policy review.", ...overrides };
}

let fixtureVehicleIds = [];
try {
  const migration = await pool.query("SELECT to_regclass('public.vehicle_insurance_event') AS table_name");
  if (!migration.rows[0].table_name) throw new Error("Vehicle insurance-event migration is missing. Apply 016_vehicle_insurance_events.sql before this verifier.");
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Temporary Insurance Verification A'), ($2, 'Temporary Insurance Verification B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query('UPDATE "user" SET "tenantId" = $1, "appRole" = $2, "emailVerified" = true WHERE email = $3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = saved.rows[0].id;
  }

  const admin = await signIn(usersByRole.administrator.email);
  const fleet = await signIn(usersByRole.fleet_manager.email);
  const manager = await signIn(usersByRole.manager.email);
  const driver = await signIn(usersByRole.driver.email);
  const otherAdmin = await signIn(usersByRole.otherAdmin.email);
  const vehicleId = randomUUID();
  const otherVehicleId = randomUUID();
  const foreignVehicleId = randomUUID();
  const statusVehicleId = randomUUID();
  fixtureVehicleIds = [vehicleId, otherVehicleId, foreignVehicleId, statusVehicleId];
  await pool.query(
    `INSERT INTO vehicle (id, tenant_id, registration, make, model, ownership_type) VALUES
       ($1, $2, $3, 'Renault', 'Trafic', 'owned'), ($4, $2, $5, 'Peugeot', 'Expert', 'owned'),
       ($6, $7, $8, 'Ford', 'Transit', 'owned'), ($9, $2, $10, 'Citroën', 'Berlingo', 'owned')`,
    [vehicleId, tenantA, `IN-${runId.slice(0, 6)}-AA`, otherVehicleId, `IN-${runId.slice(0, 6)}-AB`, foreignVehicleId, tenantB, `IN-${runId.slice(0, 6)}-BA`, statusVehicleId, `IN-${runId.slice(0, 6)}-AC`],
  );

  const statusPath = `/api/vehicles/${statusVehicleId}/insurance-events`;
  const initialStatus = await request(statusPath, "GET", admin);
  assert.equal(initialStatus.status, 200);
  assert.equal(initialStatus.data.insuranceStatus, "to_complete", "a vehicle with no coverage evidence is not assumed insured");
  const currentSuspension = await addEvent(admin, statusVehicleId, eventInput({ eventDate: "2026-09-20", description: "Coverage paused." }));
  assert.equal((await request(statusPath, "GET", admin)).data.insuranceStatus, "suspended");
  const currentUnpaid = await addEvent(fleet, statusVehicleId, eventInput({ eventType: "unpaid", eventDate: "2026-09-22", description: "Premium payment due." }));
  assert.equal((await request(statusPath, "GET", admin)).data.insuranceStatus, "unpaid");
  const currentInsured = await addEvent(admin, statusVehicleId, eventInput({ eventType: "insured", eventDate: "2026-09-24", description: "Coverage confirmed." }));
  assert.equal((await request(statusPath, "GET", admin)).data.insuranceStatus, "insured", "staff can return a vehicle to Insured");
  await addEvent(fleet, statusVehicleId, eventInput({ eventDate: "2026-01-01", description: "Backdated suspension recorded later." }));
  const statusAfterBackdate = await request(statusPath, "GET", admin);
  assert.equal(statusAfterBackdate.data.insuranceStatus, "insured", "a backdated event cannot replace the latest effective status");
  assert.equal(statusAfterBackdate.data.events.length, 4);

  const cancelInsured = await request(`/api/insurance-events/${currentInsured.id}`, "PATCH", fleet, { action: "cancel", reason: "Confirmation entered in error." });
  assert.equal(cancelInsured.status, 200);
  assert.equal(cancelInsured.data.insuranceStatus, "unpaid", "cancelling a transition recalculates from the latest active event");
  assert.equal((await request(statusPath, "GET", admin)).data.insuranceStatus, "unpaid", "current status is returned after the transition");
  const cancelUnpaid = await request(`/api/insurance-events/${currentUnpaid.id}`, "PATCH", admin, { action: "cancel", reason: "Payment event corrected." });
  assert.equal(cancelUnpaid.data.insuranceStatus, "suspended");
  const cancelSuspension = await request(`/api/insurance-events/${currentSuspension.id}`, "PATCH", admin, { action: "cancel", reason: "Suspension event corrected." });
  assert.equal(cancelSuspension.data.insuranceStatus, "suspended", "the newest remaining active event controls status");
  const backdated = statusAfterBackdate.data.events.find((event) => event.description === "Backdated suspension recorded later.");
  assert.ok(backdated);
  const cancelBackdated = await request(`/api/insurance-events/${backdated.id}`, "PATCH", admin, { action: "cancel", reason: "Backdated test event removed." });
  assert.equal(cancelBackdated.data.insuranceStatus, "to_complete", "without active events or legacy evidence status returns to À compléter");
  const freshAdmin = await signIn(usersByRole.administrator.email);
  const statusHistory = await request(statusPath, "GET", freshAdmin);
  assert.equal(statusHistory.data.insuranceStatus, "to_complete");
  assert.equal(statusHistory.data.events.length, 4, "status transitions and cancellations retain the full history");
  assert.ok(statusHistory.data.events.every((event) => event.status === "cancelled"));

  const first = await addEvent(admin, vehicleId, eventInput());
  const second = await addEvent(fleet, vehicleId, eventInput({ eventType: "unpaid", eventDate: "2026-09-27", description: "Annual premium is still outstanding." }));
  const maxDescription = "x".repeat(4000);
  const boundary = await addEvent(admin, vehicleId, eventInput({ eventDate: "9999-12-31", description: maxDescription }));

  const persisted = await request(`/api/vehicles/${vehicleId}/insurance-events`, "GET", freshAdmin);
  assert.equal(persisted.status, 200);
  assert.deepEqual(persisted.data.events.map(({ id }) => id), [boundary.id, second.id, first.id], "events persist across sign-in and are returned newest-first");
  assert.equal(persisted.data.events.find(({ id }) => id === first.id).description, first.description);
  const managerRead = await request(`/api/vehicles/${vehicleId}/insurance-events`, "GET", manager);
  assert.equal(managerRead.status, 200, "Manager can inspect event history");
  assert.equal(managerRead.data.events.length, 3);
  assert.deepEqual((await request(`/api/vehicles/${otherVehicleId}/insurance-events`, "GET", admin)).data.events, [], "an owned vehicle shows only its own history");

  const cancel = await request(`/api/insurance-events/${second.id}`, "PATCH", fleet, { action: "cancel", reason: "Duplicate event corrected." });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  assert.equal(cancel.data.event.status, "cancelled");
  assert.equal(cancel.data.event.cancellation_reason, "Duplicate event corrected.");
  assert.equal(cancel.data.event.description, second.description, "cancellation preserves the original event description");
  assert.ok(cancel.data.event.cancelled_at && cancel.data.event.cancelled_by_user_id);
  const completeHistory = await request(`/api/vehicles/${vehicleId}/insurance-events`, "GET", admin);
  assert.equal(completeHistory.data.events.length, 3, "cancelled events remain in full history");
  assert.equal(completeHistory.data.events.find(({ id }) => id === second.id).cancellation_reason, "Duplicate event corrected.");
  assert.equal((await request(`/api/insurance-events/${second.id}`, "PATCH", admin, { action: "cancel", reason: "Try to replace history." })).status, 409, "a cancellation cannot silently overwrite history");

  for (const invalid of [
    eventInput({ eventType: "active" }), eventInput({ eventType: "suspended" }), eventInput({ eventDate: "2026-02-29" }),
    eventInput({ eventDate: "2026-9-01" }), eventInput({ eventDate: "2026-09-27T00:00:00Z" }), eventInput({ eventDate: "99999-01-01" }),
    eventInput({ description: "   " }), eventInput({ description: "x".repeat(4001) }), eventInput({ description: "bad\u0000value" }),
    { ...eventInput(), tenantId: tenantA }, { ...eventInput(), vehicleId },
  ]) {
    assert.equal((await request(`/api/vehicles/${vehicleId}/insurance-events`, "POST", admin, invalid)).status, 400, `invalid event rejected: ${JSON.stringify(invalid).slice(0, 120)}`);
  }
  assert.equal((await request(`/api/vehicles/not-a-uuid/insurance-events`, "GET", admin)).status, 404, "malformed parent ID is rejected");
  assert.equal((await request(`/api/vehicles/${foreignVehicleId}/insurance-events`, "GET", admin)).status, 404, "cross-tenant parent lookup is hidden");
  assert.equal((await request(`/api/vehicles/${foreignVehicleId}/insurance-events`, "POST", admin, eventInput())).status, 404, "cross-tenant vehicle cannot receive a new event");
  assert.equal((await request(`/api/vehicles/${foreignVehicleId}/insurance-events`, "POST", admin, { ...eventInput(), vehicleId })).status, 400, "altered parent in request body is rejected");

  for (const invalid of [
    { action: "cancel", reason: " " }, { action: "cancel", reason: "x".repeat(1001) },
    { action: "cancel", reason: "bad\nvalue" }, { action: "close", reason: "Wrong workflow" },
    { action: "cancel", reason: "Valid reason", tenantId: tenantA },
  ]) {
    assert.equal((await request(`/api/insurance-events/${first.id}`, "PATCH", admin, invalid)).status, 400, `invalid cancellation rejected: ${JSON.stringify(invalid).slice(0, 100)}`);
  }
  const maxReason = "r".repeat(1000);
  const maxCancel = await request(`/api/insurance-events/${boundary.id}`, "PATCH", admin, { action: "cancel", reason: maxReason });
  assert.equal(maxCancel.status, 200, "maximum cancellation reason length is accepted");
  assert.equal(maxCancel.data.event.cancellation_reason, maxReason);

  assert.equal((await request(`/api/vehicles/${vehicleId}/insurance-events`, "POST", manager, eventInput())).status, 403, "Manager can read but cannot create");
  assert.equal((await request(`/api/insurance-events/${first.id}`, "PATCH", manager, { action: "cancel", reason: "Denied." })).status, 403, "Manager cannot cancel");
  assert.equal((await request(`/api/vehicles/${vehicleId}/insurance-events`, "GET", driver)).status, 403, "Driver cannot inspect fleet insurance events");
  assert.equal((await request(`/api/vehicles/${vehicleId}/insurance-events`, "POST", driver, eventInput())).status, 403, "Driver cannot create events");
  assert.equal((await request(`/api/insurance-events/${first.id}`, "PATCH", driver, { action: "cancel", reason: "Denied." })).status, 403, "Driver cannot cancel events");

  const foreignEvent = await addEvent(otherAdmin, foreignVehicleId, eventInput({ eventType: "unpaid", description: "Tenant B fixture." }));
  assert.equal((await request(`/api/vehicles/${foreignVehicleId}/insurance-events`, "GET", admin)).status, 404);
  assert.equal((await request(`/api/insurance-events/${foreignEvent.id}`, "PATCH", admin, { action: "cancel", reason: "Cross-tenant access." })).status, 404, "cross-tenant event ID cannot be cancelled");
  assert.equal((await request(`/api/insurance-events/${first.id}`, "PATCH", otherAdmin, { action: "cancel", reason: "Cross-tenant access." })).status, 404, "foreign tenant cannot alter local event");
  assert.equal((await request(`/api/vehicles/${vehicleId}/insurance-events`, "GET")).status, 401, "unauthenticated list access is denied");
  assert.equal((await request(`/api/vehicles/${vehicleId}/insurance-events`, "POST", null, eventInput())).status, 401, "unauthenticated create access is denied");
  assert.equal((await request(`/api/insurance-events/${first.id}`, "PATCH", null, { action: "cancel", reason: "Unauthenticated." })).status, 401, "unauthenticated cancellation is denied");
  assert.equal((await request(`/api/insurance-events/not-a-uuid`, "PATCH", admin, { action: "cancel", reason: "Invalid ID." })).status, 404);

  process.stdout.write("Insurance verification passed: To complete, Suspended, Unpaid, and Insured transitions; effective-date ordering and backdated events; cancellation recalculates current status while retaining history; persisted status after fresh sign-in; event limits and invalid input rejection; Administrator/Fleet Manager mutation and Manager read-only; Driver, anonymous, cross-tenant, and altered-parent denial.\n");
} finally {
  await pool.query("DELETE FROM vehicle_insurance_event WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  if (fixtureVehicleIds.length) await pool.query("DELETE FROM vehicle WHERE id = ANY($1::uuid[])", [fixtureVehicleIds]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
}
