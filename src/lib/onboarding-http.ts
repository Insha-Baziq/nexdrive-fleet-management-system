import { NextResponse } from "next/server";
import { OnboardingError } from "@/lib/onboarding";

export function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}

export async function jsonBody(request: Request) {
  try { return await request.json() as unknown; }
  catch { throw new OnboardingError(400, "Invalid JSON."); }
}

export function onboardingFailure(error: unknown) {
  if (error instanceof OnboardingError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Onboarding is temporarily unavailable." }, { status: 500 });
}
