import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { FineError, getFineCompanyPaidMarkerEvidenceContent } from "@/lib/fine-dossiers";

type Props = { params: Promise<{ id: string; evidenceId: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id, evidenceId } = await params;
  if (!uuid.test(id) || !uuid.test(evidenceId)) return NextResponse.json({ error: "Company-paid marker proof not found." }, { status: 404 });
  try {
    return await getFineCompanyPaidMarkerEvidenceContent(
      session.tenantId,
      id,
      evidenceId,
      session.role,
      new URL(request.url).searchParams.get("download") === "1",
    );
  } catch (error) {
    if (error instanceof FineError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not open company-paid marker proof." }, { status: 500 });
  }
}
