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
const tenantA = randomUUID(), tenantB = randomUUID(), runId = randomUUID();
const tenants = [tenantA, tenantB];
const password = randomBytes(24).toString("base64url");
const users = [
  { key: "admin", role: "administrator", tenant: tenantA, name: "Driver Report QA Admin" },
  { key: "fleet", role: "fleet_manager", tenant: tenantA, name: "Driver Report QA Fleet" },
  { key: "manager", role: "manager", tenant: tenantA, name: "Driver Report QA Manager" },
  { key: "assigned", role: "driver", tenant: tenantA, name: "Jamie Carter" },
  { key: "unassigned", role: "driver", tenant: tenantA, name: "Unassigned QA Driver" },
  { key: "foreign", role: "driver", tenant: tenantB, name: "Foreign QA Driver" },
].map((user) => ({ ...user, email: `driver-anomaly-${runId}-${user.key}@example.invalid` }));
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);

async function request(path, method = "GET", cookie, body) {
  const response = await fetch(origin + path, {
    method,
    headers: Object.assign({}, cookie ? { cookie } : {}, body instanceof FormData ? {} : body !== undefined ? { "content-type": "application/json", origin } : {}),
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    redirect: "manual",
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json()
    : contentType.startsWith("text/") ? await response.text()
      : Buffer.from(await response.arrayBuffer());
  return { status: response.status, data, response };
}

async function signIn(user) {
  const result = await request("/api/auth/sign-in/email", "POST", null, { email: user.email, password });
  assert.equal(result.status, 200, `${user.key} can sign in`);
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

function form(description = "A grinding sound is heard from the front left wheel when braking.", observedDate = "2026-09-25", photoBytes) {
  const result = new FormData();
  result.set("observedDate", observedDate);
  result.set("description", description);
  if (photoBytes) result.append("photos", new Blob([photoBytes], { type: "image/png" }), "brake-check.png");
  return result;
}

async function createAssignedDriver({ tenantId, userId, driverId, vehicleId, registration }) {
  await pool.query("INSERT INTO driver (id, tenant_id, user_id, full_name) VALUES ($1, $2, $3, $4)", [driverId, tenantId, userId, registration + " Driver"]);
  if (!vehicleId) return;
  await pool.query(
    "INSERT INTO assignment (id, tenant_id, vehicle_id, driver_id, started_at, created_by_user_id) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP - INTERVAL '1 minute', $5)",
    [randomUUID(), tenantId, vehicleId, driverId, tenantId === tenantB ? users[5].id : users[0].id],
  );
}

try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Temporary Driver Report QA A'), ($2, 'Temporary Driver Report QA B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const result = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2 WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = result.rows[0].id;
  }

  const assignedVehicleId = randomUUID();
  const nextVehicleId = randomUUID();
  const foreignVehicleId = randomUUID();
  const assignedDriverId = randomUUID();
  const unassignedDriverId = randomUUID();
  const foreignDriverId = randomUUID();
  const currentRegistration = `DA-${runId.slice(0, 6)}-AA`;
  await pool.query(
    `INSERT INTO vehicle (id, tenant_id, registration, make, model, current_mileage)
     VALUES ($1, $2, $3, 'Renault', 'Clio', 48260), ($4, $2, $5, 'Peugeot', '208', 15500), ($6, $7, $8, 'Citroen', 'C3', 9200)`,
    [assignedVehicleId, tenantA, currentRegistration, nextVehicleId, `DB-${runId.slice(0, 6)}-AA`, foreignVehicleId, tenantB, `DC-${runId.slice(0, 6)}-AA`],
  );
  await createAssignedDriver({ tenantId: tenantA, userId: users[3].id, driverId: assignedDriverId, vehicleId: assignedVehicleId, registration: currentRegistration });
  await createAssignedDriver({ tenantId: tenantA, userId: users[4].id, driverId: unassignedDriverId, vehicleId: null, registration: "UNASSIGNED" });
  await createAssignedDriver({ tenantId: tenantB, userId: users[5].id, driverId: foreignDriverId, vehicleId: foreignVehicleId, registration: "FOREIGN" });
  const initialAssignment = await pool.query("SELECT id FROM assignment WHERE tenant_id=$1 AND driver_id=$2 AND ended_at IS NULL", [tenantA, assignedDriverId]);
  const [admin, fleet, manager, assigned, unassigned, foreignDriver] = await Promise.all(users.map(signIn));

  const photoForm = form(undefined, undefined, png);
  const submitted = await request("/api/my-vehicle/anomalies", "POST", assigned, photoForm);
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  const report = submitted.data.anomaly;
  assert.equal(report.vehicle_id, assignedVehicleId, "the server uses the active assigned vehicle");
  assert.equal(report.vehicle_registration, currentRegistration);
  assert.equal(report.reporter_name, users[3].name, "the authenticated Driver is recorded as reporter");
  assert.equal(report.status, "open");
  assert.equal(report.observed_date, "2026-09-25");
  assert.equal(report.photos.length, 1);

  const freshAdmin = await signIn(users[0]);
  const staffList = await request("/api/anomalies", "GET", freshAdmin);
  assert.equal(staffList.status, 200);
  assert.ok(staffList.data.anomalies.some((item) => item.id === report.id && item.reporter_name === users[3].name), "staff see Driver reports in the shared anomaly workflow after fresh sign-in");
  const photoRead = await request(`/api/anomalies/${report.id}/photos/${report.photos[0].id}/content`, "GET", freshAdmin);
  assert.equal(photoRead.status, 200);
  assert.deepEqual(photoRead.data, png, "staff can retrieve a Driver report's private Tigris photo");
  assert.equal((await request(`/api/anomalies/${report.id}/photos/${report.photos[0].id}/content`, "GET", assigned)).status, 403, "the Driver stays within the personal workspace");

  const driverWorkspace = await request("/my-vehicle", "GET", assigned);
  assert.equal(driverWorkspace.status, 200);
  assert.match(driverWorkspace.data, new RegExp(currentRegistration));
  assert.match(driverWorkspace.data, /Report problem|Signaler un problème/);
  const unassignedWorkspace = await request("/my-vehicle", "GET", unassigned);
  assert.equal(unassignedWorkspace.status, 200);
  assert.match(unassignedWorkspace.data, /No vehicle is currently assigned|Aucun véhicule n.est actuellement attribué/);
  assert.doesNotMatch(unassignedWorkspace.data, /Report problem|Signaler un problème/);

  const beforeDenied = await pool.query("SELECT count(*)::int AS count FROM vehicle_anomaly WHERE tenant_id=$1", [tenantA]);
  assert.equal((await request("/api/my-vehicle/anomalies", "POST", unassigned, form())).status, 409, "unassigned Drivers cannot create a vehicle anomaly");
  assert.equal((await request("/api/my-vehicle/anomalies", "POST", manager, form())).status, 403, "Managers cannot submit as Drivers");
  assert.equal((await request("/api/my-vehicle/anomalies", "POST", admin, form())).status, 403, "Administrators use the staff workflow");
  assert.equal((await request("/api/my-vehicle/anomalies", "POST", fleet, form())).status, 403, "Fleet Managers use the staff workflow");
  assert.equal((await request("/api/my-vehicle/anomalies", "POST", undefined, form())).status, 401, "anonymous report requests are denied");
  assert.equal((await request("/api/anomalies", "GET", assigned)).status, 403, "Drivers cannot open the fleet-wide anomaly list");
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM vehicle_anomaly WHERE tenant_id=$1", [tenantA])).rows[0].count, beforeDenied.rows[0].count, "denied submissions leave no anomaly rows");

  const queryTamper = await request(`/api/my-vehicle/anomalies?vehicleId=${foreignVehicleId}&driverId=${foreignDriverId}&tenantId=${tenantB}`, "POST", assigned, form());
  assert.equal(queryTamper.status, 400, "altered URL parent, Driver, and tenant identifiers are rejected");
  for (const [key, value] of [["vehicleId", foreignVehicleId], ["driverId", foreignDriverId], ["tenantId", tenantB], ["assignmentId", randomUUID()]]) {
    const forged = form();
    forged.set(key, value);
    assert.equal((await request("/api/my-vehicle/anomalies", "POST", assigned, forged)).status, 400, `${key} cannot be supplied by the browser`);
  }

  for (const [description, date] of [[" ", "2026-09-25"], ["x".repeat(4001), "2026-09-25"], ["Bad date", "2026-02-30"], ["Bad date", "2026-9-1"]]) {
    assert.equal((await request("/api/my-vehicle/anomalies", "POST", assigned, form(description, date))).status, 400, "invalid or oversized reports are rejected");
  }
  const boundaryReport = await request("/api/my-vehicle/anomalies", "POST", assigned, form("x".repeat(4000)));
  assert.equal(boundaryReport.status, 201, "the exact description-length boundary is accepted");
  assert.equal(boundaryReport.data.anomaly.description.length, 4000);

  for (const file of [
    new File(["not an image"], "fake.png", { type: "image/png" }),
    new File(["vector"], "diagram.svg", { type: "image/svg+xml" }),
  ]) {
    const invalidPhoto = form();
    invalidPhoto.append("photos", file);
    assert.equal((await request("/api/my-vehicle/anomalies", "POST", assigned, invalidPhoto)).status, 400, "unsupported or mismatched photo bytes are rejected");
  }
  const tooManyPhotos = form();
  for (let i = 0; i < 6; i++) tooManyPhotos.append("photos", new Blob([png], { type: "image/png" }), `photo-${i}.png`);
  assert.equal((await request("/api/my-vehicle/anomalies", "POST", assigned, tooManyPhotos)).status, 400, "more than five photos are rejected");
  const maximumPhotos = form("The report accepts the maximum of five photos.");
  for (let i = 0; i < 5; i++) maximumPhotos.append("photos", new Blob([png], { type: "image/png" }), `maximum-${i}.png`);
  const maximumPhotoReport = await request("/api/my-vehicle/anomalies", "POST", assigned, maximumPhotos);
  assert.equal(maximumPhotoReport.status, 201, "exactly five supported photos are accepted");
  assert.equal(maximumPhotoReport.data.anomaly.photos.length, 5);
  const oversized = form();
  oversized.append("photos", new Blob([Buffer.alloc(15 * 1024 * 1024 + 1, 0)], { type: "image/png" }), "oversized.png");
  const oversizedResponse = await request("/api/my-vehicle/anomalies", "POST", assigned, oversized);
  assert.ok([400, 413].includes(oversizedResponse.status), "a photo above the 15 MB limit is rejected by the app or deployment body-size limit");
  const combinedOversize = form();
  for (const [index, size] of [7 * 1024 * 1024 + 1, 8 * 1024 * 1024].entries()) {
    const bytes = Buffer.alloc(size, 0);
    png.copy(bytes, 0);
    combinedOversize.append("photos", new Blob([bytes], { type: "image/png" }), `combined-${index}.png`);
  }
  const combinedOversizeResponse = await request("/api/my-vehicle/anomalies", "POST", assigned, combinedOversize);
  assert.ok([400, 413].includes(combinedOversizeResponse.status), "combined photo content above 15 MB is rejected by the app or deployment body-size limit");

  const foreignOwn = await request("/api/my-vehicle/anomalies", "POST", foreignDriver, form("Foreign tenant's assigned vehicle report."));
  assert.equal(foreignOwn.status, 201, "a Driver can report only against their own tenant assignment");
  assert.equal(foreignOwn.data.anomaly.vehicle_id, foreignVehicleId);
  assert.equal(foreignOwn.data.anomaly.reporter_name, users[5].name);

  await pool.query("UPDATE assignment SET ended_at=CURRENT_TIMESTAMP, end_reason='Temporary verifier reassignment' WHERE id=$1", [initialAssignment.rows[0].id]);
  await pool.query(
    "INSERT INTO assignment (id, tenant_id, vehicle_id, driver_id, started_at, created_by_user_id) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)",
    [randomUUID(), tenantA, nextVehicleId, assignedDriverId, users[0].id],
  );
  const afterReassignment = await request("/api/my-vehicle/anomalies", "POST", assigned, form("Report submitted after vehicle reassignment."));
  assert.equal(afterReassignment.status, 201);
  assert.equal(afterReassignment.data.anomaly.vehicle_id, nextVehicleId, "the route re-reads the current assignment rather than trusting stale page state");

  process.stdout.write("Driver anomaly report verification passed: assigned Driver submission with private photo; staff workflow visibility and retrieval; session-bound current vehicle and reporter; unassigned and wrong-role denial; forged identity rejection; reassignment refresh; and date, description, image type, count, and size boundaries.\n");
} finally {
  const rows = await pool.query("SELECT storage_key FROM anomaly_photo WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => ({ rows: [] }));
  await Promise.all(rows.rows.map(({ storage_key }) => storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: storage_key })).catch(() => undefined)));
  await pool.query("DELETE FROM vehicle_anomaly WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM assignment WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM driver WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
  storage.destroy();
}
