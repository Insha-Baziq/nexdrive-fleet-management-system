import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { getVehicle, updateVehicle } from "@/lib/vehicles";
import { parseVehicleInput } from "@/lib/vehicle-validation";

type Context = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: Context) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { id } = await context.params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  const vehicle = await getVehicle(session.tenantId, id);
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  return NextResponse.json({ vehicle });
}

export async function PATCH(request: Request, context: Context) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "fleet_manager") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { id } = await context.params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = parseVehicleInput(body);
  if (!parsed.ok) return NextResponse.json({ errors: parsed.errors }, { status: 400 });

  try {
    const vehicle = await updateVehicle(session.tenantId, id, parsed.value);
    if (!vehicle) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
    return NextResponse.json({ vehicle });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      return NextResponse.json({ errors: { registration: "This registration already exists in your organization." } }, { status: 409 });
    }
    throw error;
  }
}
