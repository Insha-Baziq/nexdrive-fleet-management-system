import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { ClaimError, createClaimStage, listClaimStages } from "@/lib/claim-dossiers";
import { parseClaimStageForm } from "@/lib/claim-stage-validation";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(error: unknown) {
  if (error instanceof ClaimError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Could not process claim stages." }, { status: 500 });
}

async function claimIdFrom(params: Props["params"]) {
  const { id } = await params;
  return uuid.test(id) ? id : null;
}

export async function GET(_request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const claimId = await claimIdFrom(params);
  if (!claimId) return NextResponse.json({ error: "Claim not found." }, { status: 404 });
  try {
    return NextResponse.json({ stages: await listClaimStages(session.tenantId, claimId, session.role) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "manager") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const claimId = await claimIdFrom(params);
  if (!claimId) return NextResponse.json({ error: "Claim not found." }, { status: 404 });
  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "Invalid request form." }, { status: 400 }); }
  const parsed = await parseClaimStageForm(form);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const stage = await createClaimStage(session.tenantId, claimId, session.user.id, session.role, parsed.value);
    return NextResponse.json({ stage }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
