import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { onboardingFailure, sameOrigin } from "@/lib/onboarding-http";
import { sendDriverPasswordResetEmail } from "@/lib/driver-password-reset";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    const result = await sendDriverPasswordResetEmail(
      session.tenantId,
      (await params).id,
      session.user.id,
      request.headers.get("x-forwarded-for"),
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return onboardingFailure(error); }
}
