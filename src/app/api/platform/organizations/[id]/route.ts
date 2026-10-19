import { NextResponse } from "next/server";
import { getPlatformAccess, deletePlatformOrganization, PlatformAdministrationError } from "@/lib/platform-administration";
import { jsonBody, sameOrigin } from "@/lib/onboarding-http";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const access = await getPlatformAccess(request.headers);
  if (access.status !== 200) {
    return NextResponse.json({ error: access.status === 401 ? "Sign in required." : "Platform access required." }, { status: access.status });
  }

  try {
    const body = await jsonBody(request) as { organizationName?: unknown };
    if (typeof body.organizationName !== "string" || body.organizationName.length > 200) {
      return NextResponse.json({ error: "Enter the exact organization name to confirm deletion." }, { status: 400 });
    }
    const { id } = await params;
    const organization = await deletePlatformOrganization(id, body.organizationName);
    return NextResponse.json({ success: true, organization }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PlatformAdministrationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Platform administration is temporarily unavailable." }, { status: 500 });
  }
}
