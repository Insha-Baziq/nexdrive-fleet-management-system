import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { listAnomalies } from "@/lib/anomalies";

export async function GET() {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  return NextResponse.json({ anomalies: await listAnomalies(session.tenantId) });
}
