import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { AssignmentError, createAssignment } from "@/lib/assignments";
import { parseAssignmentInput } from "@/lib/assignment-validation";

export async function POST(request: Request) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "fleet_manager") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const parsed = parseAssignmentInput(body);
  if (!parsed.ok) return NextResponse.json({ errors: parsed.errors }, { status: 400 });
  try {
    const assignment = await createAssignment(session.tenantId, session.user.id, parsed.value);
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    if (error instanceof AssignmentError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
