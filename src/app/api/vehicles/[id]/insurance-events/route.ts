import { NextResponse } from "next/server";
import { createVehicleInsuranceEvent, getVehicleInsuranceStatus, listVehicleInsuranceEvents, InsuranceEventError } from "@/lib/insurance-events";
import { validateInsuranceEventInput } from "@/lib/insurance-event-validation";
import { getOrganizationSession } from "@/lib/organization-session";
import { pool } from "@/lib/db";
import { getRecordArchiveState } from "@/lib/record-archive";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(error: unknown) {
  if (error instanceof InsuranceEventError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Could not process the insurance event." }, { status: 500 });
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
    const [events, insuranceStatus] = await Promise.all([
      listVehicleInsuranceEvents(session.tenantId, vehicleId),
      getVehicleInsuranceStatus(session.tenantId, vehicleId),
    ]);
    return NextResponse.json({ events, insuranceStatus });
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
  const input = validateInsuranceEventInput(raw);
  if (!input) return NextResponse.json({ error: "Choose a status and enter a valid date and description." }, { status: 400 });
  const recordState = await getRecordArchiveState(session.tenantId, vehicleId, "vehicle");
  if (recordState === "missing") return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  if (recordState === "archived") return NextResponse.json({ error: "Restore this vehicle before adding insurance records." }, { status: 409 });
  try {
    const event = await createVehicleInsuranceEvent({ tenantId: session.tenantId, vehicleId, userId: session.user.id, ...input });
    const insuranceStatus = await getVehicleInsuranceStatus(session.tenantId, vehicleId);
    return NextResponse.json({ event, insuranceStatus }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
