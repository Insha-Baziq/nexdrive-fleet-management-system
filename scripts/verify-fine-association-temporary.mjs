import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "TIGRIS_BUCKET", "TIGRIS_ACCESS_KEY_ID", "TIGRIS_SECRET_ACCESS_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Fine association verification needs local app and private storage configuration (${missing.join(", ")}).`);

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
const storage = new S3Client({
  endpoint: process.env.TIGRIS_ENDPOINT || "https://t3.storage.dev",
  region: "auto",
  credentials: { accessKeyId: process.env.TIGRIS_ACCESS_KEY_ID, secretAccessKey: process.env.TIGRIS_SECRET_ACCESS_KEY },
});
const tenantA = randomUUID(), tenantB = randomUUID(), runId = randomUUID();
const tenants = [tenantA, tenantB];
const driverRequiredFields = {
  dateOfBirth: "1990-08-15", streetNumber: "12 bis", streetName: "Rue de la Paix", postalCode: "75002", city: "Paris",
};
const password = randomBytes(24).toString("base64url");
const users = [
  { key: "admin", role: "administrator", tenant: tenantA },
  { key: "fleet", role: "fleet_manager", tenant: tenantA },
  { key: "manager", role: "manager", tenant: tenantA },
  { key: "driver", role: "driver", tenant: tenantA },
  { key: "foreign", role: "administrator", tenant: tenantB },
].map((user) => ({ ...user, name: `Fine history ${user.key}`, email: `fine-history-${runId}-${user.key}@example.invalid` }));
const pdf = Buffer.from("%PDF-1.7\nNexDrive association fixture\n%%EOF\n");

async function request(path, method = "GET", cookie, body) {
  const isForm = body instanceof FormData;
  const response = await fetch(origin + path, {
    method,
    headers: Object.assign({}, cookie ? { cookie } : {}, body !== undefined && !isForm ? { "content-type": "application/json", origin } : {}),
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    redirect: "manual",
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, data, response };
}

async function signIn(user) {
  const result = await request("/api/auth/sign-in/email", "POST", null, { email: user.email, password });
  assert.equal(result.status, 200, `${user.key} can sign in`);
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

function timestamp(minutesAgo) { return new Date(Date.now() - minutesAgo * 60_000).toISOString(); }

function makeFineForm(vehicleId, fineType, infractionAt, reference) {
  const form = new FormData();
  form.set("vehicleId", vehicleId);
  form.set("reference", reference);
  form.set("fineType", fineType);
  form.set("infractionAt", infractionAt);
  form.set("paymentDeadline", new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  form.set("description", "Historical assignment verification.");
  form.set("amount", "45.00");
  form.append("evidence", new Blob([pdf], { type: "application/pdf" }), `${reference}.pdf`);
  return form;
}

async function createFine(cookie, vehicleId, fineType, infractionAt, suffix) {
  return request("/api/fines", "POST", cookie, makeFineForm(vehicleId, fineType, infractionAt, `FH-${runId.slice(0, 8)}-${suffix}`));
}

let vehicles = [], drivers = [];
try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Temporary Fine History A'), ($2, 'Temporary Fine History B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2 WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = saved.rows[0].id;
  }
  const [admin, fleet, manager, driver, foreignAdmin] = await Promise.all(users.map(signIn));
  const firstVehicle = await request("/api/vehicles", "POST", admin, { registration: `FH-${runId.slice(0, 5)}-AA`, make: "Renault", model: "Trafic", ownershipType: "owned" });
  const firstDriver = await request("/api/drivers", "POST", fleet, { fullName: "Sofia Martin", ...driverRequiredFields });
  const nextDriver = await request("/api/drivers", "POST", fleet, { fullName: "Noah Bernard", ...driverRequiredFields });
  assert.equal(firstVehicle.status, 201);
  assert.equal(firstDriver.status, 201);
  assert.equal(nextDriver.status, 201);
  const vehicleId = firstVehicle.data.vehicle.id;
  const firstDriverId = firstDriver.data.driver.id;
  const nextDriverId = nextDriver.data.driver.id;
  vehicles.push(vehicleId);
  drivers.push(firstDriverId, nextDriverId);

  const initialStart = timestamp(180);
  const changeAt = timestamp(120);
  assert.equal((await request("/api/assignments", "POST", fleet, {
    vehicleId, driverId: firstDriverId, startedAt: initialStart, startReason: "Recorded first assignment",
  })).status, 201);
  assert.equal((await request("/api/assignments", "POST", fleet, {
    vehicleId, driverId: nextDriverId, startedAt: changeAt,
    startReason: "Recorded reassignment", closureReason: "Vehicle reassigned",
  })).status, 201);

  const historicalAt = timestamp(150);
  const beforeAnyAssignmentAt = timestamp(190);
  const historical = await createFine(manager, vehicleId, "driver", historicalAt, "OLD");
  assert.equal(historical.status, 201, JSON.stringify(historical.data));
  const historicalFineId = historical.data.fine.id;
  assert.equal(historical.data.fine.recorded_driver?.driver_id, firstDriverId, "fine creation resolves the historical driver, not the current driver");
  assert.equal(historical.data.fine.recorded_driver?.driver_name, "Sofia Martin");
  assert.equal(Date.parse(historical.data.fine.recorded_driver?.started_at), Date.parse(initialStart));
  assert.equal(Date.parse(historical.data.fine.recorded_driver?.ended_at), Date.parse(changeAt));
  assert.equal(historical.data.fine.recorded_driver?.driver_id === nextDriverId, false, "later reassignment does not replace the historical driver");

  const outside = await createFine(manager, vehicleId, "driver", beforeAnyAssignmentAt, "NONE");
  assert.equal(outside.status, 201);
  assert.equal(outside.data.fine.recorded_driver, null, "no assignment at the infraction time produces no driver allocation");

  const atBoundary = await createFine(manager, vehicleId, "driver", changeAt, "BOUNDARY");
  assert.equal(atBoundary.status, 201);
  assert.equal(atBoundary.data.fine.recorded_driver?.driver_id, nextDriverId, "assignment start is inclusive and the prior end is exclusive");
  assert.equal(Date.parse(atBoundary.data.fine.recorded_driver?.started_at), Date.parse(changeAt));

  const companyFine = await createFine(manager, vehicleId, "company", historicalAt, "COMPANY");
  assert.equal(companyFine.status, 201);
  assert.equal(companyFine.data.fine.recorded_driver, null, "company-type fines do not automatically include a driver");

  const freshManager = await signIn(users[2]);
  const persisted = await request(`/api/fines/${historicalFineId}`, "GET", freshManager);
  assert.equal(persisted.status, 200);
  assert.equal(persisted.data.fine.recorded_driver?.driver_id, firstDriverId, "historical driver remains attached when the fine is viewed after a fresh sign-in");
  assert.equal(Date.parse(persisted.data.fine.recorded_driver?.ended_at), Date.parse(changeAt));
  const fleetView = await request(`/api/fines/${historicalFineId}`, "GET", fleet);
  assert.equal(fleetView.status, 200);
  assert.equal(fleetView.data.fine.recorded_driver?.driver_name, "Sofia Martin", "Fleet Manager can read the recorded association");
  assert.equal((await request(`/api/fines/${historicalFineId}`, "GET", driver)).status, 403);
  assert.equal((await request(`/api/fines/${historicalFineId}`, "GET", foreignAdmin)).status, 404);

  const page = await request(`/fines/${historicalFineId}`, "GET", freshManager);
  assert.equal(page.status, 200);
  assert.ok(page.data.includes("Recorded driver from assignment history"));
  assert.ok(page.data.includes("Sofia Martin"));
  assert.ok(page.data.includes("Assignment period"));
  assert.ok(page.data.includes("This is an assignment record, not a finding of responsibility."));
  const outsidePage = await request(`/fines/${outside.data.fine.id}`, "GET", freshManager);
  assert.ok(outsidePage.data.includes("No driver is identified in NexDrive assignment history for this time."));
  const companyPage = await request(`/fines/${companyFine.data.fine.id}`, "GET", freshManager);
  assert.ok(!companyPage.data.includes("Recorded driver from assignment history"));

  assert.equal((await pool.query("SELECT count(*)::int AS count FROM assignment WHERE tenant_id=$1 AND vehicle_id=$2", [tenantA, vehicleId])).rows[0].count, 2);
  process.stdout.write("Fine association verification passed: historical interval, reassignment stability, start/end boundary, no-match and company behavior, fresh-sign-in persistence, tenant and role denial, Fleet read access, and neutral UI copy.\n");
} finally {
  const objects = await pool.query("SELECT storage_key FROM fine_evidence WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => ({ rows: [] }));
  for (const row of objects.rows) await storage.send(new DeleteObjectCommand({ Bucket: process.env.TIGRIS_BUCKET, Key: row.storage_key })).catch(() => undefined);
  await pool.query("DELETE FROM assignment WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM fine WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM driver WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email=ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
  storage.destroy();
}
