import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { listAssignmentJournal } from "@/lib/assignments";

export async function GET() {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const assignments = await listAssignmentJournal(session.tenantId);
  return NextResponse.json({ assignments });
}
