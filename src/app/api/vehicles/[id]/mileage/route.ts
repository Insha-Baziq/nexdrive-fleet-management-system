import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { getVehicle } from "@/lib/vehicles";
import { getRecordArchiveState } from "@/lib/record-archive";
import { createVehicleMileageReading, listVehicleMileageReadings, VehicleMileageError } from "@/lib/vehicle-mileage";
import { parseMileageReadingInput } from "@/lib/vehicle-mileage-validation";

type Context = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canManage = (role: string) => role === "administrator" || role === "fleet_manager";

export async function GET(_request: Request, context: Context) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { id } = await context.params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  if (!await getVehicle(session.tenantId, id)) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  return NextResponse.json({ readings: await listVehicleMileageReadings(session.tenantId, id) });
}

export async function POST(request: Request, context: Context) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!canManage(session.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { id } = await context.params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  const recordState = await getRecordArchiveState(session.tenantId, id, "vehicle");
  if (recordState === "missing") return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  if (recordState === "archived") return NextResponse.json({ error: "Restore this vehicle before adding mileage readings." }, { status: 409 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = parseMileageReadingInput(body);
  if (!parsed.ok) return NextResponse.json({ errors: parsed.errors }, { status: 400 });
  try {
    const reading = await createVehicleMileageReading({
      tenantId: session.tenantId,
      vehicleId: id,
      userId: session.user.id,
      reading: parsed.value,
    });
    return NextResponse.json({ reading }, { status: 201 });
  } catch (error) {
    if (error instanceof VehicleMileageError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
