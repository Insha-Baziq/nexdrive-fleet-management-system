import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { createFine, FineError, listFines } from "@/lib/fine-dossiers";
import { parseFineForm } from "@/lib/fine-validation";

function errorResponse(error: unknown) {
  if (error instanceof FineError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
    return NextResponse.json({ error: "A fine with this reference already exists in your organization." }, { status: 409 });
  }
  return NextResponse.json({ error: "Could not process the fine record." }, { status: 500 });
}

export async function GET() {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    return NextResponse.json({ fines: await listFines(session.tenantId, session.role) });
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
  const parsed = await parseFineForm(form);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const fine = await createFine({ tenantId: session.tenantId, userId: session.user.id, role: session.role, fine: parsed.value });
    return NextResponse.json({ fine }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
