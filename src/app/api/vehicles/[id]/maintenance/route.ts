import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { getRecordArchiveState } from "@/lib/record-archive";
import { createVehicleMaintenance, listVehicleMaintenance, MaintenanceError } from "@/lib/maintenance";
import { parseMaintenanceForm } from "@/lib/maintenance-validation";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const readers = ["administrator", "fleet_manager", "manager"];
const writers = ["administrator", "fleet_manager"];

function errorResponse(error: unknown) {
  if (error instanceof MaintenanceError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Could not process vehicle maintenance." }, { status: 500 });
}

export async function GET(_request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!readers.includes(session.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id: vehicleId } = await params;
  if (!uuid.test(vehicleId)) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  try {
    return NextResponse.json({ interventions: await listVehicleMaintenance(session.tenantId, vehicleId, session.role) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!writers.includes(session.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id: vehicleId } = await params;
  if (!uuid.test(vehicleId)) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  const recordState = await getRecordArchiveState(session.tenantId, vehicleId, "vehicle");
  if (recordState === "missing") return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  if (recordState === "archived") return NextResponse.json({ error: "Restore this vehicle before adding maintenance records." }, { status: 409 });
  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "Invalid intervention form." }, { status: 400 }); }
  const parsed = await parseMaintenanceForm(form);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const intervention = await createVehicleMaintenance({
      tenantId: session.tenantId,
      vehicleId,
      userId: session.user.id,
      role: session.role,
      form: parsed.value,
    });
    return NextResponse.json({ intervention }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
