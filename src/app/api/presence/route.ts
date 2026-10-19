import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getOrganizationSession } from "@/lib/organization-session";
import { sameOrigin } from "@/lib/onboarding-http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  await pool.query(
    'UPDATE organization_membership SET last_seen_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND tenant_id=$2 AND disabled_at IS NULL',
    [session.user.id, session.tenantId],
  );
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
