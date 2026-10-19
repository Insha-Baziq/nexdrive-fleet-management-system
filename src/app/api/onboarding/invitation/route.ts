import { NextResponse } from "next/server";
import { jsonBody, onboardingFailure, sameOrigin } from "@/lib/onboarding-http";
import { previewInvitation } from "@/lib/onboarding";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const body = await jsonBody(request) as { code?: unknown };
    return NextResponse.json(await previewInvitation(body?.code));
  } catch (error) { return onboardingFailure(error); }
}
