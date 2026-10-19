import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getOrganizationSession } from "@/lib/organization-session";
import { jsonBody, sameOrigin } from "@/lib/onboarding-http";

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await jsonBody(request).catch(() => null) as { firstName?: unknown; lastName?: unknown } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== 2 || !Object.hasOwn(body, "firstName") || !Object.hasOwn(body, "lastName")
    || typeof body.firstName !== "string" || typeof body.lastName !== "string") {
    return NextResponse.json({ error: "Enter a first and last name." }, { status: 400 });
  }
  const firstName = body.firstName.trim();
  const lastName = body.lastName.trim();
  if (!firstName || firstName.length > 80 || lastName.length > 80) {
    return NextResponse.json({ error: "Use a first name up to 80 characters and a last name up to 80 characters." }, { status: 400 });
  }
  const name = [firstName, lastName].filter(Boolean).join(" ");
  const updated = await pool.query<{ name: string }>(
    'UPDATE "user" SET name=$1 WHERE id=$2 AND EXISTS (SELECT 1 FROM organization_membership WHERE user_id=$2 AND tenant_id=$3 AND disabled_at IS NULL) RETURNING name',
    [name, session.user.id, session.tenantId],
  );
  if (!updated.rows[0]) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  await pool.query('UPDATE organization_membership SET display_name=$1 WHERE user_id=$2', [name, session.user.id]);
  return NextResponse.json({ name: updated.rows[0].name }, { headers: { "Cache-Control": "private, no-store" } });
}
