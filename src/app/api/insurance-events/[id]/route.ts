import { NextResponse } from "next/server";
import { cancelVehicleInsuranceEvent, getVehicleInsuranceStatus, InsuranceEventError } from "@/lib/insurance-events";
import { validateInsuranceEventCancellation } from "@/lib/insurance-event-validation";
import { getOrganizationSession } from "@/lib/organization-session";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "fleet_manager") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Insurance event not found." }, { status: 404 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const reason = validateInsuranceEventCancellation(raw);
  if (!reason) return NextResponse.json({ error: "Enter a cancellation reason of up to 1,000 characters." }, { status: 400 });
  try {
    const event = await cancelVehicleInsuranceEvent({ tenantId: session.tenantId, eventId: id, userId: session.user.id, reason });
    const insuranceStatus = await getVehicleInsuranceStatus(session.tenantId, event.vehicle_id);
    return NextResponse.json({ event, insuranceStatus });
  } catch (error) {
    if (error instanceof InsuranceEventError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not cancel the insurance event." }, { status: 500 });
  }
}
