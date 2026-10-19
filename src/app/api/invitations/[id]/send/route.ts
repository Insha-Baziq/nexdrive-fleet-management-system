import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { sendInvitationEmail } from "@/lib/onboarding";
import { jsonBody, onboardingFailure, sameOrigin } from "@/lib/onboarding-http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    const body = await jsonBody(request) as { code?: unknown };
    const result = await sendInvitationEmail(session.tenantId, (await params).id, undefined, body?.code);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return onboardingFailure(error); }
}
