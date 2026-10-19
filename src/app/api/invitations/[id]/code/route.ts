import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { rotateInvitationCode } from "@/lib/onboarding";
import { onboardingFailure } from "@/lib/onboarding-http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    const code = await rotateInvitationCode(session.tenantId, (await params).id);
    return NextResponse.json({ code }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return onboardingFailure(error); }
}
