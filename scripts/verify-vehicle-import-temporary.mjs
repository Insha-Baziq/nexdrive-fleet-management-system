import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.BETTER_AUTH_SECRET || !process.env.DATABASE_URL) throw new Error("Local auth and database environment is required");
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
  { role: "administrator", tenant: tenants[0], name: "Vehicle Import Admin A" },
  { role: "fleet_manager", tenant: tenants[0], name: "Vehicle Import Fleet" },
  { role: "administrator", tenant: tenants[1], name: "Vehicle Import Admin B" },
].map((user, index) => ({ ...user, email: `vehicle-import-${runId}-${index}@example.invalid` }));
const headers = [
  "Registration", "Make", "Model", "Year", "Ownership type", "Registered holder", "Insurance company",
  "Insurance expiry date", "Bonus-malus", "Technical inspection due date", "Emissions inspection due date",
];
const regPrefix = `VIMP${runId.replaceAll("-", "").slice(0, 10)}`.toUpperCase();
const vehicle = (registration, overrides = {}) => ({
  registration, make: "Renault", model: "Clio", year: "2022", ownershipType: "owned", registeredHolder: "",
  insuranceCompany: "Assureur QA", insuranceExpiryDate: "2030-12-31", bonusMalus: "0.95",
  technicalInspectionDate: "2027-05-15", emissionsDueDate: "2028-05-15", ...overrides,
});
function makeCsv(rows, columns = headers) {
  return [columns.join(","), ...rows.map((row) => columns.map((column) => {
    const key = ({
      Registration: "registration", Make: "make", Model: "model", Year: "year", "Ownership type": "ownershipType",
      "Registered holder": "registeredHolder", "Insurance company": "insuranceCompany", "Insurance expiry date": "insuranceExpiryDate",
      "Bonus-malus": "bonusMalus", "Technical inspection due date": "technicalInspectionDate", "Emissions inspection due date": "emissionsDueDate",
      Immatriculation: "registration", Marque: "make", Modèle: "model", Année: "year", "Type de propriété": "ownershipType",
      "Titulaire de la carte grise": "registeredHolder", Assureur: "insuranceCompany", "Date d’expiration de l’assurance": "insuranceExpiryDate",
      "Échéance du contrôle technique": "technicalInspectionDate", "Échéance du contrôle antipollution": "emissionsDueDate",
    })[column];
    const value = String(row[key] ?? "");
    return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }).join(","))].join("\r\n") + "\r\n";
}
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
  return request("/api/vehicles/import", "POST", cookie, form);
}
async function xlsxFile(rows, columnHeaders = headers) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Vehicles");
  worksheet.addRow(columnHeaders);
  for (const item of rows) worksheet.addRow([
    item.registration, item.make, item.model, Number(item.year), item.ownershipType, item.registeredHolder,
    item.insuranceCompany, new Date(`${item.insuranceExpiryDate}T00:00:00Z`), Number(item.bonusMalus),
    new Date(`${item.technicalInspectionDate}T00:00:00Z`), new Date(`${item.emissionsDueDate}T00:00:00Z`),
  ]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Vehicle Import QA A'), ($2, 'Vehicle Import QA B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2 WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = saved.rows[0].id;
  }
  const adminA = await signIn(users[0].email);
  const fleet = await signIn(users[1].email);
  const adminB = await signIn(users[2].email);

  assert.equal((await request("/api/vehicles/import", "POST", null, new FormData())).status, 401);
  assert.equal((await request("/api/vehicles/import?format=csv", "GET", null)).status, 401);
  assert.equal((await request("/api/vehicles/import?format=csv", "GET", fleet)).status, 403);
  assert.equal((await upload(fleet, "preview", "vehicles.csv", new TextEncoder().encode(makeCsv([vehicle(`${regPrefix}-NOACCESS`)])))).status, 403);

  const csvTemplate = await request("/api/vehicles/import?format=csv", "GET", adminA);
  assert.equal(csvTemplate.status, 200);
  assert.match(Buffer.from(csvTemplate.data).toString("utf8"), /^Registration,Make,Model,Year,Ownership type,Registered holder,Insurance company,Insurance expiry date,Bonus-malus,Technical inspection due date,Emissions inspection due date/);
  const xlsxTemplate = await request("/api/vehicles/import?format=xlsx", "GET", adminA);
  assert.equal(xlsxTemplate.status, 200);
  const templateBook = new ExcelJS.Workbook();
  await templateBook.xlsx.load(Buffer.from(xlsxTemplate.data));
  assert.equal(templateBook.worksheets.length, 1);
  assert.equal(templateBook.worksheets[0].getRow(1).getCell(1).text, "Registration");
  assert.equal(templateBook.worksheets[0].getCell("E2").dataValidation.type, "list");
  const frenchCsvTemplate = await request("/api/vehicles/import?format=csv&locale=fr", "GET", adminA);
  assert.match(Buffer.from(frenchCsvTemplate.data).toString("utf8"), /^Immatriculation,Marque,Modèle,Année,Type de propriété,Titulaire de la carte grise,Assureur/);

  const validRows = [
    vehicle(`${regPrefix}-OWNED`),
    vehicle(`${regPrefix}-RENTAL`, { ownershipType: "long_term_rental", registeredHolder: "Société de location" }),
  ];
  const csv = makeCsv(validRows);
  const preview = await upload(adminA, "preview", "vehicles.csv", new TextEncoder().encode(csv));
  assert.equal(preview.status, 200);
  assert.equal(preview.data.totalRows, 2);
  assert.equal(preview.data.validRows, 2);
  assert.equal(preview.data.canCommit, true);
  assert.equal("input" in preview.data.rows[0], false, "parsed write models are not returned to the browser");
  const committed = await upload(adminA, "commit", "vehicles.csv", new TextEncoder().encode(csv));
  assert.equal(committed.status, 200);
  assert.equal(committed.data.createdCount, 2);
  const listed = await request("/api/vehicles", "GET", adminA);
  assert.equal(listed.status, 200);
  const imported = listed.data.vehicles.filter((item) => item.registration.startsWith(regPrefix));
  assert.equal(imported.length, 2);
  assert.equal(imported.find((item) => item.registration.endsWith("OWNED")).ownership_type, "owned");
  assert.equal(imported.find((item) => item.registration.endsWith("RENTAL")).registered_holder, "Société de location");
  assert.equal(imported.find((item) => item.registration.endsWith("OWNED")).insurance_status, "insured");
  const seededInspection = await pool.query(
    `SELECT i.technical_due_date::text, i.emissions_due_date::text, i.source, i.recorded_by_user_id
     FROM vehicle_inspection i JOIN vehicle v ON v.id=i.vehicle_id AND v.tenant_id=i.tenant_id
     WHERE i.tenant_id=$1 AND v.registration=$2`,
    [tenants[0], `${regPrefix}-OWNED`],
  );
  assert.equal(seededInspection.rows[0].technical_due_date, "2027-05-15");
  assert.equal(seededInspection.rows[0].emissions_due_date, "2028-05-15");
  assert.equal(seededInspection.rows[0].source, "staff");
  assert.equal(seededInspection.rows[0].recorded_by_user_id, users[0].id);
  const syntheticEvents = await pool.query("SELECT count(*)::int AS count FROM vehicle_insurance_event WHERE tenant_id=$1 AND vehicle_id=$2", [tenants[0], imported.find((item) => item.registration.endsWith("OWNED")).id]);
  assert.equal(syntheticEvents.rows[0].count, 0, "imported insurer fields do not create unverified insurance events");

  const normalizedDuplicate = makeCsv([vehicle(`${regPrefix.replaceAll("-", "")} OWNED`)]);
  const repeated = await upload(adminA, "preview", "repeat.csv", new TextEncoder().encode(normalizedDuplicate));
  assert.equal(repeated.data.canCommit, false, "matching removes spaces and hyphens and ignores letter case within the tenant");
  assert.ok(repeated.data.rows[0].errors.some((message) => /already exists/i.test(message)));
  const repeatCommit = await upload(adminA, "commit", "repeat.csv", new TextEncoder().encode(normalizedDuplicate));
  assert.equal(repeatCommit.status, 409);
  assert.equal(repeatCommit.data.committed, false);
  assert.equal((await request("/api/vehicles", "GET", adminA)).data.vehicles.filter((item) => item.registration.startsWith(regPrefix)).length, 2);

  const invalidRows = [
    vehicle(`${regPrefix}-ATOMIC`),
    vehicle(`${regPrefix}-HOLDER`, { ownershipType: "loan", registeredHolder: "" }),
    vehicle(`${regPrefix}-INSURANCE-DATE`, { insuranceExpiryDate: "2030-02-30" }),
    vehicle(`${regPrefix}-TECH-DATE`, { technicalInspectionDate: "2028-02-30" }),
    vehicle(`${regPrefix}-EMISSIONS-DATE`, { emissionsDueDate: "2028-02-30" }),
    vehicle(`${regPrefix}-DUPLICATE`),
    vehicle(`${regPrefix.replaceAll("-", "")} DUPLICATE`),
  ];
  const invalidPreview = await upload(adminA, "preview", "invalid.csv", new TextEncoder().encode(makeCsv(invalidRows)));
  assert.equal(invalidPreview.data.canCommit, false);
  assert.ok(invalidPreview.data.rows[1].errors.some((message) => /titulaire/i.test(message)));
  assert.ok(invalidPreview.data.rows[2].errors.some((message) => /valid date/i.test(message)));
  assert.ok(invalidPreview.data.rows[3].errors.some((message) => /valid date/i.test(message)));
  assert.ok(invalidPreview.data.rows[4].errors.some((message) => /emissions inspection/i.test(message)));
  assert.ok(invalidPreview.data.rows[6].errors.some((message) => /duplicates row/i.test(message)));
  const invalidCommit = await upload(adminA, "commit", "invalid.csv", new TextEncoder().encode(makeCsv(invalidRows)));
  assert.equal(invalidCommit.status, 409);
  assert.equal(invalidCommit.data.createdCount, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM vehicle WHERE tenant_id=$1 AND registration=$2", [tenants[0], `${regPrefix}-ATOMIC`])).rows[0].count, 0, "an invalid row prevents all writes");

  const xlsxRows = [vehicle(`${regPrefix}-XLSX`, { ownershipType: "loan", registeredHolder: "Atelier QA" })];
  const xlsx = await xlsxFile(xlsxRows);
  const xlsxPreview = await upload(adminA, "preview", "vehicles.xlsx", xlsx);
  assert.equal(xlsxPreview.status, 200);
  assert.equal(xlsxPreview.data.canCommit, true);
  const xlsxCommit = await upload(adminA, "commit", "vehicles.xlsx", xlsx);
  assert.equal(xlsxCommit.status, 200);
  assert.equal(xlsxCommit.data.createdCount, 1);

  const frenchHeaders = ["Immatriculation", "Marque", "Modèle", "Année", "Type de propriété", "Titulaire de la carte grise", "Assureur", "Date d’expiration de l’assurance", "Bonus-malus", "Échéance du contrôle technique", "Échéance du contrôle antipollution"];
  const frenchRow = vehicle(`${regPrefix}-FR`, { ownershipType: "location longue durée", registeredHolder: "Loueur QA", bonusMalus: "0,85" });
  const frenchCsv = makeCsv([frenchRow], frenchHeaders);
  const frenchPreview = await upload(adminA, "preview", "vehicules.csv", new TextEncoder().encode(frenchCsv));
  assert.equal(frenchPreview.status, 200);
  assert.equal(frenchPreview.data.canCommit, true, "French labels and ownership values are accepted");
  const frenchCommit = await upload(adminA, "commit", "vehicules.csv", new TextEncoder().encode(frenchCsv));
  assert.equal(frenchCommit.status, 200);

  const crossTenant = makeCsv([vehicle(`${regPrefix}-OWNED`)]);
  const crossTenantPreview = await upload(adminB, "preview", "cross-tenant.csv", new TextEncoder().encode(crossTenant));
  assert.equal(crossTenantPreview.data.canCommit, true, "registration duplicates are isolated to the authenticated tenant");
  const crossTenantCommit = await upload(adminB, "commit", "cross-tenant.csv", new TextEncoder().encode(crossTenant));
  assert.equal(crossTenantCommit.data.createdCount, 1);

  const tooMany = makeCsv(Array.from({ length: 501 }, (_, index) => vehicle(`${regPrefix}-CAP${index}`, { technicalInspectionDate: "", emissionsDueDate: "" })));
  const overLimit = await upload(adminA, "preview", "too-many.csv", new TextEncoder().encode(tooMany));
  assert.equal(overLimit.status, 400);
  assert.match(overLimit.data.error, /at most 500/);
  const tooLarge = await upload(adminA, "preview", "too-large.csv", new Uint8Array(5 * 1024 * 1024 + 1));
  assert.equal(tooLarge.status, 400);
  assert.match(tooLarge.data.error, /5 MB/);

  process.stdout.write("Vehicle import verification passed: administrator-only CSV/XLSX templates/routes, ownership and holder validation, insurance and inspection field validation, staff-attributed inspection history, current insurance inference without fabricated events, normalized tenant-scoped registration matching, atomic create-only commits, French headers/values, cross-tenant isolation, 500-row/5 MB limits, and no partial writes.");
} finally {
  await pool.query("DELETE FROM vehicle_inspection WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle WHERE tenant_id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
}
