import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getPlatformAccess, listPlatformOrganizations, createPlatformOrganization, PlatformAdministrationError } from "@/lib/platform-administration";
import { jsonBody, sameOrigin } from "@/lib/onboarding-http";

export const runtime = "nodejs";

export async function GET() {
  const access = await getPlatformAccess(await headers());
  if (access.status !== 200) {
    return NextResponse.json({ error: access.status === 401 ? "Sign in required." : "Platform access required." }, { status: access.status });
  }
  const organizations = await listPlatformOrganizations();
  return NextResponse.json({ organizations }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const access = await getPlatformAccess(request.headers);
  if (access.status !== 200) {
    return NextResponse.json({ error: access.status === 401 ? "Sign in required." : "Platform access required." }, { status: access.status });
  }

  try {
    const organization = await createPlatformOrganization(await jsonBody(request));
    return NextResponse.json({ organization }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PlatformAdministrationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Platform administration is temporarily unavailable." }, { status: 500 });
  }
}
