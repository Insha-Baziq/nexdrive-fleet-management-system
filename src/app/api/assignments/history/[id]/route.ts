import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { AssignmentError, correctAssignment, getAssignmentJournalEntry } from "@/lib/assignments";
import { parseAssignmentCorrectionInput } from "@/lib/assignment-validation";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
  const assignment = await getAssignmentJournalEntry(session.tenantId, id);
  if (!assignment) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
  return NextResponse.json({ assignment });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const parsed = parseAssignmentCorrectionInput(body);
  if (!parsed.ok) return NextResponse.json({ errors: parsed.errors }, { status: 400 });
  try {
    const assignment = await correctAssignment(session.tenantId, session.user.id, id, parsed.value);
    return NextResponse.json({ assignment });
  } catch (error) {
    if (error instanceof AssignmentError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
