import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Local inspection verification configuration is required (${missing.join(", ")}).`);

const origin = process.env.BETTER_AUTH_URL;
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
const tenantA = randomUUID();
const tenantB = randomUUID();
const tenants = [tenantA, tenantB];
const password = randomBytes(24).toString("base64url");
const users = [
  { role: "administrator", tenant: tenantA },
  { role: "fleet_manager", tenant: tenantA },
  { role: "manager", tenant: tenantA },
  { role: "driver", tenant: tenantA },
  { role: "administrator", tenant: tenantB },
].map((user, index) => ({
  ...user,
  name: `Inspection QA ${index}`,
  email: `inspection-${runId}-${index}@example.invalid`,
}));

async function request(path, method = "GET", cookie, body) {
  const response = await fetch(origin + path, {
    method,
    headers: Object.assign({}, cookie ? { cookie } : {}, body !== undefined ? { "content-type": "application/json", origin } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, data, response };
}

async function signIn(user) {
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    result = await request("/api/auth/sign-in/email", "POST", null, { email: user.email, password });
    if (result.status !== 429 || attempt === 2) break;
    const retryAfter = Number(result.response.headers.get("retry-after"));
    await new Promise((resolve) => setTimeout(resolve, Math.max(10_000, Number.isFinite(retryAfter) ? retryAfter * 1_000 : 0)));
  }
  assert.equal(result.status, 200, `${user.email} can sign in`);
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "sign-in returns an authenticated session cookie");
  return cookie;
}

const vehicleId = randomUUID();
const foreignVehicleId = randomUUID();
let userIds = [];
try {
  await pool.query("SELECT 1 FROM vehicle_inspection LIMIT 1");
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Temporary Inspection Verification A'), ($2, 'Temporary Inspection Verification B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query(
      'UPDATE "user" SET "tenantId" = $1, "appRole" = $2 WHERE email = $3 RETURNING id',
      [user.tenant, user.role, user.email],
    );
    user.id = saved.rows[0].id;
    userIds.push(user.id);
  }
  const admin = await signIn(users[0]);
  const fleet = await signIn(users[1]);
  const manager = await signIn(users[2]);
  const driver = await signIn(users[3]);
  const otherAdmin = await signIn(users[4]);

  await pool.query(
    `INSERT INTO vehicle (id, tenant_id, registration, make, model, ownership_type)
     VALUES ($1, $2, $3, 'Renault', 'Clio', 'owned'), ($4, $5, $6, 'Peugeot', '208', 'owned')`,
    [vehicleId, tenantA, `IQ-${runId.slice(0, 6)}-A`, foreignVehicleId, tenantB, `IQ-${runId.slice(0, 6)}-B`],
  );

  const path = `/api/vehicles/${vehicleId}/inspections`;
  const initial = await request(path, "GET", admin);
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.data.inspections, [], "vehicle with no dates has an empty history");
  assert.equal((await request(path, "POST", admin, { emissionsDueDate: "2027-01-01" })).status, 400, "technical date is required");
  assert.equal((await request(path, "POST", admin, { technicalDueDate: "2027-02-29", emissionsDueDate: null })).status, 400, "invalid calendar dates are rejected");
  assert.equal((await request(path, "POST", admin, { technicalDueDate: "2027-01-01", emissionsDueDate: "2027-1-1" })).status, 400, "emissions date uses strict ISO format");
  assert.equal((await request(path, "POST", admin, { technicalDueDate: "2027-01-01", result: "passed" })).status, 400, "unspecified result fields are rejected");

  const legacyId = randomUUID();
  await pool.query(
    `INSERT INTO vehicle_inspection (id, tenant_id, vehicle_id, technical_due_date, emissions_due_date, source, recorded_at)
     VALUES ($1, $2, $3, DATE '2026-10-15', NULL, 'legacy', CURRENT_TIMESTAMP - INTERVAL '1 day')`,
    [legacyId, tenantA, vehicleId],
  );
  const legacyHistory = await request(path, "GET", admin);
  assert.equal(legacyHistory.status, 200);
  assert.equal(legacyHistory.data.inspections.length, 1, "migrated legacy entry remains visible in history");
  assert.equal(legacyHistory.data.inspections[0].source, "legacy");
  assert.equal(legacyHistory.data.inspections[0].technical_due_date, "2026-10-15");

  const first = await request(path, "POST", admin, { technicalDueDate: "2027-03-01", emissionsDueDate: "2027-06-01" });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal(first.data.inspection.source, "staff");
  assert.equal(first.data.inspection.recorded_by_user_id, users[0].id);
  assert.equal(first.data.inspection.recorded_by_name, users[0].name);
  const second = await request(path, "POST", fleet, { technicalDueDate: "2027-04-01", emissionsDueDate: null });
  assert.equal(second.status, 201, JSON.stringify(second.data));
  assert.equal(second.data.inspection.emissions_due_date, null, "emissions date remains optional");

  const refreshed = await request(path, "GET", await signIn(users[0]));
  assert.equal(refreshed.status, 200);
  assert.deepEqual(refreshed.data.inspections.map((inspection) => inspection.id), [second.data.inspection.id, first.data.inspection.id, legacyId], "newest record is current and earlier entries remain visible after sign-in");
  assert.equal(refreshed.data.inspections[0].technical_due_date, "2027-04-01");
  assert.equal((await request(path, "GET", manager)).status, 200, "Manager can read inspection history");
  assert.equal((await request(path, "POST", manager, { technicalDueDate: "2027-05-01" })).status, 403, "Manager cannot change inspection history");
  assert.equal((await request(path, "GET", driver)).status, 403, "Driver cannot inspect fleet inspection history");
  assert.equal((await request(path, "POST", driver, { technicalDueDate: "2027-05-01" })).status, 403, "Driver cannot write inspection history");
  assert.equal((await request(`/api/vehicles/${foreignVehicleId}/inspections`, "GET", admin)).status, 404, "cross-tenant inspection history is hidden");
  assert.equal((await request(`/api/vehicles/${foreignVehicleId}/inspections`, "POST", admin, { technicalDueDate: "2027-05-01" })).status, 404, "cross-tenant vehicle cannot receive an inspection");
  assert.equal((await request(path)).status, 401, "anonymous history access is denied");

  await pool.query("UPDATE vehicle SET archived_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2", [vehicleId, tenantA]);
  assert.equal((await request(path, "POST", admin, { technicalDueDate: "2027-05-01" })).status, 409, "archived vehicle cannot receive a new inspection");
  assert.equal((await request(`/api/vehicles/${foreignVehicleId}/inspections`, "POST", otherAdmin, { technicalDueDate: "2027-05-01" })).status, 201, "tenant administrator can create history for its own vehicle");

  process.stdout.write("Vehicle inspection verification passed: required and optional dates, strict calendar validation, staff attribution, legacy and corrective history persistence after fresh sign-in, newest-record precedence, staff role access, and archived/cross-tenant/driver/anonymous protections.\n");
} finally {
  await pool.query("DELETE FROM vehicle_inspection WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle WHERE id = ANY($1::uuid[])", [[vehicleId, foreignVehicleId]]).catch(() => undefined);
  if (userIds.length) await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [userIds]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
}
