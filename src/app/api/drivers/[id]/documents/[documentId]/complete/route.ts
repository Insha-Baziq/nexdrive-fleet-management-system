import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { getRecordArchiveState } from "@/lib/record-archive";
import { DriverDocumentError, finishDriverDocumentUpload } from "@/lib/driver-documents";

type Props = { params: Promise<{ id: string; documentId: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id: driverId, documentId } = await params;
  if (!uuid.test(driverId) || !uuid.test(documentId)) {
    return NextResponse.json({ error: "Upload not found or expired." }, { status: 404 });
  }
  const recordState = await getRecordArchiveState(session.tenantId, driverId, "driver");
  if (recordState === "missing") return NextResponse.json({ error: "Upload not found or expired." }, { status: 404 });
  if (recordState === "archived") return NextResponse.json({ error: "Restore this driver before completing document uploads." }, { status: 409 });
  try {
    await finishDriverDocumentUpload(session.tenantId, driverId, documentId, session.user.id, session.role);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof DriverDocumentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not complete the document upload." }, { status: 500 });
  }
}
