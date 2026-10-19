import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getPlatformAccess } from "@/lib/platform-administration";

export const runtime = "nodejs";

export async function GET() {
  const access = await getPlatformAccess(await headers());
  if (access.status !== 200) {
    return NextResponse.json({ error: access.status === 401 ? "Sign in required." : "Platform access required." }, { status: access.status });
  }
  return NextResponse.json({ authorized: true }, { headers: { "Cache-Control": "private, no-store" } });
}
