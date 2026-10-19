import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import {
  createFineCompanyPaidMarker,
  FineError,
  getFineCompanyPaidMarkerState,
} from "@/lib/fine-dossiers";
import { parseFineCompanyPaidMarkerForm } from "@/lib/fine-company-paid-validation";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(error: unknown) {
  if (error instanceof FineError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Could not process the company-paid marker." }, { status: 500 });
}

export async function GET(_request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Fine not found." }, { status: 404 });
  try {
    return NextResponse.json(await getFineCompanyPaidMarkerState(session.tenantId, id, session.role));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "manager") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Fine not found." }, { status: 404 });
  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "Invalid request form." }, { status: 400 }); }
  const parsed = await parseFineCompanyPaidMarkerForm(form);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const marker = await createFineCompanyPaidMarker({
      tenantId: session.tenantId,
      fineId: id,
      userId: session.user.id,
      role: session.role,
      marker: parsed.value,
    });
    return NextResponse.json({ marker }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
