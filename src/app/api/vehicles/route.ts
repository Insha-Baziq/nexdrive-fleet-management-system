import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { createVehicle, listVehicles } from "@/lib/vehicles";
import { parseVehicleInput } from "@/lib/vehicle-validation";

export async function GET(request: Request) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const view = new URL(request.url).searchParams.get("view") ?? "active";
  if (view !== "active" && view !== "archived") return NextResponse.json({ error: "Invalid vehicle view." }, { status: 400 });
  if (view === "archived" && session.role !== "administrator" && session.role !== "fleet_manager") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  return NextResponse.json({ vehicles: await listVehicles(session.tenantId, view) });
}

export async function POST(request: Request) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "fleet_manager") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = parseVehicleInput(body);
  if (!parsed.ok) return NextResponse.json({ errors: parsed.errors }, { status: 400 });

  try {
    const vehicle = await createVehicle(session.tenantId, parsed.value);
    return NextResponse.json({ vehicle }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      return NextResponse.json({ errors: { registration: "This registration already exists in your organization." } }, { status: 409 });
    }
    throw error;
  }
}
