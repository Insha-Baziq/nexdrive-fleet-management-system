import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { getVehicleDocumentContent, VehicleDocumentError } from "@/lib/vehicle-documents";

type Props = { params: Promise<{ id: string; documentId: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id: vehicleId, documentId } = await params;
  if (!uuid.test(vehicleId) || !uuid.test(documentId)) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  try {
    return await getVehicleDocumentContent(
      session.tenantId,
      vehicleId,
      documentId,
      { id: session.user.id },
      session.role,
    );
  } catch (error) {
    if (error instanceof VehicleDocumentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Document is unavailable." }, { status: 500 });
  }
}
