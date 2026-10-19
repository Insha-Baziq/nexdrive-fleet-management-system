import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";
import { getAlertWindowDays } from "../src/lib/alert-window.ts";

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`In-app alert verification needs local app and database configuration (${missing.join(", ")}).`);
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
const windowDays = getAlertWindowDays(process.env.NEXDRIVE_ALERT_WINDOW_DAYS);
const expectedInitialCount = 5 + (windowDays >= 2 ? 2 : 0) + (windowDays >= 7 ? 1 : 0) + (windowDays >= 14 ? 1 : 0);
const users = [
  { key: "administrator", role: "administrator", tenant: tenantA },
  { key: "fleet-manager", role: "fleet_manager", tenant: tenantA },
  { key: "manager", role: "manager", tenant: tenantA },
  { key: "driver", role: "driver", tenant: tenantA },
  { key: "other-tenant-administrator", role: "administrator", tenant: tenantB },
].map((user) => ({
  ...user,
  name: `Alert QA ${user.key}`,
  email: `alert-${runId}-${user.key}@example.invalid`,
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

async function insertVehicle({ tenantId, id, registration, inspectionDays, insuranceDays }) {
  await pool.query(
    `INSERT INTO vehicle (id, tenant_id, registration, make, model, current_mileage,
      technical_inspection_date, insurance_company, insurance_expiry_date, insurance_status, ownership_type)
     VALUES ($1, $2, $3, 'Renault', 'Clio', 0,
       CASE WHEN $4::int IS NULL THEN NULL ELSE CURRENT_DATE + $4::int END,
       CASE WHEN $5::int IS NULL THEN NULL ELSE 'Alert QA insurer' END,
       CASE WHEN $5::int IS NULL THEN NULL ELSE CURRENT_DATE + $5::int END,
       CASE WHEN $5::int IS NULL THEN 'to_complete' ELSE 'insured' END,
       'owned')`,
    [id, tenantId, registration, inspectionDays, insuranceDays],
  );
  if (inspectionDays !== null) {
    await pool.query(
      `INSERT INTO vehicle_inspection (tenant_id, vehicle_id, technical_due_date, source, recorded_at)
       VALUES ($1, $2, CURRENT_DATE + $3::int, 'legacy', CURRENT_TIMESTAMP - INTERVAL '1 day')`,
      [tenantId, id, inspectionDays],
    );
  }
}

async function insertVehicleDocument({ tenantId, vehicleId, id, name, expiryDays, status, createdBy }) {
  await pool.query(
    `INSERT INTO vehicle_document (
       id, tenant_id, vehicle_id, name, category, expiry_date, visible_to_driver,
       storage_key, file_name, file_extension, content_type, file_size, status,
       created_by_user_id, uploaded_at, upload_expires_at
     ) VALUES (
       $1, $2, $3, $4, 'registration', CURRENT_DATE + $5::int, false,
       $6, 'registration.pdf', 'pdf', 'application/pdf', 64, $7,
       $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 day'
     )`,
    [id, tenantId, vehicleId, name, expiryDays, `alert-verification/${id}`, status, createdBy],
  );
}

async function insertDriverDocument({ tenantId, driverId, id, name, expiryDays, status, createdBy }) {
  await pool.query(
    `INSERT INTO driver_document (
       id, tenant_id, driver_id, name, category, expiry_date, storage_key,
       file_name, file_extension, content_type, file_size, status,
       created_by_user_id, uploaded_at, upload_expires_at
     ) VALUES (
       $1, $2, $3, $4, 'driving_licence', CURRENT_DATE + $5::int, $6,
       'licence.pdf', 'pdf', 'application/pdf', 64, $7,
       $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 day'
     )`,
    [id, tenantId, driverId, name, expiryDays, `alert-verification/${id}`, status, createdBy],
  );
}

async function insertAnomaly({ tenantId, vehicleId, id, reporterId, status }) {
  if (status === "open") {
    await pool.query(
      `INSERT INTO vehicle_anomaly (id, tenant_id, vehicle_id, observed_date, description, status, reported_by_user_id)
       VALUES ($1, $2, $3, CURRENT_DATE - 1, 'Alert QA open anomaly', 'open', $4)`,
      [id, tenantId, vehicleId, reporterId],
    );
  } else {
    await pool.query(
      `INSERT INTO vehicle_anomaly (
         id, tenant_id, vehicle_id, observed_date, description, status,
         reported_by_user_id, resolution_reason, closed_by_user_id, closed_at
       ) VALUES (
         $1, $2, $3, CURRENT_DATE - 1, 'Alert QA completed anomaly', $4,
         $5, 'Completed for alert verification.', $5, CURRENT_TIMESTAMP
       )`,
      [id, tenantId, vehicleId, status, reporterId],
    );
  }
}

async function insertFine({ tenantId, vehicleId, id, reference, status, deadlineDays, creatorId }) {
  await pool.query(
    `INSERT INTO fine (
       id, tenant_id, vehicle_id, reference, fine_type, infraction_at,
       payment_deadline, status, created_by_user_id
     ) VALUES ($1, $2, $3, $4, 'company', CURRENT_TIMESTAMP,
       CURRENT_DATE + $5::int, $6, $7)`,
    [id, tenantId, vehicleId, reference, deadlineDays, status, creatorId],
  );
}

function assertAlert(body, type, status, message) {
  const escapedType = type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const row = body.match(new RegExp(`<li data-alert-type="${escapedType}"[\\s\\S]*?<\\/li>`))?.[0];
  assert.ok(row, `${message}: ${type} appears`);
  assert.ok(row.includes(`data-alert-status="${status}"`), `${message}: ${type} is ${status}`);
}

const vehicleIdsA = [randomUUID(), randomUUID(), randomUUID()];
const vehicleIdB = randomUUID();
const driverIdA = randomUUID();
const driverIdB = randomUUID();
const documentIds = [];
const anomalyIds = [];
const fineIds = [];
const vehicleDocBoundaryId = randomUUID();
let userIds = [];

try {
  assert.equal(getAlertWindowDays(undefined), 30, "missing configuration uses the 30-day default");
  assert.equal(getAlertWindowDays("0"), 0, "zero days is a valid same-day-only window");
  assert.equal(getAlertWindowDays("45"), 45, "valid environment configuration changes the window");
  for (const invalid of ["-1", "1.5", "366", "many", ""]) {
    assert.equal(getAlertWindowDays(invalid), 30, `${invalid || "empty"} configuration falls back safely`);
  }

  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Temporary Alert QA A'), ($2, 'Temporary Alert QA B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query(
      'UPDATE "user" SET "tenantId"=$1, "appRole"=$2 WHERE email=$3 RETURNING id',
      [user.tenant, user.role, user.email],
    );
    user.id = saved.rows[0].id;
    userIds.push(user.id);
  }
  const admin = await signIn(users[0]);
  const fleet = await signIn(users[1]);
  const manager = await signIn(users[2]);
  const driver = await signIn(users[3]);
  const otherTenantAdmin = await signIn(users[4]);
  const adminIdA = users[0].id;

  await insertVehicle({ tenantId: tenantA, id: vehicleIdsA[0], registration: `AA-${runId.slice(0, 6)}-01`, inspectionDays: -1, insuranceDays: 2 });
  await insertVehicle({ tenantId: tenantA, id: vehicleIdsA[1], registration: `AA-${runId.slice(0, 6)}-02`, inspectionDays: windowDays + 1, insuranceDays: windowDays + 1 });
  await insertVehicle({ tenantId: tenantA, id: vehicleIdsA[2], registration: `AA-${runId.slice(0, 6)}-03`, inspectionDays: windowDays + 31, insuranceDays: null });
  await insertVehicle({ tenantId: tenantB, id: vehicleIdB, registration: `BB-${runId.slice(0, 6)}-01`, inspectionDays: -1, insuranceDays: windowDays + 31 });

  await pool.query(
    `INSERT INTO driver (id, tenant_id, full_name, licence_expiry_date)
     VALUES ($1, $2, 'Alert QA Driver A', CURRENT_DATE + 14),
            ($3, $4, 'Foreign Alert QA Driver', CURRENT_DATE + 2)`,
    [driverIdA, tenantA, driverIdB, tenantB],
  );

  const dueVehicleDocumentId = randomUUID();
  const tooLateVehicleDocumentId = vehicleDocBoundaryId;
  const pendingVehicleDocumentId = randomUUID();
  const foreignVehicleDocumentId = randomUUID();
  documentIds.push(dueVehicleDocumentId, tooLateVehicleDocumentId, pendingVehicleDocumentId, foreignVehicleDocumentId);
  await insertVehicleDocument({ tenantId: tenantA, vehicleId: vehicleIdsA[0], id: dueVehicleDocumentId, name: `Registration ${runId.slice(0, 6)}`, expiryDays: 7, status: "ready", createdBy: adminIdA });
  await insertVehicleDocument({ tenantId: tenantA, vehicleId: vehicleIdsA[0], id: tooLateVehicleDocumentId, name: "Outside alert window", expiryDays: windowDays + 1, status: "ready", createdBy: adminIdA });
  await insertVehicleDocument({ tenantId: tenantA, vehicleId: vehicleIdsA[0], id: pendingVehicleDocumentId, name: "Pending upload", expiryDays: -1, status: "pending", createdBy: adminIdA });
  await insertVehicleDocument({ tenantId: tenantB, vehicleId: vehicleIdB, id: foreignVehicleDocumentId, name: "Foreign registration", expiryDays: 1, status: "ready", createdBy: users[4].id });

  const dueDriverDocumentId = randomUUID();
  const lateDriverDocumentId = randomUUID();
  const foreignDriverDocumentId = randomUUID();
  documentIds.push(dueDriverDocumentId, lateDriverDocumentId, foreignDriverDocumentId);
  await insertDriverDocument({ tenantId: tenantA, driverId: driverIdA, id: dueDriverDocumentId, name: "Driver licence scan", expiryDays: Math.min(windowDays, 30), status: "ready", createdBy: adminIdA });
  await insertDriverDocument({ tenantId: tenantA, driverId: driverIdA, id: lateDriverDocumentId, name: "Outside driver document", expiryDays: windowDays + 1, status: "ready", createdBy: adminIdA });
  await insertDriverDocument({ tenantId: tenantB, driverId: driverIdB, id: foreignDriverDocumentId, name: "Foreign licence scan", expiryDays: 1, status: "ready", createdBy: users[4].id });

  const openAnomalyA = randomUUID();
  const resolvedAnomalyA = randomUUID();
  const cancelledAnomalyA = randomUUID();
  const openAnomalyB = randomUUID();
  anomalyIds.push(openAnomalyA, resolvedAnomalyA, cancelledAnomalyA, openAnomalyB);
  await insertAnomaly({ tenantId: tenantA, vehicleId: vehicleIdsA[0], id: openAnomalyA, reporterId: adminIdA, status: "open" });
  await insertAnomaly({ tenantId: tenantA, vehicleId: vehicleIdsA[0], id: resolvedAnomalyA, reporterId: adminIdA, status: "resolved" });
  await insertAnomaly({ tenantId: tenantA, vehicleId: vehicleIdsA[0], id: cancelledAnomalyA, reporterId: adminIdA, status: "cancelled" });
  await insertAnomaly({ tenantId: tenantB, vehicleId: vehicleIdB, id: openAnomalyB, reporterId: users[4].id, status: "open" });

  const overdueFineA = randomUUID();
  const dueFineA = randomUUID();
  const outsideFineA = randomUUID();
  const closedFineA = randomUUID();
  const foreignFineB = randomUUID();
  fineIds.push(overdueFineA, dueFineA, outsideFineA, closedFineA, foreignFineB);
  await insertFine({ tenantId: tenantA, vehicleId: vehicleIdsA[0], id: overdueFineA, reference: `AL-${runId.slice(0, 6)}-01`, status: "open", deadlineDays: -2, creatorId: adminIdA });
  await insertFine({ tenantId: tenantA, vehicleId: vehicleIdsA[0], id: dueFineA, reference: `AL-${runId.slice(0, 6)}-02`, status: "open", deadlineDays: 2, creatorId: adminIdA });
  await insertFine({ tenantId: tenantA, vehicleId: vehicleIdsA[0], id: outsideFineA, reference: `AL-${runId.slice(0, 6)}-03`, status: "open", deadlineDays: windowDays + 1, creatorId: adminIdA });
  await insertFine({ tenantId: tenantA, vehicleId: vehicleIdsA[0], id: closedFineA, reference: `AL-${runId.slice(0, 6)}-04`, status: "closed", deadlineDays: -1, creatorId: adminIdA });
  await insertFine({ tenantId: tenantB, vehicleId: vehicleIdB, id: foreignFineB, reference: `BL-${runId.slice(0, 6)}-01`, status: "open", deadlineDays: 1, creatorId: users[4].id });

  const anonymous = await request("/workspace");
  assert.ok([307, 308].includes(anonymous.status), "anonymous users are redirected from the dashboard");
  assert.ok(anonymous.response.headers.get("location")?.endsWith("/login"), "anonymous users are sent to sign in");

  const driverPage = await request(`/workspace?tenantId=${tenantB}&appRole=administrator`, driver);
  assert.ok([307, 308].includes(driverPage.status), "Driver cannot receive fleet alerts despite query-string role/tenant tampering");
  assert.ok(driverPage.response.headers.get("location")?.endsWith("/my-vehicle"), "Driver is redirected to the personal workspace");

  for (const [roleName, cookie] of [["Administrator", admin], ["Fleet Manager", fleet], ["Manager", manager]]) {
    const page = await request("/workspace", cookie);
    assert.equal(page.status, 200, `${roleName} can see the dashboard attention list`);
    assert.ok(page.body.includes("Attention") && page.body.includes("Deadlines and open items"), `${roleName} gets the attention panel`);
    assert.ok(page.body.includes(`data-attention-count="${expectedInitialCount}"`), `${roleName} gets a live count of tenant A attention items`);
    for (const type of ["technical_inspection", "driver_document", "vehicle_anomaly", "fine_deadline"]) {
      assert.ok(page.body.includes(`data-alert-type="${type}"`), `${roleName} sees ${type}`);
    }
    assertAlert(page.body, "technical_inspection", "Overdue", `${roleName} dashboard`);
    if (windowDays >= 2) assertAlert(page.body, "vehicle_insurance", "Due in 2 days", `${roleName} dashboard`);
    else assert.ok(!page.body.includes('data-alert-type="vehicle_insurance"'), `${roleName} dashboard excludes a date beyond the configured window`);
    if (windowDays >= 7) assertAlert(page.body, "vehicle_document", "Due in 7 days", `${roleName} dashboard`);
    else assert.ok(!page.body.includes('data-alert-type="vehicle_document"'), `${roleName} dashboard excludes a document date beyond the configured window`);
    if (windowDays >= 14) assertAlert(page.body, "driver_licence", "Due in 14 days", `${roleName} dashboard`);
    else assert.ok(!page.body.includes('data-alert-type="driver_licence"'), `${roleName} dashboard excludes a licence date beyond the configured window`);
    assertAlert(page.body, "driver_document", windowDays === 0 ? "Due today" : `Due in ${Math.min(windowDays, 30)} days`, `${roleName} dashboard`);
    assertAlert(page.body, "vehicle_anomaly", "Open", `${roleName} dashboard`);
    assertAlert(page.body, "fine_deadline", "Overdue", `${roleName} dashboard`);
    const insuranceRows = [...page.body.matchAll(/<li data-alert-type="vehicle_insurance"[\s\S]*?<\/li>/g)].map(([row]) => row);
    assert.ok(insuranceRows.some((row) => row.includes('data-alert-status="Open"') &&
      (row.includes("Coverage status: To complete") || row.includes("État de la couverture : À compléter"))),
    `${roleName} sees a visible incomplete insurance status`);
    assert.ok(!page.body.includes("Foreign registration") && !page.body.includes("Foreign licence scan"), `${roleName} dashboard excludes other-tenant data`);
    assert.ok(!page.body.includes("Outside alert window") && !page.body.includes("Outside driver document"), `${roleName} dashboard excludes dates outside the configured window`);
    assert.ok(!page.body.includes("Pending upload"), `${roleName} dashboard excludes documents that are not ready`);
    assert.ok(!page.body.includes("Alert QA completed anomaly"), `${roleName} dashboard excludes resolved and cancelled anomalies`);
    assert.ok(!page.body.includes(`AL-${runId.slice(0, 6)}-04`), `${roleName} dashboard excludes a closed fine`);
  }

  const tamperedTenant = await request(`/workspace?tenantId=${tenantB}&tenant_id=${tenantB}&appRole=administrator`, admin);
  assert.equal(tamperedTenant.status, 200);
  assert.ok(tamperedTenant.body.includes(`data-attention-count="${expectedInitialCount}"`), "query parameters cannot change the session-derived tenant");
  assert.ok(!tamperedTenant.body.includes(`BB-${runId.slice(0, 6)}-01`), "other-tenant vehicle does not leak through alert details");

  const otherTenantPage = await request("/workspace", otherTenantAdmin);
  assert.equal(otherTenantPage.status, 200);
  const expectedTenantBCount = 2 + (windowDays >= 1 ? 3 : 0) + (windowDays >= 2 ? 1 : 0);
  assert.ok(otherTenantPage.body.includes(`data-attention-count="${expectedTenantBCount}"`), "another tenant receives only its own alert sources");
  assert.ok(otherTenantPage.body.includes(`BB-${runId.slice(0, 6)}-01`) && !otherTenantPage.body.includes(`AA-${runId.slice(0, 6)}-01`), "tenant B sees its own data and not tenant A's");

  for (const path of [`/vehicles/${vehicleIdB}`, `/drivers/${driverIdB}`, `/anomalies/${openAnomalyB}`, `/fines/${foreignFineB}`]) {
    const crossTenantTarget = await request(path, admin);
    assert.equal(crossTenantTarget.status, 404, `cross-tenant target ${path} is hidden server-side`);
  }

  await pool.query(
    `INSERT INTO vehicle_inspection (tenant_id, vehicle_id, technical_due_date, source, recorded_by_user_id)
     VALUES ($1, $2, CURRENT_DATE + $3::int, 'staff', $4)`,
    [tenantA, vehicleIdsA[0], windowDays + 1, adminIdA],
  );
  await pool.query("UPDATE vehicle SET insurance_expiry_date=CURRENT_DATE WHERE id=$1", [vehicleIdsA[0]]);
  await pool.query("UPDATE vehicle_document SET expiry_date=CURRENT_DATE - 2 WHERE id=$1", [documentIds[0]]);
  const changed = await request("/workspace", await signIn(users[0]));
  assert.equal(changed.status, 200, "alerts survive a fresh sign-in after source records change");
  assert.ok(!changed.body.includes(`data-alert-type="technical_inspection"`), "moving an inspection outside the window removes its alert");
  assertAlert(changed.body, "vehicle_insurance", "Due today", "updated insurance date");
  assertAlert(changed.body, "vehicle_document", "Overdue", "updated document date");
  const expectedChangedCount = expectedInitialCount - 1 + (windowDays < 7 ? 1 : 0) + (windowDays < 2 ? 1 : 0);
  assert.ok(changed.body.includes(`data-attention-count="${expectedChangedCount}"`), "alert count recalculates when source dates change");

  await pool.query("UPDATE vehicle_anomaly SET status='resolved', resolution_reason='Completed during alert verification.', closed_by_user_id=$2, closed_at=CURRENT_TIMESTAMP WHERE id=$1", [openAnomalyA, adminIdA]);
  await pool.query("UPDATE fine SET status='closed' WHERE id=$1", [overdueFineA]);
  const afterClosures = await request("/workspace", admin);
  assert.equal(afterClosures.status, 200);
  assert.ok(!afterClosures.body.includes(`data-alert-type="vehicle_anomaly"`), "resolving the last open anomaly removes that attention item");
  assert.ok(!afterClosures.body.includes(`AL-${runId.slice(0, 6)}-01`), "closing an overdue fine removes its deadline item");
  assert.ok(afterClosures.body.includes(`data-attention-count="${expectedChangedCount - 2}"`), "resolved and closed records leave the live count");

  process.stdout.write("In-app alert verification passed: configurable window with safe bounds; latest inspection history drives alerts; due and approaching insurance coverage; incomplete insurance is a persistent open alert; vehicle/driver documents and licence; open-only anomaly and fine items; tenant-derived count and content; all staff dashboard roles; Driver denial; cross-tenant targets hidden; source-date and completion changes refresh persisted results.\n");
} finally {
  await pool.query("DELETE FROM fine WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle_anomaly WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM driver_document WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle_document WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM driver WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle_inspection WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  if (userIds.length) await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [userIds]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
}
