import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { VehicleMileageError, cancelVehicleMileageReading } from "@/lib/vehicle-mileage";
import { parseMileageCancellationReason } from "@/lib/vehicle-mileage-validation";
import { getRecordArchiveState } from "@/lib/record-archive";

type Context = { params: Promise<{ id: string; readingId: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canManage = (role: string) => role === "administrator" || role === "fleet_manager";

export async function POST(request: Request, context: Context) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!canManage(session.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { id, readingId } = await context.params;
  if (!uuid.test(id) || !uuid.test(readingId)) return NextResponse.json({ error: "Mileage reading not found." }, { status: 404 });
  const recordState = await getRecordArchiveState(session.tenantId, id, "vehicle");
  if (recordState === "missing") return NextResponse.json({ error: "Mileage reading not found." }, { status: 404 });
  if (recordState === "archived") return NextResponse.json({ error: "Restore this vehicle before changing mileage records." }, { status: 409 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = parseMileageCancellationReason(body);
  if (!parsed.ok) return NextResponse.json({ errors: parsed.errors }, { status: 400 });
  try {
    const reading = await cancelVehicleMileageReading({
      tenantId: session.tenantId,
      vehicleId: id,
      readingId,
      userId: session.user.id,
      reason: parsed.value,
    });
    return NextResponse.json({ reading });
  } catch (error) {
    if (error instanceof VehicleMileageError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
