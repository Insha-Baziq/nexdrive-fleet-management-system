import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { issueInvitation, listInvitations, listInvitableDrivers } from "@/lib/onboarding";
import { jsonBody, onboardingFailure, sameOrigin } from "@/lib/onboarding-http";

export async function GET() {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const [invitations, invitableDrivers] = await Promise.all([
    listInvitations(session.tenantId),
    listInvitableDrivers(session.tenantId),
  ]);
  return NextResponse.json({ invitations, invitableDrivers }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    const result = await issueInvitation(session.tenantId, session.user.id, await jsonBody(request));
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return onboardingFailure(error); }
}
