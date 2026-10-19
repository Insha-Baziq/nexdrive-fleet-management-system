import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { listOrganizationUsers } from "@/lib/organization-users";

export async function GET() {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  return NextResponse.json(
    { users: await listOrganizationUsers(session.tenantId) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
