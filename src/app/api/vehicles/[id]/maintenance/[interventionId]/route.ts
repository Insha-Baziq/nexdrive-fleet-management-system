import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { cancelVehicleMaintenance, MaintenanceError } from "@/lib/maintenance";
import { parseMaintenanceCancellation } from "@/lib/maintenance-validation";
import { getRecordArchiveState } from "@/lib/record-archive";

type Props = { params: Promise<{ id: string; interventionId: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const writers = ["administrator", "fleet_manager"];

export async function PATCH(request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!writers.includes(session.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id: vehicleId, interventionId } = await params;
  if (!uuid.test(vehicleId) || !uuid.test(interventionId)) return NextResponse.json({ error: "Intervention not found." }, { status: 404 });
  const recordState = await getRecordArchiveState(session.tenantId, vehicleId, "vehicle");
  if (recordState === "missing") return NextResponse.json({ error: "Intervention not found." }, { status: 404 });
  if (recordState === "archived") return NextResponse.json({ error: "Restore this vehicle before changing maintenance records." }, { status: 409 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Enter a cancellation reason." }, { status: 400 }); }
  const parsed = parseMaintenanceCancellation(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const intervention = await cancelVehicleMaintenance({
      tenantId: session.tenantId,
      vehicleId,
      interventionId,
      userId: session.user.id,
      role: session.role,
      reason: parsed.reason,
    });
    return NextResponse.json({ intervention });
  } catch (error) {
    if (error instanceof MaintenanceError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not cancel this intervention." }, { status: 500 });
  }
}
