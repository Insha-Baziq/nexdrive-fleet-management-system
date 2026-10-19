import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOrganizationSession, listAccountMemberships, selectOrganization } from "@/lib/organization-session";
import { jsonBody, sameOrigin } from "@/lib/onboarding-http";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const active = await getOrganizationSession();
  return NextResponse.json({ organizations: await listAccountMemberships(session.user.id), activeTenantId: active?.tenantId ?? null },
    { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await jsonBody(request).catch(() => null) as { tenantId?: unknown } | null;
  if (typeof body?.tenantId !== "string" || body.tenantId.length > 100) return NextResponse.json({ error: "Choose an organization." }, { status: 400 });
  if (!await selectOrganization(session.session.id, session.user.id, body.tenantId)) {
    return NextResponse.json({ error: "Organization unavailable." }, { status: 403 });
  }
  return NextResponse.json({ success: true });
}
