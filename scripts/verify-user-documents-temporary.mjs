import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/lib/db.ts";
import { auth } from "../src/lib/auth.ts";
import {
  createUserDocumentUpload,
  deleteUserDocument,
  finishUserDocumentUpload,
  getUserDocumentContent,
  listUserDocuments,
} from "../src/lib/user-documents.ts";

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.BETTER_AUTH_SECRET || !process.env.DATABASE_URL
  || !process.env.TIGRIS_BUCKET || !process.env.TIGRIS_ACCESS_KEY_ID || !process.env.TIGRIS_SECRET_ACCESS_KEY) {
  throw new Error("Local database, auth, and private storage environment required");
}

const suffix = randomUUID();
const tenantId = randomUUID();
const otherTenantId = randomUUID();
const ownerEmail = `user-doc-owner-${suffix}@example.invalid`;
const otherEmail = `user-doc-other-${suffix}@example.invalid`;
const password = `${randomUUID()}-Aa1!`;
const uploadedIds = [];
const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
const notPdf = Buffer.from("not a PDF file");

async function addUser(email, tenant) {
  const created = await auth.api.signUpEmail({
    body: { name: "Temporary Document User", email, password },
    headers: new Headers({ origin, "x-nexdrive-onboarding-key": process.env.BETTER_AUTH_SECRET }),
  });
  assert.ok(created?.user?.id);
  await pool.query('UPDATE "user" SET "tenantId"=$1, "appRole"=\'administrator\', "emailVerified"=true WHERE id=$2', [tenant, created.user.id]);
  return created.user.id;
}

async function uploadBytes(upload, bytes, fileName) {
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append("file", new Blob([bytes], { type: "application/pdf" }), fileName);
  const response = await fetch(upload.uploadUrl, { method: "POST", body: form });
  assert.ok(response.ok, `private storage upload failed with ${response.status}`);
}

try {
  await pool.query("INSERT INTO tenant (id,name) VALUES ($1,$2),($3,$4)", [
    tenantId, `Temporary user documents ${suffix}`, otherTenantId, `Other temporary user docs ${suffix}`,
  ]);
  const ownerId = await addUser(ownerEmail, tenantId);
  const otherId = await addUser(otherEmail, otherTenantId);

  const upload = await createUserDocumentUpload({
    tenantId, userId: ownerId, name: "Proof of address", fileName: "proof.pdf", fileSize: pdf.length, extension: "pdf",
  });
  uploadedIds.push(upload.id);
  await uploadBytes(upload, pdf, "proof.pdf");
  await finishUserDocumentUpload(tenantId, ownerId, upload.id);
  const ownerList = await listUserDocuments(tenantId, ownerId);
  assert.equal(ownerList.length, 1);
  assert.equal(ownerList[0].id, upload.id);
  assert.equal(ownerList[0].category, "general");
  assert.equal(ownerList[0].file_name, "proof.pdf");
  assert.ok(ownerList[0].uploaded_at);
  const privateContent = await getUserDocumentContent(tenantId, ownerId, upload.id);
  assert.equal(privateContent.status, 200);
  assert.equal(privateContent.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.deepEqual(Buffer.from(await privateContent.arrayBuffer()), pdf);
  assert.deepEqual(await listUserDocuments(tenantId, otherId), []);
  await assert.rejects(getUserDocumentContent(otherTenantId, otherId, upload.id), (error) => error.status === 404);

  const invalidUpload = await createUserDocumentUpload({
    tenantId, userId: ownerId, name: "Invalid test file", fileName: "invalid.pdf", fileSize: notPdf.length, extension: "pdf",
  });
  uploadedIds.push(invalidUpload.id);
  await uploadBytes(invalidUpload, notPdf, "invalid.pdf");
  await assert.rejects(finishUserDocumentUpload(tenantId, ownerId, invalidUpload.id), (error) => error.status === 400);
  assert.equal((await listUserDocuments(tenantId, ownerId)).length, 1, "invalid file content must not become a ready document");

  await deleteUserDocument(tenantId, ownerId, upload.id);
  assert.deepEqual(await listUserDocuments(tenantId, ownerId), []);
  await assert.rejects(getUserDocumentContent(tenantId, ownerId, upload.id), (error) => error.status === 404);
  await assert.rejects(deleteUserDocument(otherTenantId, otherId, upload.id), (error) => error.status === 404);
  process.stdout.write("User document verification passed: real private upload/finalization, general category without expiry, content integrity, owner-only listing/content/deletion, invalid-file rejection, and cross-tenant isolation.\n");
} finally {
  const owner = await pool.query('SELECT id FROM "user" WHERE email=$1', [ownerEmail]).catch(() => ({ rows: [] }));
  if (owner.rows[0]) {
    for (const id of uploadedIds) await deleteUserDocument(tenantId, owner.rows[0].id, id).catch(() => undefined);
  }
  await pool.query('DELETE FROM "user" WHERE email=ANY($1::text[])', [[ownerEmail, otherEmail]]).catch(() => undefined);
  await pool.query("DELETE FROM tenant WHERE id=ANY($1::text[])", [[tenantId, otherTenantId]]).catch(() => undefined);
  await pool.end();
}
