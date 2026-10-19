import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "TIGRIS_BUCKET", "TIGRIS_ACCESS_KEY_ID", "TIGRIS_SECRET_ACCESS_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Local app and private Tigris configuration are required (${missing.join(", ")}).`);

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
const bucket = process.env.TIGRIS_BUCKET;
const tenantA = randomUUID();
const tenantB = randomUUID();
const tenants = [tenantA, tenantB];
const runId = randomUUID();
const password = randomBytes(24).toString("base64url");
const users = [
  ["administrator", tenantA], ["fleet_manager", tenantA], ["manager", tenantA], ["driver", tenantA], ["administrator", tenantB],
].map(([role, tenant], index) => ({
  role, tenant, name: `Anomaly QA ${role} ${index}`, email: `anomaly-${runId}-${index}@example.invalid`,
}));

async function request(path, method = "GET", cookie, body) {
  const headers = Object.assign({}, cookie ? { cookie } : {}, body instanceof FormData ? {} : body !== undefined ? { "content-type": "application/json", origin } : {});
  const response = await fetch(origin + path, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    redirect: "manual",
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, data, response };
}

async function signIn(email) {
  const result = await request("/api/auth/sign-in/email", "POST", null, { email, password });
  assert.equal(result.status, 200, "temporary QA user can sign in");
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

async function createVehicle(cookie, registration) {
  const result = await request("/api/vehicles", "POST", cookie, { registration, make: "Renault", model: "Trafic", ownershipType: "owned" });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.vehicle.id;
}

async function reportAnomaly(cookie, vehicleId, { description, photo } = {}) {
  const form = new FormData();
  form.set("observedDate", "2026-09-25");
  form.set("description", description || "QA braking noise observed during verification.");
  if (photo) form.append("photos", new Blob([photo], { type: "image/png" }), "brake-check.png");
  const result = await request(`/api/vehicles/${vehicleId}/anomalies`, "POST", cookie, form);
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.anomaly;
}

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const usersByRole = Object.fromEntries(users.map((user) => [user.role === "administrator" && user.tenant === tenantB ? "otherAdmin" : user.role, user]));

try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Temporary Anomaly Verification A'), ($2, 'Temporary Anomaly Verification B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query('UPDATE "user" SET "tenantId" = $1, "appRole" = $2 WHERE email = $3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = saved.rows[0].id;
  }

  const [admin, fleet, manager, driver, otherAdmin] = await Promise.all([
    signIn(usersByRole.administrator.email), signIn(usersByRole.fleet_manager.email), signIn(usersByRole.manager.email),
    signIn(usersByRole.driver.email), signIn(usersByRole.otherAdmin.email),
  ]);
  const vehicleId = await createVehicle(admin, `AN-${runId.slice(0, 6)}-AA`);
  const foreignVehicleId = await createVehicle(otherAdmin, `AN-${runId.slice(0, 6)}-BB`);
  const photoAnomaly = await reportAnomaly(admin, vehicleId, { photo: png });
  const secondAnomaly = await reportAnomaly(fleet, vehicleId, { description: "QA warning light was observed." });
  const photoId = photoAnomaly.photos[0].id;

  const persistedList = await request("/api/anomalies", "GET", await signIn(usersByRole.administrator.email));
  assert.equal(persistedList.status, 200);
  assert.ok(persistedList.data.anomalies.some((item) => item.id === photoAnomaly.id), "anomaly metadata persists after a fresh sign-in");
  assert.ok(persistedList.data.anomalies.some((item) => item.id === secondAnomaly.id));
  const vehicleList = await request(`/api/vehicles/${vehicleId}/anomalies`, "GET", admin);
  assert.equal(vehicleList.status, 200);
  assert.deepEqual(new Set(vehicleList.data.anomalies.map((item) => item.id)), new Set([photoAnomaly.id, secondAnomaly.id]));

  const photoRead = await request(`/api/anomalies/${photoAnomaly.id}/photos/${photoId}/content`, "GET", admin);
  assert.equal(photoRead.status, 200, "authorized staff can retrieve private anomaly photos");
  assert.deepEqual(photoRead.data, png, "private photo content is persisted in Tigris");
  assert.equal(photoRead.response.headers.get("cache-control"), "private, no-store, max-age=0");
  const managerList = await request("/api/anomalies", "GET", manager);
  assert.equal(managerList.status, 200, "Manager can inspect tenant anomalies");
  const managerPhoto = await request(`/api/anomalies/${photoAnomaly.id}/photos/${photoId}/content`, "GET", manager);
  assert.equal(managerPhoto.status, 200, "Manager can read photos");
  assert.equal((await request(`/api/vehicles/${vehicleId}/anomalies`, "POST", manager, new FormData())).status, 403, "Manager cannot create anomalies");
  assert.equal((await request(`/api/anomalies/${secondAnomaly.id}`, "PATCH", manager, { status: "resolved", reason: "No manager mutation" })).status, 403, "Manager cannot close anomalies");

  assert.equal((await request("/api/anomalies", "GET", driver)).status, 403, "Driver cannot access the organization-wide anomaly list");
  assert.equal((await request(`/api/anomalies/${photoAnomaly.id}`, "GET", driver)).status, 403, "Driver cannot read staff anomaly detail");
  assert.equal((await request(`/api/anomalies/${photoAnomaly.id}/photos/${photoId}/content`, "GET", driver)).status, 403, "Driver cannot retrieve staff anomaly photos");
  assert.equal((await request(`/api/anomalies/${secondAnomaly.id}`, "PATCH", driver, { status: "cancelled", reason: "Denied" })).status, 403);
  assert.equal((await request(`/api/vehicles/${vehicleId}/anomalies`, "POST", driver, new FormData())).status, 403);

  assert.equal((await request(`/api/vehicles/${foreignVehicleId}/anomalies`, "GET", admin)).status, 404, "foreign vehicle IDs are tenant-scoped");
  const alteredParentForm = new FormData();
  alteredParentForm.set("observedDate", "2026-09-25");
  alteredParentForm.set("description", "Altered-parent request");
  assert.equal((await request(`/api/vehicles/${foreignVehicleId}/anomalies`, "POST", admin, alteredParentForm)).status, 404, "cross-tenant parent IDs cannot create anomalies");
  assert.equal((await request(`/api/anomalies/${photoAnomaly.id}`, "GET", otherAdmin)).status, 404, "foreign anomaly IDs are tenant-scoped");
  assert.equal((await request(`/api/anomalies/${photoAnomaly.id}/photos/${photoId}/content`, "GET", otherAdmin)).status, 404, "foreign photo URLs are denied");
  assert.equal((await request(`/api/anomalies/${photoAnomaly.id}/photos/${photoId}/content`, "GET")).status, 401, "unauthenticated photo requests are denied");
  assert.equal((await request(`/api/anomalies/${secondAnomaly.id}/photos/${photoId}/content`, "GET", admin)).status, 404, "a photo cannot be opened through an altered anomaly parent ID");

  const malformed = new FormData();
  malformed.set("observedDate", "2026-09-25");
  malformed.set("description", "Bad fake photo");
  malformed.append("photos", new Blob(["not a png"], { type: "image/png" }), "fake.png");
  assert.equal((await request(`/api/vehicles/${vehicleId}/anomalies`, "POST", admin, malformed)).status, 400, "photo bytes are checked against their image type");

  const resolved = await request(`/api/anomalies/${photoAnomaly.id}`, "PATCH", admin, { status: "resolved", reason: "Brake assembly inspected and repaired." });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.data));
  assert.equal(resolved.data.anomaly.status, "resolved");
  assert.equal(resolved.data.anomaly.description, photoAnomaly.description, "the original report is preserved");
  assert.equal(resolved.data.anomaly.resolution_reason, "Brake assembly inspected and repaired.");
  assert.equal((await request(`/api/anomalies/${photoAnomaly.id}`, "PATCH", admin, { status: "cancelled", reason: "Duplicate" })).status, 409, "closed outcomes cannot overwrite the retained outcome");

  const cancelled = await request(`/api/anomalies/${secondAnomaly.id}`, "PATCH", fleet, { status: "cancelled", reason: "Duplicate report confirmed." });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.anomaly.status, "cancelled");
  assert.equal(cancelled.data.anomaly.description, secondAnomaly.description);
  assert.equal(cancelled.data.anomaly.resolution_reason, "Duplicate report confirmed.");

  process.stdout.write("Anomaly verification passed: authorized create/list/detail/photo retrieval and persistence; Tigris private content; required resolved/cancelled outcomes preserving reports; Manager read-only access; and driver, unauthenticated, cross-tenant, and altered-parent denials.\n");
} finally {
  const rows = await pool.query("SELECT storage_key FROM anomaly_photo WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => ({ rows: [] }));
  await Promise.all(rows.rows.map(({ storage_key }) => storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: storage_key })).catch(() => undefined)));
  await pool.query("DELETE FROM vehicle_anomaly WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM assignment WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
  storage.destroy();
}
