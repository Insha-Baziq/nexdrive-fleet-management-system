import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { getRecordArchiveState } from "@/lib/record-archive";
import { pool } from "@/lib/db";
import { createVehicleInspection, listVehicleInspections, VehicleInspectionError } from "@/lib/vehicle-inspections";
import { validateVehicleInspectionInput } from "@/lib/vehicle-inspection-validation";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(error: unknown) {
  if (error instanceof VehicleInspectionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Could not process the inspection record." }, { status: 500 });
}

export async function GET(_request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id: vehicleId } = await params;
  if (!uuid.test(vehicleId)) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  const vehicle = await pool.query("SELECT 1 FROM vehicle WHERE tenant_id = $1 AND id = $2", [session.tenantId, vehicleId]);
  if (!vehicle.rows[0]) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  try {
    return NextResponse.json({ inspections: await listVehicleInspections(session.tenantId, vehicleId) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "fleet_manager") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const { id: vehicleId } = await params;
  if (!uuid.test(vehicleId)) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const inspection = validateVehicleInspectionInput(raw);
  if (!inspection) {
    return NextResponse.json({ error: "Enter a valid technical due date and optional emissions due date." }, { status: 400 });
  }
  const archiveState = await getRecordArchiveState(session.tenantId, vehicleId, "vehicle");
  if (archiveState === "missing") return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  if (archiveState === "archived") return NextResponse.json({ error: "Restore this vehicle before adding inspections." }, { status: 409 });
  try {
    const result = await createVehicleInspection({
      tenantId: session.tenantId,
      vehicleId,
      userId: session.user.id,
      inspection,
    });
    return NextResponse.json({ inspection: result }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
