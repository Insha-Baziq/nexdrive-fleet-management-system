import { NextResponse } from "next/server";
import { getPlatformAccess } from "@/lib/platform-administration";
import { createPlatformOrganizationUser } from "@/lib/onboarding";
import { jsonBody, onboardingFailure, sameOrigin } from "@/lib/onboarding-http";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const access = await getPlatformAccess(request.headers);
  if (access.status !== 200) {
    return NextResponse.json({ error: access.status === 401 ? "Sign in required." : "Platform access required." }, { status: access.status });
  }

  try {
    const { id } = await params;
    const user = await createPlatformOrganizationUser(id, await jsonBody(request));
    return NextResponse.json({ user }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return onboardingFailure(error);
  }
}
