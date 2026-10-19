import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.BETTER_AUTH_SECRET || !process.env.DATABASE_URL) {
  throw new Error("Local auth and database environment is required");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const auth = betterAuth({
  baseURL: origin,
  secret: process.env.BETTER_AUTH_SECRET,
  database: { dialect: new PostgresDialect({ pool }), type: "postgres" },
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      tenantId: { type: "string", required: false, input: false },
      appRole: { type: ["administrator", "fleet_manager", "manager", "driver"], required: false, input: false },
    },
  },
});

const runId = randomUUID();
const tenantA = randomUUID();
const tenantB = randomUUID();
const password = randomBytes(24).toString("base64url");
const users = [
  { key: "admin", role: "administrator", tenant: tenantA, name: "Workspace QA Admin" },
  { key: "assigned", role: "driver", tenant: tenantA, name: "Assigned Workspace Driver" },
  { key: "sameTenant", role: "driver", tenant: tenantA, name: "Other Workspace Driver" },
  { key: "unassigned", role: "driver", tenant: tenantA, name: "Unassigned Workspace Driver" },
  { key: "otherAdmin", role: "administrator", tenant: tenantB, name: "Other Tenant Workspace Admin" },
  { key: "otherTenant", role: "driver", tenant: tenantB, name: "Other Tenant Workspace Driver" },
].map((user) => ({
  ...user,
  email: `driver-workspace-${runId}-${user.key.toLowerCase()}@example.invalid`,
}));

async function request(path, method = "GET", cookie, body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json", origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : await response.text();
  return { status: response.status, data, response };
}

async function signIn(email) {
  const result = await request("/api/auth/sign-in/email", "POST", null, { email, password });
  assert.equal(result.status, 200);
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

const vehicle = async (id, tenant, registration, mileage) => {
  await pool.query(
    `INSERT INTO vehicle (id, tenant_id, registration, make, model, current_mileage)
     VALUES ($1, $2, $3, 'Renault', 'Kangoo', $4)`,
    [id, tenant, registration, mileage],
  );
  if (mileage !== null) {
    await pool.query(
      `INSERT INTO vehicle_mileage_reading (id, tenant_id, vehicle_id, reading_date, mileage, note)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, 'Driver workspace verification fixture')`,
      [randomUUID(), tenant, id, mileage],
    );
  }
};

const driver = (id, tenant, userId, fullName) =>
  pool.query(
    `INSERT INTO driver (id, tenant_id, user_id, full_name)
     VALUES ($1, $2, $3, $4)`,
    [id, tenant, userId, fullName],
  );

const initialAssignmentTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Driver Workspace QA A'), ($2, 'Driver Workspace QA B')", [tenantA, tenantB]);
  for (const user of users) {
    await auth.api.signUpEmail({
      body: { name: user.name, email: user.email, password },
      headers: new Headers({ origin }),
    });
    const result = await pool.query(
      'UPDATE "user" SET "tenantId"=$1, "appRole"=$2, "emailVerified"=true WHERE email=$3 RETURNING id',
      [user.tenant, user.role, user.email],
    );
    user.id = result.rows[0].id;
  }

  const assignedDriverId = randomUUID();
  const sameTenantDriverId = randomUUID();
  const unassignedDriverId = randomUUID();
  const otherTenantDriverId = randomUUID();
  const assignedVehicleId = randomUUID();
  const sameTenantVehicleId = randomUUID();
  const nextVehicleId = randomUUID();
  const otherTenantVehicleId = randomUUID();
  const assignmentIds = [randomUUID(), randomUUID(), randomUUID()];

  await Promise.all([
    driver(assignedDriverId, tenantA, users[1].id, users[1].name),
    driver(sameTenantDriverId, tenantA, users[2].id, users[2].name),
    driver(unassignedDriverId, tenantA, users[3].id, users[3].name),
    driver(otherTenantDriverId, tenantB, users[5].id, users[5].name),
    vehicle(assignedVehicleId, tenantA, `WA-${runId.slice(0, 4)}-AA`, 48260),
    vehicle(sameTenantVehicleId, tenantA, `WB-${runId.slice(0, 4)}-AA`, 91234),
    vehicle(nextVehicleId, tenantA, `WC-${runId.slice(0, 4)}-AA`, null),
    vehicle(otherTenantVehicleId, tenantB, `WX-${runId.slice(0, 4)}-AA`, 77777),
  ]);
  await pool.query(
    `INSERT INTO assignment (id, tenant_id, vehicle_id, driver_id, started_at, created_by_user_id)
     VALUES ($1, $4, $6, $8, $12, $13), ($2, $4, $7, $9, $12, $13), ($3, $5, $10, $11, $12, $14)`,
    [
      ...assignmentIds,
      tenantA,
      tenantB,
      assignedVehicleId,
      sameTenantVehicleId,
      assignedDriverId,
      sameTenantDriverId,
      otherTenantVehicleId,
      otherTenantDriverId,
      initialAssignmentTime,
      users[0].id,
      users[4].id,
    ],
  );

  const [adminCookie, driverCookie, , unassignedCookie, otherAdminCookie, otherTenantCookie] = await Promise.all(
    users.map((user) => signIn(user.email)),
  );

  const ownPath = "/my-vehicle";
  const ownBefore = await request(ownPath, "GET", driverCookie);
  const ownHtmlBefore = ownBefore.data;
  assert.equal(ownBefore.status, 200);
  assert.match(ownHtmlBefore, new RegExp(`WA-${runId.slice(0, 4)}-AA`));
  assert.match(ownHtmlBefore, /Renault Kangoo/);
  assert.match(ownHtmlBefore, /48(?:,|\s|\u00a0|\u202f)260 km/);
  assert.doesNotMatch(ownHtmlBefore, new RegExp(`WB-${runId.slice(0, 4)}-AA`));
  assert.doesNotMatch(ownHtmlBefore, new RegExp(`WX-${runId.slice(0, 4)}-AA`));

  const ownAfterRefresh = await request(ownPath, "GET", driverCookie);
  assert.equal(ownAfterRefresh.status, 200);
  assert.match(ownAfterRefresh.data, new RegExp(`WA-${runId.slice(0, 4)}-AA`));

  const tamperedPath = `${ownPath}?driverId=${sameTenantDriverId}&vehicleId=${sameTenantVehicleId}&assignmentId=${assignmentIds[1]}&tenantId=${tenantB}`;
  const tampered = await request(tamperedPath, "GET", driverCookie);
  assert.equal(tampered.status, 200);
  assert.match(tampered.data, new RegExp(`WA-${runId.slice(0, 4)}-AA`));
  assert.doesNotMatch(tampered.data, new RegExp(`WB-${runId.slice(0, 4)}-AA`));
  assert.doesNotMatch(tampered.data, new RegExp(`WX-${runId.slice(0, 4)}-AA`));

  const noVehicle = await request(ownPath, "GET", unassignedCookie);
  assert.equal(noVehicle.status, 200);
  assert.match(noVehicle.data, /No vehicle is currently assigned|Aucun véhicule n.est actuellement attribué/);
  assert.doesNotMatch(noVehicle.data, new RegExp(`WA-${runId.slice(0, 4)}-AA`));

  const workspaceLanding = await request("/workspace", "GET", driverCookie);
  assert.equal(workspaceLanding.status, 200);
  assert.ok(workspaceLanding.response.url.endsWith("/my-vehicle"));
  assert.match(workspaceLanding.data, /My Vehicle|Mon véhicule/);
  assert.match(workspaceLanding.data, /My Documents|Mes documents/);
  assert.doesNotMatch(workspaceLanding.data, /Quick Assignment|Assignment Journal|Historical Lookup/);

  for (const path of [
    "/vehicles",
    `/vehicles/${assignedVehicleId}`,
    "/drivers",
    `/drivers/${sameTenantDriverId}`,
    "/assignments/quick",
    "/assignments/journal",
    "/assignments/lookup",
  ]) {
    assert.equal((await request(path, "GET", driverCookie)).status, 404, `Driver page must deny ${path}`);
  }
  for (const path of [
    "/api/vehicles",
    `/api/vehicles/${sameTenantVehicleId}`,
    "/api/drivers",
    `/api/drivers/${sameTenantDriverId}`,
    "/api/assignments/history",
    `/api/assignments/lookup?vehicleId=00000000-0000-4000-8000-000000000000&at=${encodeURIComponent(initialAssignmentTime)}`,
  ]) {
    assert.equal((await request(path, "GET", driverCookie)).status, 403, `Driver API must deny ${path}`);
  }
  assert.equal((await request("/api/assignments", "POST", driverCookie, {
    vehicleId: assignedVehicleId,
    driverId: sameTenantDriverId,
    startedAt: new Date().toISOString(),
  })).status, 403);
  assert.equal((await request(ownPath, "GET", adminCookie)).status, 404);
  assert.equal((await request(ownPath, "GET", otherAdminCookie)).status, 404);
  const otherTenantPage = await request(ownPath, "GET", otherTenantCookie);
  assert.equal(otherTenantPage.status, 200);
  assert.match(otherTenantPage.data, new RegExp(`WX-${runId.slice(0, 4)}-AA`));
  assert.doesNotMatch(otherTenantPage.data, new RegExp(`WA-${runId.slice(0, 4)}-AA`));

  const reassignedAt = new Date(Date.now() - 60_000).toISOString();
  const reassignment = await request("/api/assignments", "POST", adminCookie, {
    vehicleId: nextVehicleId,
    driverId: assignedDriverId,
    startedAt: reassignedAt,
    closureReason: "Workspace verification reassignment",
  });
  assert.equal(reassignment.status, 201);
  const afterReassignment = await request(ownPath, "GET", driverCookie);
  assert.equal(afterReassignment.status, 200);
  assert.match(afterReassignment.data, new RegExp(`WC-${runId.slice(0, 4)}-AA`));
  assert.match(afterReassignment.data, /Not recorded|Non renseigné/);
  assert.doesNotMatch(afterReassignment.data, new RegExp(`WA-${runId.slice(0, 4)}-AA`));
  assert.doesNotMatch(afterReassignment.data, new RegExp(`WB-${runId.slice(0, 4)}-AA`));

  process.stdout.write("Driver workspace verification passed: assigned and unassigned states, session-derived identity, query tampering, tenant and driver isolation, reassignment refresh, and page/API role denial. Temporary data removed.\n");
} finally {
  await pool.query("DELETE FROM assignment WHERE tenant_id=ANY($1::text[])", [[tenantA, tenantB]]);
  await pool.query("DELETE FROM driver WHERE tenant_id=ANY($1::text[])", [[tenantA, tenantB]]);
  await pool.query("DELETE FROM vehicle_mileage_reading WHERE tenant_id=ANY($1::text[])", [[tenantA, tenantB]]);
  await pool.query("DELETE FROM vehicle WHERE tenant_id=ANY($1::text[])", [[tenantA, tenantB]]);
  await pool.query('DELETE FROM "user" WHERE email=ANY($1::text[])', [users.map((user) => user.email)]);
  await pool.query("DELETE FROM tenant WHERE id=ANY($1::text[])", [[tenantA, tenantB]]);
  await pool.end();
}
