import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOrganizationSession } from "@/lib/organization-session";
import { jsonBody, sameOrigin } from "@/lib/onboarding-http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await jsonBody(request).catch(() => null) as { currentPassword?: unknown; newPassword?: unknown } | null;
  if (typeof body?.currentPassword !== "string" || typeof body.newPassword !== "string"
    || body.currentPassword.length < 1 || body.currentPassword.length > 128
    || body.newPassword.length < 8 || body.newPassword.length > 128) {
    return NextResponse.json({ error: "Use your current password and a new password between 8 and 128 characters." }, { status: 400 });
  }
  try {
    const result = await auth.api.changePassword({
      body: { currentPassword: body.currentPassword, newPassword: body.newPassword, revokeOtherSessions: true },
      headers: await headers(),
      returnHeaders: true,
    });
    const responseHeaders = new Headers(result.headers);
    responseHeaders.set("Cache-Control", "private, no-store");
    return NextResponse.json({ changed: true }, { headers: responseHeaders });
  } catch {
    return NextResponse.json({ error: "Current password is incorrect or the new password is invalid." }, { status: 400 });
  }
}
