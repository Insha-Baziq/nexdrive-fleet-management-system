import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { registerAccount } from "@/lib/onboarding";
import { jsonBody, onboardingFailure, sameOrigin } from "@/lib/onboarding-http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  if (await auth.api.getSession({ headers: request.headers })) return NextResponse.json({ error: "Already signed in." }, { status: 409 });
  try { return NextResponse.json(await registerAccount(await jsonBody(request)), { status: 201 }); }
  catch (error) { return onboardingFailure(error); }
}
