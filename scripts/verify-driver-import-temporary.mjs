import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
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
  user: { additionalFields: {
    tenantId: { type: "string", required: false, input: false },
    appRole: { type: ["administrator", "fleet_manager", "manager", "driver"], required: false, input: false },
  } },
});

const runId = randomUUID();
const tenants = [randomUUID(), randomUUID()];
const password = randomBytes(24).toString("base64url");
const users = [
  { role: "administrator", tenant: tenants[0], name: "Driver Import Admin A" },
  { role: "fleet_manager", tenant: tenants[0], name: "Driver Import Fleet" },
  { role: "administrator", tenant: tenants[1], name: "Driver Import Admin B" },
].map((user, index) => ({ ...user, email: `driver-import-${runId}-${index}@example.invalid` }));

const headers = ["Full name", "Date of birth", "Street number", "Street name", "Postal code", "City", "Licence number", "Licence expiry date"];
const baseLicense = `IMPORT-${runId.replaceAll("-", "").slice(0, 14)}`;
function makeCsv(rows) {
  return [headers.join(","), ...rows.map((row) => row.map((cell) => {
    const value = String(cell ?? "");
    return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }).join(","))].join("\r\n") + "\r\n";
}
const row = (name, licence, overrides = {}) => ({
  fullName: name, dateOfBirth: "1990-08-15", streetNumber: "12 bis", streetName: "Rue de la Paix",
  postalCode: "07500", city: "Paris", licenceNumber: licence, licenceExpiryDate: "2030-01-01", ...overrides,
});

async function request(path, method = "GET", cookie, body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body instanceof FormData ? {} : body !== undefined ? { "content-type": "application/json", origin } : {}) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    redirect: "manual",
  });
  const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.arrayBuffer();
  return { status: response.status, data, response };
}

async function signIn(email) {
  const result = await request("/api/auth/sign-in/email", "POST", null, { email, password });
  assert.equal(result.status, 200, `sign-in failed for ${email}`);
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

async function upload(cookie, intent, filename, bytes) {
  const form = new FormData();
  form.set("intent", intent);
  form.set("file", new Blob([Uint8Array.from(bytes)]), filename);
  return request("/api/drivers/import", "POST", cookie, form);
}

async function xlsxFile(driverRows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Drivers");
  worksheet.addRow(headers);
  for (const item of driverRows) {
    worksheet.addRow([
      item.fullName, new Date(`${item.dateOfBirth}T00:00:00Z`), Number(item.streetNumber.replace(/\D/g, "")) || 12,
      item.streetName, item.postalCode, item.city, item.licenceNumber, new Date(`${item.licenceExpiryDate}T00:00:00Z`),
    ]);
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Driver Import QA A'), ($2, 'Driver Import QA B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2 WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = saved.rows[0].id;
  }
  const adminA = await signIn(users[0].email);
  const fleet = await signIn(users[1].email);
  const adminB = await signIn(users[2].email);

  assert.equal((await request("/api/drivers/import", "POST", null, new FormData())).status, 401);
  assert.equal((await request("/api/drivers/import?format=csv", "GET", null)).status, 401);
  assert.equal((await upload(fleet, "preview", "drivers.csv", makeCsv([Object.values(row("No access", baseLicense + "F"))]))).status, 403);

  const csvTemplate = await request("/api/drivers/import?format=csv", "GET", adminA);
  assert.equal(csvTemplate.status, 200);
  assert.match(Buffer.from(csvTemplate.data).toString("utf8"), /^Full name,Date of birth,Street number,Street name,Postal code,City,Licence number,Licence expiry date/);
  assert.match(csvTemplate.response.headers.get("content-disposition"), /nexdrive-driver-import-template\.csv/);
  const xlsxTemplate = await request("/api/drivers/import?format=xlsx", "GET", adminA);
  assert.equal(xlsxTemplate.status, 200);
  const templateBook = new ExcelJS.Workbook();
  await templateBook.xlsx.load(Buffer.from(xlsxTemplate.data));
  assert.equal(templateBook.worksheets[0].getRow(1).getCell(1).text, "Full name");
  const frenchCsvTemplate = await request("/api/drivers/import?format=csv&locale=fr", "GET", adminA);
  assert.equal(frenchCsvTemplate.status, 200);
  assert.match(Buffer.from(frenchCsvTemplate.data).toString("utf8"), /^Nom complet,Date de naissance,Numéro de rue,Nom de la rue,Code postal,Ville,Numéro de permis,Date d’expiration du permis/);
  const frenchXlsxTemplate = await request("/api/drivers/import?format=xlsx&locale=fr", "GET", adminA);
  assert.equal(frenchXlsxTemplate.status, 200);
  const frenchTemplateBook = new ExcelJS.Workbook();
  await frenchTemplateBook.xlsx.load(Buffer.from(frenchXlsxTemplate.data));
  assert.equal(frenchTemplateBook.worksheets[0].getRow(1).getCell(1).text, "Nom complet");

  const firstRows = [row("Doe, Jane", `${baseLicense}-A1`), row("Import Driver Two", `${baseLicense}-A2`, { dateOfBirth: "1985-03-04" })];
  const firstCsv = makeCsv(firstRows.map((item) => headers.map((header) => item[{
    "Full name": "fullName", "Date of birth": "dateOfBirth", "Street number": "streetNumber", "Street name": "streetName",
    "Postal code": "postalCode", City: "city", "Licence number": "licenceNumber", "Licence expiry date": "licenceExpiryDate",
  }[header]])));
  const preview = await upload(adminA, "preview", "drivers.csv", new TextEncoder().encode(firstCsv));
  assert.equal(preview.status, 200);
  assert.equal(preview.data.totalRows, 2);
  assert.equal(preview.data.validRows, 2);
  assert.equal(preview.data.errorRows, 0);
  assert.equal(preview.data.canCommit, true);
  assert.equal(preview.data.rows[0].fullName, "Doe, Jane", "quoted CSV values preserve commas");
  assert.equal("input" in preview.data.rows[0], false, "internal parsed fields are not returned to the browser");

  const committed = await upload(adminA, "commit", "drivers.csv", new TextEncoder().encode(firstCsv));
  assert.equal(committed.status, 200);
  assert.equal(committed.data.committed, true);
  assert.equal(committed.data.createdCount, 2);
  const listedA = await request("/api/drivers", "GET", adminA);
  assert.equal(listedA.status, 200);
  const importedA = listedA.data.drivers.filter((driver) => driver.licence_number?.startsWith(baseLicense));
  assert.equal(importedA.length, 2);
  assert.ok(importedA.every((driver) => driver.user_id === null), "imports never create or link account users");
  assert.equal(importedA.find((driver) => driver.full_name === "Import Driver Two").postal_code, "07500");

  const repeatedPreview = await upload(adminA, "preview", "drivers.csv", new TextEncoder().encode(firstCsv));
  assert.equal(repeatedPreview.data.canCommit, false, "repeat imports detect existing licence numbers within the tenant");
  assert.equal(repeatedPreview.data.errorRows, 2);
  const repeatedCommit = await upload(adminA, "commit", "drivers.csv", new TextEncoder().encode(firstCsv));
  assert.equal(repeatedCommit.status, 409);
  assert.equal(repeatedCommit.data.committed, false);
  assert.equal((await request("/api/drivers", "GET", adminA)).data.drivers.filter((driver) => driver.licence_number?.startsWith(baseLicense)).length, 2);

  const invalidRows = [row("Would be atomic", `${baseLicense}-ATOMIC`), row("Bad date", `${baseLicense}-DATE`, { dateOfBirth: "2035-02-29" }), row("Duplicate", `${baseLicense}-atomic`, { fullName: "Normalized duplicate" })];
  const invalidCsv = makeCsv(invalidRows.map((item) => headers.map((header) => item[{
    "Full name": "fullName", "Date of birth": "dateOfBirth", "Street number": "streetNumber", "Street name": "streetName",
    "Postal code": "postalCode", City: "city", "Licence number": "licenceNumber", "Licence expiry date": "licenceExpiryDate",
  }[header]])));
  const invalidPreview = await upload(adminA, "preview", "invalid.csv", new TextEncoder().encode(invalidCsv));
  assert.equal(invalidPreview.data.canCommit, false);
  assert.ok(invalidPreview.data.rows[1].errors.some((message) => /valid date|future/i.test(message)));
  assert.ok(invalidPreview.data.rows[2].errors.some((message) => /duplicates row/i.test(message)));
  const invalidCommit = await upload(adminA, "commit", "invalid.csv", new TextEncoder().encode(invalidCsv));
  assert.equal(invalidCommit.status, 409);
  assert.equal(invalidCommit.data.createdCount, 0);
  assert.equal((await request("/api/drivers", "GET", adminA)).data.drivers.some((driver) => driver.licence_number === `${baseLicense}-ATOMIC`), false, "one invalid row prevents all writes");

  const xlsxRows = [row("XLSX Import", `${baseLicense}-X1`, { dateOfBirth: "1991-04-05" })];
  const xlsxBytes = await xlsxFile(xlsxRows);
  const xlsxPreview = await upload(adminA, "preview", "drivers.xlsx", xlsxBytes);
  assert.equal(xlsxPreview.status, 200);
  assert.equal(xlsxPreview.data.canCommit, true);
  assert.equal(xlsxPreview.data.rows[0].postalCode, "07500");
  const xlsxCommitted = await upload(adminA, "commit", "drivers.xlsx", xlsxBytes);
  assert.equal(xlsxCommitted.status, 200);
  assert.equal(xlsxCommitted.data.createdCount, 1);

  const frenchHeaders = ["Nom complet", "Date de naissance", "Numéro de rue", "Nom de la rue", "Code postal", "Ville", "Numéro de permis", "Date d’expiration du permis"];
  const frenchCsv = [frenchHeaders.join(","), ["Conducteur Français", "1992-05-06", "4", "Rue Victor Hugo", "07500", "Paris", `${baseLicense}-FR1`, "2030-01-01"].join(",")].join("\r\n");
  const frenchPreview = await upload(adminA, "preview", "conducteurs.csv", new TextEncoder().encode(frenchCsv));
  assert.equal(frenchPreview.status, 200);
  assert.equal(frenchPreview.data.canCommit, true, "French template column labels are accepted by the parser");

  const crossTenantCsv = makeCsv([row("Tenant B same licence", `${baseLicense}-A1`)].map((item) => headers.map((header) => item[{
    "Full name": "fullName", "Date of birth": "dateOfBirth", "Street number": "streetNumber", "Street name": "streetName",
    "Postal code": "postalCode", City: "city", "Licence number": "licenceNumber", "Licence expiry date": "licenceExpiryDate",
  }[header]])));
  const crossTenantPreview = await upload(adminB, "preview", "drivers.csv", new TextEncoder().encode(crossTenantCsv));
  assert.equal(crossTenantPreview.data.canCommit, true, "duplicate matching does not leak across tenants");
  const crossTenantCommit = await upload(adminB, "commit", "drivers.csv", new TextEncoder().encode(crossTenantCsv));
  assert.equal(crossTenantCommit.data.createdCount, 1);

  const overRows = makeCsv(Array.from({ length: 501 }, (_, index) => row(`Over limit ${index}`, `${baseLicense}-CAP${index}`)).map((item) => headers.map((header) => item[{
    "Full name": "fullName", "Date of birth": "dateOfBirth", "Street number": "streetNumber", "Street name": "streetName",
    "Postal code": "postalCode", City: "city", "Licence number": "licenceNumber", "Licence expiry date": "licenceExpiryDate",
  }[header]])));
  const overLimit = await upload(adminA, "preview", "too-many.csv", new TextEncoder().encode(overRows));
  assert.equal(overLimit.status, 400);
  assert.match(overLimit.data.error, /at most 500/);
  const tooLarge = await upload(adminA, "preview", "too-large.csv", new Uint8Array(5 * 1024 * 1024 + 1));
  assert.equal(tooLarge.status, 400);
  assert.match(tooLarge.data.error, /5 MB/);

  process.stdout.write("Driver import verification passed: admin-only CSV/XLSX templates and routes, row preview/errors, strict validation, normalized duplicate detection, repeat-import protection, cross-tenant isolation, XLSX date/text handling, 500-row/5 MB limits, create-only atomic commit, and no account creation/linking.\n");
} finally {
  await pool.query("DELETE FROM driver WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
}
