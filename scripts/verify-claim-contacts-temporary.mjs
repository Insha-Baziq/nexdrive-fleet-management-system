import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth } from "better-auth";

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Local claim-contact verification needs app configuration (${missing.join(", ")}).`);

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
const tenantA = randomUUID(), tenantB = randomUUID(), runId = randomUUID();
const tenants = [tenantA, tenantB];
const password = randomBytes(24).toString("base64url");
const users = [
  { key: "admin", role: "administrator", tenant: tenantA },
  { key: "fleet", role: "fleet_manager", tenant: tenantA },
  { key: "manager", role: "manager", tenant: tenantA },
  { key: "driver", role: "driver", tenant: tenantA },
  { key: "foreign", role: "administrator", tenant: tenantB },
].map((user) => ({ ...user, name: `Contacts QA ${user.key}`, email: `contacts-${runId}-${user.key}@example.invalid` }));

async function request(path, method = "GET", cookie, body) {
  const response = await fetch(origin + path, {
    method,
    headers: Object.assign({}, cookie ? { cookie } : {}, body !== undefined ? { "content-type": "application/json", origin } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
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

const contactUrl = (claimId) => `/api/claims/${claimId}/contacts`;
const contact = (overrides = {}) => ({ role: "insurer", name: "Mira Assurance", phone: "+33 1 42 00 00 00", email: "claims@example.invalid", note: "Reference CLM-2026-18", ...overrides });
let vehicleA, vehicleB, claimA, claimB, foreignVehicle, foreignClaim;
try {
  await pool.query("INSERT INTO tenant (id, name) VALUES ($1, 'Temporary Contacts QA A'), ($2, 'Temporary Contacts QA B')", tenants);
  for (const user of users) {
    await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password }, headers: new Headers({ origin }) });
    const saved = await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=$2 WHERE email=$3 RETURNING id', [user.tenant, user.role, user.email]);
    user.id = saved.rows[0].id;
  }
  const [admin, fleet, manager, driver, foreignAdmin] = await Promise.all(users.map(signIn));
  [vehicleA, vehicleB, foreignVehicle] = [randomUUID(), randomUUID(), randomUUID()];
  await pool.query(
    `INSERT INTO vehicle (id, tenant_id, registration, make, model, current_mileage)
     VALUES ($1, $2, $3, 'Renault', 'Clio', NULL), ($4, $2, $5, 'Peugeot', '208', NULL), ($6, $7, $8, 'Citroen', 'C3', NULL)`,
    [vehicleA, tenantA, `QA-${runId.slice(0, 6)}-AA`, vehicleB, `QB-${runId.slice(0, 6)}-AA`, foreignVehicle, tenantB, `QC-${runId.slice(0, 6)}-AA`],
  );
  [claimA, claimB, foreignClaim] = [randomUUID(), randomUUID(), randomUUID()];
  const claimRows = [
    [claimA, tenantA, vehicleA, users[2].id],
    [claimB, tenantA, vehicleB, users[2].id],
    [foreignClaim, tenantB, foreignVehicle, users[4].id],
  ];
  for (const [id, tenant, vehicle, creator] of claimRows) {
    await pool.query("INSERT INTO claim (id, tenant_id, vehicle_id, incident_date, description, created_by_user_id) VALUES ($1, $2, $3, '2026-09-25', 'Temporary contact verification claim.', $4)", [id, tenant, vehicle, creator]);
    await pool.query(
      `INSERT INTO claim_evidence (id, tenant_id, claim_id, storage_key, file_name, file_extension, content_type, file_size, uploaded_by_user_id)
       VALUES ($1, $2, $3, $4, 'fixture.pdf', 'pdf', 'application/pdf', 1, $5)`,
      [randomUUID(), tenant, id, `verification-only/${runId}/${id}`, creator],
    );
  }

  assert.equal((await request(contactUrl(claimA))).status, 401, "contact reads require sign-in");
  assert.equal((await request(contactUrl(claimA), "POST", null, contact())).status, 401, "contact writes require sign-in");
  const empty = await request(contactUrl(claimA), "GET", manager);
  assert.equal(empty.status, 200, JSON.stringify(empty.data));
  assert.deepEqual(empty.data.contacts, []);

  const created = await request(contactUrl(claimA), "POST", manager, contact());
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const insurer = created.data.contact;
  assert.equal(insurer.role, "insurer");
  assert.equal(insurer.name, "Mira Assurance");
  assert.equal(insurer.phone, "+33 1 42 00 00 00");
  assert.equal(insurer.email, "claims@example.invalid");
  assert.equal(insurer.note, "Reference CLM-2026-18");
  assert.equal(JSON.stringify(insurer).includes("tenant_id"), false, "API does not expose internal tenant metadata");

  const persisted = await request(contactUrl(claimA), "GET", await signIn(users[2]));
  assert.equal(persisted.status, 200);
  assert.deepEqual(persisted.data.contacts.map(({ id }) => id), [insurer.id], "contact persists after fresh sign-in");
  assert.deepEqual((await request(`${contactUrl(claimA)}?tenantId=${tenantB}`, "GET", manager)).data.contacts.map(({ id }) => id), [insurer.id], "query tenant tampering cannot change the session tenant");
  assert.deepEqual((await request(contactUrl(claimA), "GET", fleet)).data.contacts.map(({ id }) => id), [insurer.id], "Fleet Manager can read contacts");
  assert.equal((await request(contactUrl(claimA), "POST", fleet, contact({ name: "Fleet edit attempt" }))).status, 403, "Fleet Manager cannot change contacts");
  assert.equal((await request(contactUrl(claimA), "GET", driver)).status, 403, "Driver cannot read organization claim contacts");
  assert.equal((await request(contactUrl(claimA), "POST", driver, contact())).status, 403, "Driver cannot add contacts");

  assert.equal((await request(contactUrl(foreignClaim), "GET", manager)).status, 404, "tenant cannot read another tenant's claim contacts");
  assert.equal((await request(contactUrl(claimA), "GET", foreignAdmin)).status, 404, "foreign tenant cannot guess a claim ID");
  assert.equal((await request(contactUrl(foreignClaim), "POST", manager, contact())).status, 404, "tenant cannot add a contact to another tenant's claim");
  assert.equal((await request(contactUrl(claimA), "POST", foreignAdmin, contact())).status, 404, "foreign tenant cannot write to a guessed claim ID");
  assert.equal((await request(contactUrl(claimB), "GET", manager)).data.contacts.length, 0, "contacts cannot be read through an altered parent claim ID");
  assert.equal((await request(contactUrl(claimB), "POST", manager, { ...contact(), claimId: claimA })).status, 400, "client cannot override the route's parent claim ID");
  assert.equal((await request(contactUrl(claimA), "PATCH", manager, contact())).status, 405, "ticket adds no contact edit workflow");
  assert.equal((await request(contactUrl(claimA), "DELETE", manager)).status, 405, "ticket adds no contact delete workflow");

  for (const [label, payload] of [
    ["unknown contact role", contact({ role: "bank" })],
    ["blank name", contact({ name: "  " })],
    ["name too long", contact({ name: "x".repeat(161) })],
    ["phone too long", contact({ phone: "1".repeat(81) })],
    ["invalid email", contact({ email: "not-an-email" })],
    ["email too long", contact({ email: `${"a".repeat(246)}@example.com` })],
    ["note too long", contact({ note: "x".repeat(1001) })],
    ["unknown tenant field", { ...contact(), tenantId: tenantB }],
    ["unknown contact identifier", { ...contact(), id: randomUUID() }],
    ["null role", contact({ role: null })],
  ]) {
    const rejected = await request(contactUrl(claimA), "POST", manager, payload);
    assert.equal(rejected.status, 400, `${label} is rejected (received ${rejected.status})`);
  }

  const validRoles = ["expert", "garage", "other"];
  for (const role of validRoles) {
    const result = await request(contactUrl(claimA), "POST", manager, { role, name: `${role} record` });
    assert.equal(result.status, 201, `${role} contact is accepted with optional details omitted`);
    assert.equal(result.data.contact.phone, null);
    assert.equal(result.data.contact.email, null);
    assert.equal(result.data.contact.note, null);
  }
  const boundary = await request(contactUrl(claimA), "POST", admin, {
    role: "other", name: "N".repeat(160), phone: "1".repeat(80),
    email: `${"a".repeat(64)}@${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(57)}.com`, note: "n".repeat(1000),
  });
  assert.equal(boundary.status, 201, `maximum contact field lengths are accepted (${JSON.stringify(boundary.data)})`);
  assert.equal(boundary.data.contact.name.length, 160);
  assert.equal(boundary.data.contact.phone.length, 80);
  assert.equal(boundary.data.contact.email.length, 254);
  assert.equal(boundary.data.contact.note.length, 1000);

  const page = await request(`/claims/${claimA}`, "GET", manager);
  assert.equal(page.status, 200);
  assert.match(page.data, /Contacts/);
  assert.match(page.data, /Mira Assurance/);
  assert.match(page.data, /Garage|garage record/);
  assert.doesNotMatch(page.data, /Send email|Calendar invite|Open garage portal|Insurer integration/i, "no external communication workflow is introduced");
  const fleetPage = await request(`/claims/${claimA}`, "GET", fleet);
  assert.match(fleetPage.data, /Mira Assurance/);
  assert.doesNotMatch(fleetPage.data, /Add contact/);
  assert.equal((await request(`/claims/${claimA}`, "GET", driver)).status, 404, "Driver cannot inspect claim details or contact names");

  const rows = await pool.query("SELECT tenant_id, claim_id, role, name FROM claim_contacts WHERE tenant_id=$1 AND claim_id=$2 ORDER BY created_at, id", [tenantA, claimA]);
  assert.equal(rows.rows.length, 5, "expected insurer, expert, garage, other, and boundary records in this claim only");
  assert.ok(rows.rows.every((row) => row.tenant_id === tenantA && row.claim_id === claimA));
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM claim_contacts WHERE claim_id=$1", [claimB])).rows[0].count, 0, "no contact leaked to the adjacent claim");
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM claim_contacts WHERE tenant_id=$1", [tenantB])).rows[0].count, 0, "no contact written into the other tenant");

  process.stdout.write("Claim-contact verification passed: role/name/details, database persistence, fresh-sign-in and Fleet read access; Manager/Admin writes; Driver/anonymous/cross-tenant/altered-parent denial; input boundaries; and no external workflow.");
} finally {
  await pool.query("DELETE FROM claim WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query("DELETE FROM vehicle WHERE tenant_id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [users.map((user) => user.email)]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id=ANY($1::text[])", [tenants]).catch(() => undefined);
  await pool.end();
}
