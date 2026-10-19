import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { RecordArchiveError, restoreRecord } from "@/lib/record-archive";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "fleet_manager") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  try {
    const vehicle = await restoreRecord(session.tenantId, id, "vehicle");
    return NextResponse.json({ vehicle });
  } catch (error) {
    if (error instanceof RecordArchiveError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
