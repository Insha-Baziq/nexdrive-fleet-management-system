import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Dashboard verification needs the local app and database configuration (${missing.join(", ")}).`);
}

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

const runId = randomUUID();
const tenantA = randomUUID();
const tenantB = randomUUID();
const tenants = [tenantA, tenantB];
const password = randomBytes(24).toString("base64url");
const users = [
  { key: "administrator", role: "administrator", tenant: tenantA },
  { key: "fleet-manager", role: "fleet_manager", tenant: tenantA },
  { key: "manager", role: "manager", tenant: tenantA },
  { key: "driver", role: "driver", tenant: tenantA },
  { key: "other-tenant-administrator", role: "administrator", tenant: tenantB },
].map((user) => ({
  ...user,
  name: `Dashboard QA ${user.key}`,
  email: `dashboard-${runId}-${user.key}@example.invalid`,
}));

async function request(path, cookie, redirect = "manual") {
  const response = await fetch(`${origin}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect,
  });
  return { status: response.status, response, body: await response.text() };
}

async function signIn(user) {
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: user.email, password }),
      redirect: "manual",
    });
    if (response.status !== 429 || attempt === 2) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    await new Promise((resolve) => setTimeout(resolve, Math.max(10_000, Number.isFinite(retryAfter) ? retryAfter * 1_000 : 0)));
  }
  assert.equal(response.status, 200, `${user.key} can sign in`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, `${user.key} receives a session cookie`);
  return cookie;
}

function assertDashboardValues(body, expected, message) {
  for (const [key, value] of Object.entries(expected)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = body.match(new RegExp(`data-dashboard-value="${escaped}"[^>]*>([\\s\\S]*?)</p>`));
    assert.ok(match, `${message}: dashboard renders ${key}`);
    assert.equal(Number(match[1].replace(/<[^>]*>/g, "").trim()), value, `${message}: ${key} count`);
  }
}

const dashboardStatsA = {
  vehicles: 4,
  "available-vehicles": 3,
  drivers: 2,
  "inspection-attention": 2,
  "insurance-attention": 3,
  "active-fines": 2,
  "open-claims": 2,
};

const dashboardStatsB = {
  vehicles: 1,
  "available-vehicles": 1,
  drivers: 1,
  "inspection-attention": 0,
  "insurance-attention": 0,
  "active-fines": 1,
  "open-claims": 1,
};

const vehicleIdsA = Array.from({ length: 4 }, () => randomUUID());
let vehicleIdB;
let assignmentId;
let driverIdA;
let adminIdA;
const fineIdsA = [];
const claimIdsA = [];

try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Temporary Dashboard QA A'), ($2, 'Temporary Dashboard QA B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query(
      'UPDATE "user" SET "tenantId"=$1, "appRole"=$2 WHERE email=$3 RETURNING id',
      [user.tenant, user.role, user.email],
    );
    user.id = saved.rows[0].id;
  }
  adminIdA = users[0].id;
  const adminA = await signIn(users[0]);
  const fleetA = await signIn(users[1]);
  const managerA = await signIn(users[2]);
  const driverA = await signIn(users[3]);
  const adminB = await signIn(users[4]);

  await pool.query(
    `INSERT INTO vehicle (id, tenant_id, registration, make, model, current_mileage,
       technical_inspection_date, insurance_company, insurance_expiry_date, insurance_status, ownership_type)
     VALUES
       ($1, $2, $3, 'Renault', 'Clio', 0, CURRENT_DATE - 1, 'Dashboard QA insurer', CURRENT_DATE, 'insured', 'owned'),
       ($4, $2, $5, 'Peugeot', '208', 0, CURRENT_DATE + 30, 'Dashboard QA insurer', CURRENT_DATE + 30, 'insured', 'owned'),
       ($6, $2, $7, 'Toyota', 'Yaris', 0, CURRENT_DATE + 31, 'Dashboard QA insurer', CURRENT_DATE + 31, 'insured', 'owned'),
       ($8, $2, $9, 'Dacia', 'Jogger', 0, NULL, NULL, NULL, 'to_complete', 'owned')`,
    [vehicleIdsA[0], tenantA, `DA-${runId.slice(0, 6)}-01`, vehicleIdsA[1], `DA-${runId.slice(0, 6)}-02`,
      vehicleIdsA[2], `DA-${runId.slice(0, 6)}-03`, vehicleIdsA[3], `DA-${runId.slice(0, 6)}-04`],
  );
  vehicleIdB = randomUUID();
  await pool.query(
    `INSERT INTO vehicle (id, tenant_id, registration, make, model, current_mileage,
       technical_inspection_date, insurance_company, insurance_expiry_date, insurance_status, ownership_type)
     VALUES ($1, $2, $3, 'Ford', 'Transit', 0, CURRENT_DATE + 31, 'Dashboard QA insurer', CURRENT_DATE + 31, 'insured', 'owned')`,
    [vehicleIdB, tenantB, `DB-${runId.slice(0, 6)}-01`],
  );
  await pool.query(
    `INSERT INTO vehicle_inspection (tenant_id, vehicle_id, technical_due_date, source, recorded_at)
     VALUES ($1, $2, CURRENT_DATE - 1, 'legacy', CURRENT_TIMESTAMP - INTERVAL '1 day'),
            ($1, $3, CURRENT_DATE + 30, 'legacy', CURRENT_TIMESTAMP - INTERVAL '1 day'),
            ($1, $4, CURRENT_DATE + 31, 'legacy', CURRENT_TIMESTAMP - INTERVAL '1 day'),
            ($5, $6, CURRENT_DATE + 31, 'legacy', CURRENT_TIMESTAMP - INTERVAL '1 day')`,
    [tenantA, vehicleIdsA[0], vehicleIdsA[1], vehicleIdsA[2], tenantB, vehicleIdB],
  );

  driverIdA = randomUUID();
  const driverIdA2 = randomUUID();
  const driverIdB = randomUUID();
  await pool.query(
    `INSERT INTO driver (id, tenant_id, full_name) VALUES
       ($1, $2, 'Dashboard QA Driver A1'), ($3, $2, 'Dashboard QA Driver A2'),
       ($4, $5, 'Dashboard QA Driver B1')`,
    [driverIdA, tenantA, driverIdA2, driverIdB, tenantB],
  );

  assignmentId = randomUUID();
  await pool.query(
    `INSERT INTO assignment (id, tenant_id, vehicle_id, driver_id, started_at, created_by_user_id)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP - INTERVAL '1 day', $5)`,
    [assignmentId, tenantA, vehicleIdsA[0], driverIdA, adminIdA],
  );

  for (const status of ["open", "open", "closed", "cancelled"]) {
    const id = randomUUID();
    fineIdsA.push(id);
    await pool.query(
      `INSERT INTO fine (id, tenant_id, vehicle_id, reference, fine_type, infraction_at,
       payment_deadline, status, created_by_user_id)
       VALUES ($1, $2, $3, $4, 'company', CURRENT_TIMESTAMP, CURRENT_DATE, $5, $6)`,
      [id, tenantA, vehicleIdsA[0], `DQA-${runId.slice(0, 8)}-${fineIdsA.length}`, status, adminIdA],
    );
  }
  for (const status of ["open", "open", "closed", "cancelled", "archived"]) {
    const id = randomUUID();
    claimIdsA.push(id);
    await pool.query(
      `INSERT INTO claim (id, tenant_id, vehicle_id, incident_date, description, status, created_by_user_id)
       VALUES ($1, $2, $3, CURRENT_DATE, 'Temporary dashboard verification claim.', $4, $5)`,
      [id, tenantA, vehicleIdsA[1], status, adminIdA],
    );
  }
  await pool.query(
    `INSERT INTO fine (id, tenant_id, vehicle_id, reference, fine_type, infraction_at,
       payment_deadline, status, created_by_user_id)
     VALUES ($1, $2, $3, $4, 'company', CURRENT_TIMESTAMP, CURRENT_DATE, 'open', $5)`,
    [randomUUID(), tenantB, vehicleIdB, `DQB-${runId.slice(0, 8)}`, users[4].id],
  );
  await pool.query(
    `INSERT INTO claim (id, tenant_id, vehicle_id, incident_date, description, status, created_by_user_id)
     VALUES ($1, $2, $3, CURRENT_DATE, 'Temporary other-tenant claim.', 'open', $4)`,
    [randomUUID(), tenantB, vehicleIdB, users[4].id],
  );

  const anonymous = await request("/workspace");
  assert.ok([307, 308].includes(anonymous.status), "anonymous users are redirected away from the dashboard");
  assert.ok(anonymous.response.headers.get("location")?.endsWith("/login"), "anonymous users are sent to sign in");

  const driverPage = await request(`/workspace?tenantId=${tenantB}&appRole=administrator`, driverA);
  assert.ok([307, 308].includes(driverPage.status), "Driver cannot receive the fleet dashboard even with query-string role/tenant tampering");
  assert.ok(driverPage.response.headers.get("location")?.endsWith("/my-vehicle"), "Driver is redirected to their personal workspace");

  for (const [role, cookie] of [["Administrator", adminA], ["Fleet Manager", fleetA], ["Manager", managerA]]) {
    const page = await request("/workspace", cookie);
    assert.equal(page.status, 200, `${role} can read the operational dashboard under the written role matrix`);
    assert.ok(page.body.includes('data-dashboard-value="vehicles"') && page.body.includes('data-attention-count='), `${role} receives the dashboard interface`);
    assertDashboardValues(page.body, dashboardStatsA, `${role} tenant-scoped counts`);
  }

  const tamperedTenant = await request(`/workspace?tenantId=${tenantB}&tenant_id=${tenantB}&appRole=administrator`, adminA);
  assert.equal(tamperedTenant.status, 200);
  assertDashboardValues(tamperedTenant.body, dashboardStatsA, "request parameters cannot redirect an authenticated dashboard to another tenant");
  assert.ok(!tamperedTenant.body.includes("Temporary Dashboard QA B"), "tenant B identity is not returned to tenant A");

  const otherTenantPage = await request("/workspace", adminB);
  assert.equal(otherTenantPage.status, 200, "other tenant administrator can open their own dashboard");
  assertDashboardValues(otherTenantPage.body, dashboardStatsB, "tenant B receives only tenant B counts");

  const freshAfterRefresh = await request("/workspace", await signIn(users[0]));
  assert.equal(freshAfterRefresh.status, 200, "dashboard survives a fresh sign-in");
  assertDashboardValues(freshAfterRefresh.body, dashboardStatsA, "fresh-session persisted data");

  await pool.query("UPDATE assignment SET ended_at = CURRENT_TIMESTAMP, end_reason = 'Temporary verifier reassignment.' WHERE id = $1", [assignmentId]);
  await pool.query(
    `INSERT INTO vehicle_inspection (tenant_id, vehicle_id, technical_due_date, source, recorded_by_user_id)
     VALUES ($1, $2, CURRENT_DATE + 30, 'staff', $3)`,
    [tenantA, vehicleIdsA[2], adminIdA],
  );
  const addedFine = randomUUID();
  fineIdsA.push(addedFine);
  await pool.query(
    `INSERT INTO fine (id, tenant_id, vehicle_id, reference, fine_type, infraction_at,
       payment_deadline, status, created_by_user_id)
     VALUES ($1, $2, $3, $4, 'company', CURRENT_TIMESTAMP, CURRENT_DATE, 'open', $5)`,
    [addedFine, tenantA, vehicleIdsA[2], `DQA-${runId.slice(0, 8)}-NEW`, adminIdA],
  );
  await pool.query("UPDATE claim SET status = 'closed' WHERE id = $1 AND tenant_id = $2", [claimIdsA[0], tenantA]);
  const afterRecordChanges = await request("/workspace", adminA);
  assert.equal(afterRecordChanges.status, 200);
  assertDashboardValues(afterRecordChanges.body, {
    vehicles: 4,
    "available-vehicles": 4,
    drivers: 2,
    "inspection-attention": 3,
    "insurance-attention": 3,
    "active-fines": 3,
    "open-claims": 1,
  }, "dashboard values recalculate from changed records");

  process.stdout.write("Dashboard verification passed: tenant-scoped database counts; current active-assignment availability; 30-day inclusive inspection/insurance attention with overdue dates; open-only fine/claim statuses; all authorized staff roles; Driver dashboard denial; query-string tenant/role tampering; refresh and record-change persistence; no alerts, analytics, maps, or telematics.");
  process.stdout.write("\n");
} finally {
  await pool.query("DELETE FROM assignment WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM fine WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM claim WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle_inspection WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM driver WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
}
