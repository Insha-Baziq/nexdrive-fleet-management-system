import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { isOversizedUploadRejected, maxTestUploadBytes } from "./verify-upload-limits.mjs";

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
  role, tenant, name: `Maintenance QA ${role} ${index}`, email: `maintenance-${runId}-${index}@example.invalid`,
}));

async function request(path, method = "GET", cookie, body) {
  const tracksInvoiceRead = path.includes("/invoice/content");
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), tracksInvoiceRead ? 45_000 : 120_000);
  timeout.unref();
  let stage = "waiting for response headers";
  const headers = Object.assign({}, cookie ? { cookie } : {}, body instanceof FormData ? {} : body !== undefined ? { "content-type": "application/json", origin } : {});
  try {
    const response = await fetch(origin + path, {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      redirect: "manual",
      signal: controller.signal,
    });
    if (tracksInvoiceRead) {
      process.stdout.write(`Maintenance invoice response headers: HTTP ${response.status} after ${Date.now() - startedAt} ms.\n`);
    }
    stage = "reading response body";
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : Buffer.from(await response.arrayBuffer());
    if (tracksInvoiceRead) {
      process.stdout.write(`Maintenance invoice body complete: ${Buffer.isBuffer(data) ? data.length : "JSON"} bytes in ${Date.now() - startedAt} ms total.\n`);
    }
    return { status: response.status, data, response };
  } catch (error) {
    if (tracksInvoiceRead) {
      process.stdout.write(`Maintenance invoice read stopped while ${stage} after ${Date.now() - startedAt} ms (${error?.name || "error"}).\n`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function signIn(email) {
  const result = await request("/api/auth/sign-in/email", "POST", null, { email, password });
  assert.equal(result.status, 200, "temporary QA user can sign in");
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

async function createVehicle(cookie, suffix) {
  const result = await request("/api/vehicles", "POST", cookie, { registration: `M23-${suffix}`, make: "Renault", model: "Trafic", ownershipType: "owned" });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.vehicle.id;
}

function form({ date = "2026-09-18", location = "internal", garage = "", work = "Replaced front brake pads", parts = "Brake pads", fileName, bytes, mime = "application/pdf", extra } = {}) {
  const value = new FormData();
  value.set("interventionDate", date);
  value.set("locationType", location);
  value.set("garageName", garage);
  value.set("workPerformed", work);
  value.set("partsUsed", parts);
  if (bytes) value.append("invoice", new Blob([bytes], { type: mime }), fileName || "invoice.pdf");
  if (extra) for (const [key, field] of Object.entries(extra)) value.set(key, field);
  return value;
}

async function createIntervention(cookie, vehicleId, input = {}) {
  const result = await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", cookie, form(input));
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.intervention;
}

const usersByRole = Object.fromEntries(users.map((user) => [user.role === "administrator" && user.tenant === tenantB ? "otherAdmin" : user.role, user]));
let vehicleId;
let foreignVehicleId;
let siblingVehicleId;
try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, $3), ($2, $4)", [
    tenantA, tenantB, `Temporary Maintenance Verification ${runId} A`, `Temporary Maintenance Verification ${runId} B`,
  ]);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query('UPDATE "user" SET "tenantId" = $1, "appRole" = $2 WHERE email = $3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = saved.rows[0].id;
  }
  const [admin, fleet, manager, driver, otherAdmin] = await Promise.all([
    signIn(usersByRole.administrator.email), signIn(usersByRole.fleet_manager.email), signIn(usersByRole.manager.email),
    signIn(usersByRole.driver.email), signIn(usersByRole.otherAdmin.email),
  ]);
  vehicleId = await createVehicle(admin, `${runId.slice(0, 6)}A`);
  foreignVehicleId = await createVehicle(otherAdmin, `${runId.slice(0, 6)}B`);
  siblingVehicleId = await createVehicle(admin, `${runId.slice(0, 6)}C`);

  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "GET")).status, 401, "anonymous history access is denied");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "GET", driver)).status, 403, "Driver history access is denied");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "GET", otherAdmin)).status, 404, "cross-tenant parent IDs are hidden");
  assert.equal((await request(`/api/vehicles/${foreignVehicleId}/maintenance`, "POST", admin, form())).status, 404, "a cross-tenant vehicle cannot be used as the parent");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", manager, form())).status, 403, "Manager cannot create interventions");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", driver, form())).status, 403, "Driver cannot create interventions");

  const first = await createIntervention(admin, vehicleId, { date: "2026-09-17", work: "Checked the tire pressure", parts: "" });
  assert.equal(first.location_type, "internal");
  assert.equal(first.garage_name, null);
  assert.equal(first.parts_used, null, "parts notes may be omitted");
  const contentPdf = Buffer.alloc(64 * 1024, 0x20);
  Buffer.from("%PDF-1.7\nNexDrive invoice content verification\n", "ascii").copy(contentPdf, 0);
  const external = await createIntervention(fleet, vehicleId, {
    date: "2026-09-18", location: "external", garage: "Example Garage", work: "Replaced front brake pads",
    fileName: "brake-invoice.pdf", bytes: contentPdf,
  });
  assert.equal(external.location_type, "external");
  assert.equal(external.garage_name, "Example Garage");
  assert.equal(external.invoice.file_name, "brake-invoice.pdf");
  assert.equal(Number(external.invoice.file_size), contentPdf.length);

  const exactLimitPdf = Buffer.alloc(maxTestUploadBytes, 0x20);
  Buffer.from("%PDF-1.7\nNexDrive invoice verification\n", "ascii").copy(exactLimitPdf, 0);
  const exactLimit = await createIntervention(fleet, vehicleId, {
    date: "2026-09-19", location: "external", garage: "Example Garage", work: "Maximum-size invoice boundary",
    fileName: "maximum-size-invoice.pdf", bytes: exactLimitPdf,
  });
  assert.equal(Number(exactLimit.invoice.file_size), maxTestUploadBytes, "the maximum test upload is inclusive and persisted");

  const freshAdmin = await signIn(usersByRole.administrator.email);
  const persistedList = await request(`/api/vehicles/${vehicleId}/maintenance`, "GET", freshAdmin);
  assert.equal(persistedList.status, 200);
  assert.deepEqual(persistedList.data.interventions.map((item) => item.id), [exactLimit.id, external.id, first.id], "history persists and sorts newest intervention date first");
  assert.equal(Number(persistedList.data.interventions[0].invoice.file_size), maxTestUploadBytes, "the maximum-size invoice remains persisted after a fresh sign-in");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "GET", manager)).status, 200, "Manager can read tenant intervention history");

  const invoicePath = `/api/vehicles/${vehicleId}/maintenance/${external.id}/invoice/content`;
  const adminRead = await request(invoicePath, "GET", freshAdmin);
  assert.equal(adminRead.status, 200, "authorized staff can open the private Tigris invoice");
  assert.deepEqual(adminRead.data, contentPdf, "invoice bytes persist in private storage");
  assert.equal(adminRead.response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(adminRead.response.headers.get("x-content-type-options"), "nosniff");
  assert.match(adminRead.response.headers.get("content-disposition") || "", /^inline;/);
  assert.equal((await request(invoicePath, "GET", fleet)).status, 200, "Fleet Manager can open the invoice");
  const managerRead = await request(invoicePath, "GET", manager);
  assert.equal(managerRead.status, 200, "Manager has read access to the invoice");
  assert.equal((await request(invoicePath, "GET", driver)).status, 403, "Driver cannot open a staff-only invoice");
  assert.equal((await request(invoicePath, "GET")).status, 401, "anonymous invoice access is denied");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance/${randomUUID()}/invoice/content`, "GET", freshAdmin)).status, 404, "altered intervention IDs are denied");
  assert.equal((await request(`/api/vehicles/${foreignVehicleId}/maintenance/${external.id}/invoice/content`, "GET", freshAdmin)).status, 404, "cross-tenant parent vehicle IDs are denied");
  assert.equal((await request(`/api/vehicles/${siblingVehicleId}/maintenance/${external.id}/invoice/content`, "GET", freshAdmin)).status, 404, "altered same-tenant parent vehicle IDs are denied");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance/${external.id}/invoice/content`, "GET", otherAdmin)).status, 404, "another tenant cannot open an invoice");
  const invoiceDownload = await request(`/api/vehicles/${vehicleId}/maintenance/${external.id}/invoice/content?download=1`, "GET", freshAdmin);
  assert.equal(invoiceDownload.status, 200);
  assert.match(invoiceDownload.response.headers.get("content-disposition") || "", /^attachment;/, "authorized downloads are marked as attachments");
  assert.deepEqual(invoiceDownload.data, contentPdf, "authorized downloads return the persisted invoice bytes");

  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", admin, form({ date: "2026-02-30" }))).status, 400, "impossible dates are rejected");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", admin, form({ date: "2026-9-18" }))).status, 400, "non-ISO dates are rejected");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", admin, form({ location: "external", garage: "" }))).status, 400, "external work requires a garage name");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", admin, form({ location: "external", garage: "g".repeat(181) }))).status, 400, "external garage names above 180 characters are rejected");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", admin, form({ location: "internal", garage: "Incorrect garage" }))).status, 400, "internal work cannot be assigned an external garage name");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", admin, form({ work: "  " }))).status, 400, "blank work descriptions are rejected");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", admin, form({ work: "w".repeat(4001) }))).status, 400, "work descriptions above 4,000 characters are rejected");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", admin, form({ parts: "p".repeat(4001) }))).status, 400, "parts notes above 4,000 characters are rejected");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", admin, form({ work: "w".repeat(4000), parts: "p".repeat(4000) }))).status, 201, "the documented maximum text lengths are accepted");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", admin, form({ extra: { tenantId: tenantB } }))).status, 400, "tenant identifiers supplied by a caller are rejected");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", admin, form({ bytes: Buffer.from("not a pdf"), fileName: "wrong.pdf", mime: "application/pdf" }))).status, 400, "invoice bytes are checked against their type");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", admin, form({ bytes: Buffer.from("%PDF-1.7"), fileName: "mismatch.pdf", mime: "image/png" }))).status, 400, "a declared invoice MIME type must match its extension");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", admin, form({ bytes: Buffer.from("<svg/>", "utf8"), fileName: "bad.svg", mime: "image/svg+xml" }))).status, 400, "unsupported invoice types are rejected");
  const oneByteOver = Buffer.alloc(15 * 1024 * 1024 + 1, 0x20);
  Buffer.from("%PDF-1.7\n", "ascii").copy(oneByteOver, 0);
  const oversizeResponse = await request(`/api/vehicles/${vehicleId}/maintenance`, "POST", admin, form({ bytes: oneByteOver, fileName: "oversize.pdf" }));
  assert.ok(isOversizedUploadRejected(oversizeResponse.status), `invoice files above 15 MB are rejected (received ${oversizeResponse.status})`);

  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance/${first.id}`, "PATCH", manager, { action: "cancel", reason: "Manager denied" })).status, 403, "Manager cannot cancel interventions");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance/${first.id}`, "PATCH", driver, { action: "cancel", reason: "Driver denied" })).status, 403, "Driver cannot cancel interventions");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance/${first.id}`, "PATCH", admin, { action: "cancel", reason: "  " })).status, 400, "cancellation requires a nonblank reason");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance/${first.id}`, "PATCH", admin, { action: "cancel", reason: "r".repeat(1001) })).status, 400, "cancellation reason length is bounded");
  assert.equal((await request(`/api/vehicles/${foreignVehicleId}/maintenance/${first.id}`, "PATCH", admin, { action: "cancel", reason: "Altered parent" })).status, 404, "cancellation rejects a cross-tenant vehicle parent");
  assert.equal((await request(`/api/vehicles/${siblingVehicleId}/maintenance/${first.id}`, "PATCH", admin, { action: "cancel", reason: "Altered parent" })).status, 404, "cancellation rejects a different same-tenant vehicle parent");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance/${randomUUID()}`, "PATCH", admin, { action: "cancel", reason: "Unknown intervention" })).status, 404, "unknown interventions cannot be cancelled");
  const maximumReason = "r".repeat(1000);
  const cancelled = await request(`/api/vehicles/${vehicleId}/maintenance/${first.id}`, "PATCH", fleet, { action: "cancel", reason: maximumReason });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.intervention.status, "cancelled");
  assert.equal(cancelled.data.intervention.cancellation_reason.length, 1000, "the maximum cancellation reason length is accepted");
  assert.equal((await request(`/api/vehicles/${vehicleId}/maintenance/${first.id}`, "PATCH", admin, { action: "cancel", reason: "Try overwrite" })).status, 409, "cancellation history cannot be overwritten");
  const retainedHistory = await request(`/api/vehicles/${vehicleId}/maintenance`, "GET", freshAdmin);
  assert.equal(retainedHistory.status, 200);
  assert.ok(retainedHistory.data.interventions.some((item) => item.id === first.id && item.status === "cancelled" && item.cancellation_reason.length === 1000), "cancelled intervention remains in full history");
  const afterCancellation = await request(invoicePath, "GET", freshAdmin);
  assert.equal(afterCancellation.status, 200, "the private invoice remains available with retained cancelled history");
  assert.deepEqual(afterCancellation.data, contentPdf);

  process.stdout.write(`Maintenance verification passed: staff history persistence and ordering; internal and external records with required garage; private Tigris invoice open/download and retention; ${maxTestUploadBytes / (1024 * 1024)} MiB test boundary, supported type and content checks, malformed dates and text bounds; cancellation reason and retained history; and role, anonymous, cross-tenant, altered-parent, and altered-record denial.\n`);
} finally {
  const rows = await pool.query("SELECT storage_key FROM maintenance_invoice WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => ({ rows: [] }));
  await Promise.all(rows.rows.map(({ storage_key }) => storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: storage_key })).catch(() => undefined)));
  await pool.query("DELETE FROM vehicle_maintenance WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM assignment WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
  storage.destroy();
}




