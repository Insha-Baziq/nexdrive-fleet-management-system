import { NextResponse } from "next/server";
import { joinWithNewAccount } from "@/lib/onboarding";
import { jsonBody, onboardingFailure, sameOrigin } from "@/lib/onboarding-http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    return NextResponse.json(await joinWithNewAccount(await jsonBody(request)), { status: 201 });
  } catch (error) { return onboardingFailure(error); }
}
