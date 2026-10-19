import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { ClaimError, createClaim, listClaims } from "@/lib/claim-dossiers";
import { parseClaimForm } from "@/lib/claim-validation";

function errorResponse(error: unknown) {
  if (error instanceof ClaimError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Could not process the claim." }, { status: 500 });
}

export async function GET() {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    return NextResponse.json({ claims: await listClaims(session.tenantId, session.role) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "manager") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "Invalid request form." }, { status: 400 }); }
  const parsed = await parseClaimForm(form);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const claim = await createClaim({ tenantId: session.tenantId, userId: session.user.id, role: session.role, claim: parsed.value });
    return NextResponse.json({ claim }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
