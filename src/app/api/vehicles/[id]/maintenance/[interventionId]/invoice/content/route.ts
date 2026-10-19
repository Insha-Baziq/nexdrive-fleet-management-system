import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { getMaintenanceInvoiceContent, MaintenanceError } from "@/lib/maintenance";

type Props = { params: Promise<{ id: string; interventionId: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const readers = ["administrator", "fleet_manager", "manager"];

export async function GET(request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!readers.includes(session.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id: vehicleId, interventionId } = await params;
  if (!uuid.test(vehicleId) || !uuid.test(interventionId)) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  try {
    return await getMaintenanceInvoiceContent(
      session.tenantId,
      vehicleId,
      interventionId,
      session.role,
      new URL(request.url).searchParams.get("download") === "1",
    );
  } catch (error) {
    if (error instanceof MaintenanceError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not open the private invoice." }, { status: 500 });
  }
}
