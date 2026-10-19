import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { createDriver, DriverLinkError, listDrivers } from "@/lib/drivers";
import { parseDriverInput } from "@/lib/driver-validation";

export async function GET(request: Request) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "fleet_manager" && session.role !== "manager") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const view = new URL(request.url).searchParams.get("view") ?? "active";
  if (view !== "active" && view !== "archived") return NextResponse.json({ error: "Invalid driver view." }, { status: 400 });
  return NextResponse.json({ drivers: await listDrivers(session.tenantId, view) });
}

export async function POST(request: Request) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "fleet_manager" && session.role !== "manager") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const parsed = parseDriverInput(body);
  if (!parsed.ok) return NextResponse.json({ errors: parsed.errors }, { status: 400 });
  try {
    const driver = await createDriver(session.tenantId, parsed.value);
    return NextResponse.json({ driver }, { status: 201 });
  } catch (error) {
    if (error instanceof DriverLinkError) return NextResponse.json({ errors: { userId: error.message } }, { status: 400 });
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      return NextResponse.json({ errors: { userId: "This account is already linked to a driver." } }, { status: 409 });
    }
    throw error;
  }
}
