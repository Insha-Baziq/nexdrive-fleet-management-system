import { NextResponse } from "next/server";
import { AnomalyError, getAnomalyPhotoContent } from "@/lib/anomalies";
import { getOrganizationSession } from "@/lib/organization-session";

type Props = { params: Promise<{ id: string; photoId: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id, photoId } = await params;
  if (!uuid.test(id) || !uuid.test(photoId)) return NextResponse.json({ error: "Anomaly photo not found." }, { status: 404 });
  try {
    return await getAnomalyPhotoContent(session.tenantId, id, photoId);
  } catch (error) {
    if (error instanceof AnomalyError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Anomaly photo is unavailable." }, { status: 500 });
  }
}
