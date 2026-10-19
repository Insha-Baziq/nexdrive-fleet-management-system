import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { FineError, getFine, updateFineStatus } from "@/lib/fine-dossiers";
import { parseFineStatus } from "@/lib/fine-validation";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(error: unknown) {
  if (error instanceof FineError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Could not process the fine record." }, { status: 500 });
}

export async function GET(_request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Fine not found." }, { status: 404 });
  try {
    return NextResponse.json({ fine: await getFine(session.tenantId, id, session.role) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "manager") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Fine not found." }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== 1 || !Object.hasOwn(body, "status")) {
    return NextResponse.json({ error: "Only the fine status can be changed." }, { status: 400 });
  }
  const status = parseFineStatus((body as Record<string, unknown>).status);
  if (!status) return NextResponse.json({ error: "Choose a valid status." }, { status: 400 });
  try {
    return NextResponse.json({ fine: await updateFineStatus(session.tenantId, id, session.role, status) });
  } catch (error) {
    return errorResponse(error);
  }
}
