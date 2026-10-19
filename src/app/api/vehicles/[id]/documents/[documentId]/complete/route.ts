import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { getRecordArchiveState } from "@/lib/record-archive";
import { finishVehicleDocumentUpload, VehicleDocumentError } from "@/lib/vehicle-documents";

type Props = { params: Promise<{ id: string; documentId: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "fleet_manager") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const { id: vehicleId, documentId } = await params;
  if (!uuid.test(vehicleId) || !uuid.test(documentId)) {
    return NextResponse.json({ error: "Upload not found or expired." }, { status: 404 });
  }
  const recordState = await getRecordArchiveState(session.tenantId, vehicleId, "vehicle");
  if (recordState === "missing") return NextResponse.json({ error: "Upload not found or expired." }, { status: 404 });
  if (recordState === "archived") return NextResponse.json({ error: "Restore this vehicle before completing document uploads." }, { status: 409 });
  try {
    await finishVehicleDocumentUpload(session.tenantId, vehicleId, documentId, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof VehicleDocumentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not complete the document upload." }, { status: 500 });
  }
}
