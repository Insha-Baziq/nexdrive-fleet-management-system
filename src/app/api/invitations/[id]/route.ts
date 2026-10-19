import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { revokeInvitation } from "@/lib/onboarding";
import { onboardingFailure, sameOrigin } from "@/lib/onboarding-http";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    await revokeInvitation(session.tenantId, session.user.id, (await params).id);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return onboardingFailure(error); }
}
