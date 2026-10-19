import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { createDriverVehicleMileageReading, LowerMileageWarning, VehicleMileageError } from "@/lib/vehicle-mileage";
import { parseMileageReadingInput } from "@/lib/vehicle-mileage-validation";

export async function POST(request: Request) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  // This endpoint binds the vehicle and driver to the authenticated account's active assignment.
  if (new URL(request.url).searchParams.size > 0) {
    return NextResponse.json({ error: "Do not provide vehicle, driver, or tenant identifiers." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = parseMileageReadingInput(body);
  if (!parsed.ok) return NextResponse.json({ errors: parsed.errors }, { status: 400 });

  try {
    const reading = await createDriverVehicleMileageReading({
      tenantId: session.tenantId,
      userId: session.user.id,
      reading: parsed.value,
    });
    return NextResponse.json({ reading }, { status: 201 });
  } catch (error) {
    if (error instanceof LowerMileageWarning) {
      return NextResponse.json({ error: error.message, warning: {
        type: "lower_mileage", latest: error.latest,
      } }, { status: 409 });
    }
    if (error instanceof VehicleMileageError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
