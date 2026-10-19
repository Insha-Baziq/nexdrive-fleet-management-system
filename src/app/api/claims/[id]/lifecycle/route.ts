import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { ClaimError, changeClaimLifecycle } from "@/lib/claim-dossiers";
import { parseClaimLifecycleInput } from "@/lib/claim-stage-validation";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "manager") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Claim not found." }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const parsed = parseClaimLifecycleInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    return NextResponse.json(await changeClaimLifecycle(session.tenantId, id, session.user.id, session.role, parsed.action, parsed.reason));
  } catch (error) {
    if (error instanceof ClaimError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not update the claim status." }, { status: 500 });
  }
}
