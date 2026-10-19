import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.BETTER_AUTH_SECRET || !process.env.DATABASE_URL) {
  throw new Error("BETTER_AUTH_URL, BETTER_AUTH_SECRET, and DATABASE_URL are required");
}

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
const password = randomBytes(24).toString("base64url");
const users = [
  { name: "Vehicle Admin A", role: "administrator", tenant: tenantA },
  { name: "Vehicle Fleet A", role: "fleet_manager", tenant: tenantA },
  { name: "Vehicle Manager A", role: "manager", tenant: tenantA },
  { name: "Vehicle Driver A", role: "driver", tenant: tenantA },
  { name: "Vehicle Admin B", role: "administrator", tenant: tenantB },
].map((user, index) => ({ ...user, email: `vehicle-verify-${runId}-${index}@example.invalid` }));

async function request(path, method = "GET", cookie, body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json", origin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, data, response };
}

async function signIn(email) {
  const { status, response } = await request("/api/auth/sign-in/email", "POST", null, { email, password });
  assert.equal(status, 200, `sign-in failed for ${email}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "sign-in did not return a session cookie");
  return cookie;
}

const vehicleInput = {
  registration: "AA-123-AA", make: "Renault", model: "Trafic", year: "2022",
  ownershipType: "owned", registeredHolder: "",
  technicalInspectionDate: "2026-10-12",
  insuranceCompany: "Groupama", insuranceExpiryDate: "2027-03-14", bonusMalus: "0.85",
};

try {
  await pool.query("insert into tenant (id, name) values ($1, $2), ($3, $4)",
    [tenantA, "Vehicle Verification A", tenantB, "Vehicle Verification B"]);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    await pool.query('update "user" set "tenantId" = $1, "appRole" = $2 where email = $3',
      [user.tenant, user.role, user.email]);
  }

  assert.equal((await request("/api/vehicles")).status, 401);
  assert.equal((await request("/api/vehicles", "POST", null, vehicleInput)).status, 401);

  const [adminA, fleetA, managerA, driverA, adminB] = await Promise.all(users.map((user) => signIn(user.email)));
  assert.equal((await request("/api/vehicles", "GET", adminA)).data.vehicles.length, 0);
  assert.equal((await request("/api/vehicles", "GET", driverA)).status, 403);
  assert.equal((await request("/api/vehicles", "POST", managerA, vehicleInput)).status, 403);
  assert.equal((await request("/api/vehicles", "POST", driverA, vehicleInput)).status, 403);

  const tamperedCreate = await request("/api/vehicles", "POST", adminA,
    { ...vehicleInput, tenantId: tenantB, appRole: "administrator" });
  assert.equal(tamperedCreate.status, 400);
  assert.equal((await request("/api/vehicles", "GET", adminA)).data.vehicles.length, 0);

  const created = await request("/api/vehicles", "POST", adminA, vehicleInput);
  assert.equal(created.status, 201);
  const vehicleId = created.data.vehicle.id;
  assert.equal(created.data.vehicle.tenant_id, tenantA);
  assert.equal(created.data.vehicle.current_mileage, null);
  assert.equal(created.data.vehicle.ownership_type, "owned");
  assert.equal((await request("/api/vehicles", "POST", adminA,
    { ...vehicleInput, registration: "CC-345-CC", currentMileage: "-1" })).status, 400);
  assert.equal((await request("/api/vehicles", "POST", adminA, vehicleInput)).status, 409);

  for (const [index, invalid] of [
    { ...vehicleInput, registration: "INVALID-YEAR-LOW", year: "1885" },
    { ...vehicleInput, registration: "INVALID-YEAR-HIGH", year: "2101" },
    { ...vehicleInput, registration: "INVALID-MILEAGE-HIGH", currentMileage: "2147483648" },
    { ...vehicleInput, registration: "INVALID-MILEAGE-FRACTION", currentMileage: "1.5" },
    { ...vehicleInput, registration: "INVALID-BONUS-HIGH", bonusMalus: "1000" },
    { ...vehicleInput, registration: "INVALID-BONUS-PRECISION", bonusMalus: "0.001" },
    { ...vehicleInput, registration: "INVALID-DATE", technicalInspectionDate: "2026-02-30" },
    { ...vehicleInput, registration: "INVALID-OWNERSHIP", ownershipType: "" },
    { ...vehicleInput, registration: "INVALID-HOLDER", ownershipType: "loan", registeredHolder: "" },
    { ...vehicleInput, registration: "R".repeat(25) },
  ].entries()) {
    const rejected = await request("/api/vehicles", "POST", adminA, invalid);
    assert.equal(rejected.status, 400, `vehicle validation rejects malformed case ${index + 1}: ${invalid.registration}; response ${JSON.stringify(rejected.data)}`);
  }
  const managerList = await request("/api/vehicles", "GET", managerA);
  assert.equal(managerList.status, 200);
  assert.equal(managerList.data.vehicles.length, 1);
  assert.equal((await request(`/api/vehicles/${vehicleId}`, "GET", managerA)).status, 200);
  assert.equal((await request(`/api/vehicles/${vehicleId}`, "PATCH", managerA, vehicleInput)).status, 403);
  assert.equal((await request(`/api/vehicles/${vehicleId}`, "GET", driverA)).status, 403);

  assert.equal((await request("/api/vehicles", "GET", adminB)).data.vehicles.length, 0);
  assert.equal((await request(`/api/vehicles/${vehicleId}`, "GET", adminB)).status, 404);
  assert.equal((await request(`/api/vehicles/${vehicleId}`, "PATCH", adminB, vehicleInput)).status, 404);
  assert.equal((await request(`/api/vehicles/${vehicleId}`, "PATCH", adminA,
    { ...vehicleInput, tenant_id: tenantB })).status, 400);

  const fleetUpdate = await request(`/api/vehicles/${vehicleId}`, "PATCH", fleetA,
    { ...vehicleInput, model: "Master" });
  assert.equal(fleetUpdate.status, 200);
  assert.equal(fleetUpdate.data.vehicle.model, "Master");
  assert.equal(fleetUpdate.data.vehicle.current_mileage, null, "core vehicle edits do not create mileage readings");
  const freshAdminA = await signIn(users[0].email);
  assert.equal((await request(`/api/vehicles/${vehicleId}`, "GET", freshAdminA)).data.vehicle.model, "Master");
  assert.equal((await request(`/api/vehicles/${vehicleId}`, "GET", freshAdminA)).data.vehicle.current_mileage, null);
  assert.equal((await request(`/vehicles/${vehicleId}`, "GET", managerA)).status, 200);
  assert.equal((await request("/vehicles", "GET", driverA)).status, 404);

  const duplicateRegistrationOtherTenant = await request("/api/vehicles", "POST", adminB, vehicleInput);
  assert.equal(duplicateRegistrationOtherTenant.status, 201);
  assert.equal(duplicateRegistrationOtherTenant.data.vehicle.tenant_id, tenantB);
  const registrationOnly = await request("/api/vehicles", "POST", adminB,
    { ...vehicleInput, registration: "BB-234-BB", make: "", model: "" });
  assert.equal(registrationOnly.status, 201);
  assert.equal((await request("/api/vehicles", "GET", adminA)).data.vehicles.length, 1);
  assert.equal((await request("/api/vehicles", "GET", adminB)).data.vehicles.length, 2);

  const upperBoundary = await request("/api/vehicles", "POST", adminB, {
    ...vehicleInput, registration: "R".repeat(24), year: "2100", bonusMalus: "999.99",
  });
  assert.equal(upperBoundary.status, 201, JSON.stringify(upperBoundary.data));
  assert.equal(upperBoundary.data.vehicle.registration.length, 24);
  assert.equal(upperBoundary.data.vehicle.year, 2100);
  assert.equal(upperBoundary.data.vehicle.current_mileage, null, "a new vehicle has no invented odometer reading");
  assert.equal(Number(upperBoundary.data.vehicle.bonus_malus), 999.99);
  const rented = await request("/api/vehicles", "POST", adminA, { ...vehicleInput, registration: "RENT-01", ownershipType: "long_term_rental", registeredHolder: "Loueur QA" });
  assert.equal(rented.status, 201, JSON.stringify(rented.data));
  assert.equal(rented.data.vehicle.registered_holder, "Loueur QA");
  assert.equal((await request("/api/vehicles", "GET", adminB)).data.vehicles.length, 3);
  process.stdout.write("Vehicle verification passed: create/edit/read, ownership and holder rules, duplicate handling, all four roles, two-tenant isolation, tampered fields, persisted fresh sign-in, protected pages.\n");
} finally {
  await pool.query("delete from vehicle where tenant_id = any($1::text[])", [[tenantA, tenantB]]);
  await pool.query('delete from "user" where email = any($1::text[])', [users.map((user) => user.email)]);
  await pool.query("delete from tenant where id = any($1::text[])", [[tenantA, tenantB]]);
  await pool.end();
}
