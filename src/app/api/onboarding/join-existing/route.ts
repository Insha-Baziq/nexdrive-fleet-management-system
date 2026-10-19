import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { joinWithExistingAccount } from "@/lib/onboarding";
import { selectOrganization } from "@/lib/organization-session";
import { jsonBody, onboardingFailure, sameOrigin } from "@/lib/onboarding-http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    const body = await jsonBody(request) as { code?: unknown };
    const result = await joinWithExistingAccount(
      session.user.id, session.user.email, session.user.tenantId, body?.code,
    );
    await selectOrganization(session.session.id, session.user.id, result.tenantId);
    return NextResponse.json(result);
  } catch (error) { return onboardingFailure(error); }
}
