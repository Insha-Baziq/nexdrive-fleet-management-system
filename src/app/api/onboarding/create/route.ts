import { NextResponse } from "next/server";
import { createOrganization } from "@/lib/onboarding";
import { auth } from "@/lib/auth";
import { selectOrganization } from "@/lib/organization-session";
import { jsonBody, onboardingFailure, sameOrigin } from "@/lib/onboarding-http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    const result = await createOrganization(await jsonBody(request), session?.user);
    if (session) await selectOrganization(session.session.id, session.user.id, result.tenantId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return onboardingFailure(error); }
}
