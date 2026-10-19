import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { DriverLinkError, getDriver, updateDriver } from "@/lib/drivers";
import { parseDriverInput } from "@/lib/driver-validation";

type Context = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: Context) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "fleet_manager" && session.role !== "manager") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const { id } = await context.params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Driver not found." }, { status: 404 });
  const driver = await getDriver(session.tenantId, id);
  if (!driver) return NextResponse.json({ error: "Driver not found." }, { status: 404 });
  return NextResponse.json({ driver });
}

export async function PATCH(request: Request, context: Context) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "fleet_manager" && session.role !== "manager") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const { id } = await context.params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Driver not found." }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const parsed = parseDriverInput(body);
  if (!parsed.ok) return NextResponse.json({ errors: parsed.errors }, { status: 400 });
  try {
    const driver = await updateDriver(session.tenantId, id, parsed.value);
    if (!driver) return NextResponse.json({ error: "Driver not found." }, { status: 404 });
    return NextResponse.json({ driver });
  } catch (error) {
    if (error instanceof DriverLinkError) return NextResponse.json({ errors: { userId: error.message } }, { status: 400 });
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      return NextResponse.json({ errors: { userId: "This account is already linked to a driver." } }, { status: 409 });
    }
    throw error;
  }
}
