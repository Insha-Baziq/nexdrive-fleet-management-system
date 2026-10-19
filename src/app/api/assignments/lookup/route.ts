import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { lookupVehicleAssignment } from "@/lib/assignments";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export async function GET(request: Request) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const vehicleId = params.get("vehicleId") ?? "";
  const at = params.get("at") ?? "";
  const calendarDate = at.slice(0, 10);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(calendarDate)
    && Number.isFinite(Date.parse(`${calendarDate}T00:00:00Z`))
    && new Date(`${calendarDate}T00:00:00Z`).toISOString().slice(0, 10) === calendarDate;
  if (!uuid.test(vehicleId) || !validDate || !timestamp.test(at) || !Number.isFinite(Date.parse(at))) {
    return NextResponse.json({ error: "Select a vehicle and enter a valid date and time." }, { status: 400 });
  }

  const result = await lookupVehicleAssignment(session.tenantId, vehicleId, new Date(at).toISOString());
  if (!result) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  return NextResponse.json({ ...result, at: new Date(at).toISOString() }, { headers: { "cache-control": "no-store" } });
}
