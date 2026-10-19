import { NextResponse } from "next/server";
import { AnomalyError, closeAnomaly, getAnomaly } from "@/lib/anomalies";
import { getOrganizationSession } from "@/lib/organization-session";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(error: unknown) {
  if (error instanceof AnomalyError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Could not process the anomaly." }, { status: 500 });
}

export async function GET(_request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Anomaly not found." }, { status: 404 });
  const anomaly = await getAnomaly(session.tenantId, id);
  if (!anomaly) return NextResponse.json({ error: "Anomaly not found." }, { status: 404 });
  return NextResponse.json({ anomaly });
}

export async function PATCH(request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "fleet_manager") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Anomaly not found." }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["status", "reason"].includes(key))) {
    return NextResponse.json({ error: "Invalid request fields." }, { status: 400 });
  }
  if ((input.status !== "resolved" && input.status !== "cancelled") || typeof input.reason !== "string"
    || input.reason.trim().length < 1 || input.reason.trim().length > 1000 || /[\u0000-\u001f\u007f]/.test(input.reason)) {
    return NextResponse.json({ error: "Choose a valid outcome and enter a reason of up to 1,000 characters." }, { status: 400 });
  }
  try {
    const anomaly = await closeAnomaly({
      tenantId: session.tenantId,
      anomalyId: id,
      userId: session.user.id,
      status: input.status,
      reason: input.reason.trim(),
    });
    return NextResponse.json({ anomaly });
  } catch (error) {
    return errorResponse(error);
  }
}
