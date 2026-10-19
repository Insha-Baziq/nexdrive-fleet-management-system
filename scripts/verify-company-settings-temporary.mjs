import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) throw new Error("Local environment required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const suffix = randomUUID();
const emails = {
  firstAdmin: `company-admin-${suffix}@example.invalid`,
  otherAdmin: `company-other-${suffix}@example.invalid`,
  manager: `company-manager-${suffix}@example.invalid`,
};
const tenantIds = [];
const password = randomBytes(24).toString("base64url");
let testIp = 100;

function nextIp() {
  testIp = (testIp % 200) + 1;
  return `198.51.100.${testIp}`;
}

async function request(path, method = "GET", body, cookie, originHeader = origin) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(method === "GET" ? {} : { origin: originHeader }),
      "x-forwarded-for": nextIp(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data, location: response.headers.get("location"), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

async function signIn(email) {
  const result = await request("/api/auth/sign-in/email", "POST", { email, password });
  assert.equal(result.status, 200, `sign-in failed for ${email}: ${JSON.stringify(result.data)}`);
  assert.ok(result.cookie);
  return result.cookie;
}

async function createOrganization(email, label) {
  const result = await request("/api/onboarding/create", "POST", {
    organizationName: `Temporary Company ${label} ${suffix}`,
    country: "FR",
    timezone: "Europe/Paris",
    name: `${label} Administrator`,
    email,
    password,
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const tenant = await pool.query('SELECT id, "tenantId", "emailVerified" FROM "user" WHERE email=$1', [email]);
  assert.ok(tenant.rows[0]?.tenantId);
  assert.equal(tenant.rows[0].emailVerified, false, "new organization administrators begin unverified");
  tenantIds.push(tenant.rows[0].tenantId);
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [tenant.rows[0].id]);
  return signIn(email);
}

function form(legalName, overrides = {}) {
  return {
    legalName,
    siret: "12345678901234",
    vatNumber: "FR 12 123456789",
    registeredAddress: "12 rue de l’Exemple\n75001 Paris",
    administrativeContactName: "Camille Martin",
    administrativeContactEmail: "camille@example.invalid",
    administrativeContactPhone: "+33 1 23 45 67 89",
    ...overrides,
  };
}

try {
  const columns = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='tenant' AND column_name = ANY($1::text[])`,
    [["legal_name", "siret", "vat_number", "registered_address", "administrative_contact_name", "administrative_contact_email", "administrative_contact_phone"]],
  );
  assert.equal(columns.rowCount, 7, "company information migration must be applied");

  assert.equal((await request("/api/settings/company")).status, 401, "company reads require sign-in");
  assert.equal((await request("/api/settings/company", "PATCH", form("Unauthorized"))).status, 401, "company writes require sign-in");

  const admin = await createOrganization(emails.firstAdmin, "First");
  const otherAdmin = await createOrganization(emails.otherAdmin, "Second");
  const invitation = await request("/api/invitations", "POST", { email: emails.manager, role: "manager" }, admin);
  assert.equal(invitation.status, 201, JSON.stringify(invitation.data));
  const registered = await request("/api/onboarding/account", "POST", {
    invitationCode: invitation.data.code, name: "Company Manager", email: emails.manager, password,
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.data));
  const managerUser = await pool.query('SELECT id, "emailVerified" FROM "user" WHERE email=$1', [emails.manager]);
  assert.equal(managerUser.rows[0]?.emailVerified, false, "invitee must verify before signing in");
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [managerUser.rows[0].id]);
  const manager = await signIn(emails.manager);
  const joined = await request("/api/onboarding/join-existing", "POST", { code: invitation.data.code }, manager);
  assert.equal(joined.status, 200, JSON.stringify(joined.data));

  const adminInitial = await request("/api/settings/company", "GET", undefined, admin);
  assert.equal(adminInitial.status, 200, JSON.stringify(adminInitial.data));
  assert.equal(adminInitial.data.company.legal_name, `Temporary Company First ${suffix}`, "the existing tenant name is the initial legal-name value");
  const savedValues = form("Atelier Véhicules Exemple SARL");
  const saved = await request("/api/settings/company", "PATCH", savedValues, admin);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.company, {
    legal_name: savedValues.legalName,
    siret: savedValues.siret,
    vat_number: savedValues.vatNumber.toUpperCase(),
    registered_address: savedValues.registeredAddress,
    administrative_contact_name: savedValues.administrativeContactName,
    administrative_contact_email: savedValues.administrativeContactEmail,
    administrative_contact_phone: savedValues.administrativeContactPhone,
  });

  const managerRead = await request("/api/settings/company", "GET", undefined, manager);
  assert.equal(managerRead.status, 200, "same-tenant company read uses the authenticated tenant");
  assert.deepEqual(managerRead.data.company, saved.data.company);
  assert.equal((await request("/api/settings/company", "PATCH", form("Manager Edit"), manager)).status, 403, "a non-administrator cannot edit company information");

  assert.equal((await request("/api/settings/company", "PATCH", form("Bad origin"), admin, "https://attacker.invalid")).status, 403, "company writes enforce same-origin requests");
  assert.equal((await request("/api/settings/company", "PATCH", form("Bad SIRET", { siret: "123" }), admin)).status, 400, "SIRET must contain 14 digits");
  assert.equal((await request("/api/settings/company", "PATCH", form("Bad contact", { administrativeContactEmail: "not-an-email" }), admin)).status, 400, "contact email is validated");
  assert.equal((await request("/api/settings/company", "PATCH", { ...form("Spoofed"), tenantId: tenantIds[1] }, admin)).status, 400, "tenant IDs cannot be supplied by the client");
  assert.deepEqual((await request(`/api/settings/company?tenantId=${tenantIds[1]}`, "GET", undefined, admin)).data.company, saved.data.company, "a requested tenant ID cannot change read scope");

  const otherRead = await request("/api/settings/company", "GET", undefined, otherAdmin);
  assert.equal(otherRead.status, 200);
  assert.equal(otherRead.data.company.legal_name, `Temporary Company Second ${suffix}`);
  assert.ok(!JSON.stringify(otherRead.data).includes(savedValues.legalName), "another tenant cannot read company data");
  const otherSaved = await request("/api/settings/company", "PATCH", form("Second Tenant SARL"), otherAdmin);
  assert.equal(otherSaved.status, 200);
  assert.equal(otherSaved.data.company.legal_name, "Second Tenant SARL");
  assert.deepEqual((await request("/api/settings/company", "GET", undefined, admin)).data.company, saved.data.company, "one tenant cannot change another tenant's company data");

  const persisted = await pool.query(
    `SELECT legal_name, siret, vat_number, registered_address, administrative_contact_name,
       administrative_contact_email, administrative_contact_phone
     FROM tenant WHERE id=$1`,
    [tenantIds[0]],
  );
  assert.deepEqual(persisted.rows[0], saved.data.company, "saved company fields persist in the tenant row");
  const freshAdmin = await signIn(emails.firstAdmin);
  assert.deepEqual((await request("/api/settings/company", "GET", undefined, freshAdmin)).data.company, saved.data.company, "company information survives a fresh sign-in");

  const adminPage = await fetch(`${origin}/settings/company`, { headers: { cookie: admin }, redirect: "manual" });
  assert.equal(adminPage.status, 200);
  const html = await adminPage.text();
  assert.ok(html.includes(savedValues.legalName));
  assert.ok(html.includes("SIRET"));
  const managerPage = await fetch(`${origin}/settings/company`, { headers: { cookie: manager }, redirect: "manual" });
  assert.equal(managerPage.status, 404, "company settings page is restricted to administrators");
  const anonymousPage = await fetch(`${origin}/settings/company`, { redirect: "manual" });
  assert.equal(anonymousPage.status, 307);
  assert.equal(anonymousPage.headers.get("location"), "/login");

  process.stdout.write("Company settings verification passed: tenant-scoped read/write, administrator-only edits and page access, cross-tenant isolation, origin and input validation, client tenant-ID rejection, and database/fresh-session persistence.\n");
} finally {
  const foundTenants = await pool.query('SELECT "tenantId" FROM "user" WHERE email = ANY($1::text[])', [Object.values(emails)]).catch(() => ({ rows: [] }));
  for (const row of foundTenants.rows) if (row.tenantId) tenantIds.push(row.tenantId);
  const allTenantIds = [...new Set(tenantIds)];
  if (allTenantIds.length) await pool.query("DELETE FROM organization_invitation WHERE tenant_id = ANY($1::text[])", [allTenantIds]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [Object.values(emails)]).catch(() => undefined);
  if (allTenantIds.length) await pool.query("DELETE FROM tenant WHERE id = ANY($1::text[])", [allTenantIds]).catch(() => undefined);
  await pool.end();
}
