import { NextResponse } from "next/server";
import { AnomalyError, createAnomaly, getAnomalyPhotoContentType, getAnomalyPhotoExtension, listVehicleAnomalies, validateAnomalyPhotoContent } from "@/lib/anomalies";
import { getOrganizationSession } from "@/lib/organization-session";
import { getRecordArchiveState } from "@/lib/record-archive";
import { MAX_VEHICLE_DOCUMENT_BYTES } from "@/lib/vehicle-documents";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = new Set(["observedDate", "description", "photos"]);

function errorResponse(error: unknown) {
  if (error instanceof AnomalyError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Could not process the anomaly." }, { status: 500 });
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export async function GET(_request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (session.role === "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id: vehicleId } = await params;
  if (!uuid.test(vehicleId)) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  const { pool } = await import("@/lib/db");
  const vehicle = await pool.query("SELECT 1 FROM vehicle WHERE tenant_id = $1 AND id = $2", [session.tenantId, vehicleId]);
  if (!vehicle.rows[0]) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  return NextResponse.json({ anomalies: await listVehicleAnomalies(session.tenantId, vehicleId) });
}

export async function POST(request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (session.role !== "administrator" && session.role !== "fleet_manager") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const { id: vehicleId } = await params;
  if (!uuid.test(vehicleId)) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  const recordState = await getRecordArchiveState(session.tenantId, vehicleId, "vehicle");
  if (recordState === "missing") return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  if (recordState === "archived") return NextResponse.json({ error: "Restore this vehicle before reporting new anomalies." }, { status: 409 });

  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Invalid form data." }, { status: 400 }); }
  if ([...form.keys()].some((key) => !fields.has(key))
    || form.getAll("observedDate").length !== 1 || form.getAll("description").length !== 1) {
    return NextResponse.json({ error: "Invalid form fields." }, { status: 400 });
  }
  const observedDate = form.get("observedDate");
  const rawDescription = form.get("description");
  const candidates = form.getAll("photos");
  if (typeof observedDate !== "string" || !validDate(observedDate)
    || typeof rawDescription !== "string" || rawDescription.trim().length < 1 || rawDescription.trim().length > 4000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(rawDescription)
    || candidates.length > 5 || candidates.some((item) => typeof item === "string")) {
    return NextResponse.json({ error: "Enter a valid observed date and description, and choose up to 5 photos." }, { status: 400 });
  }
  const files = candidates.filter((item): item is File => typeof item !== "string" && item.size > 0);
  if (candidates.length !== files.length) return NextResponse.json({ error: "Remove empty photo selections." }, { status: 400 });
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_VEHICLE_DOCUMENT_BYTES) {
    return NextResponse.json({ error: "Choose photos with a combined size up to 15 MB." }, { status: 400 });
  }

  const photos = [];
  for (const file of files) {
    const fileName = file.name.trim().split(/[\\/]/).at(-1) ?? "";
    const extension = getAnomalyPhotoExtension(fileName);
    if (!extension || fileName.length < 1 || fileName.length > 180 || /[\u0000-\u001f\u007f]/.test(fileName)
      || file.size < 1 || file.size > MAX_VEHICLE_DOCUMENT_BYTES
      || (file.type && file.type !== getAnomalyPhotoContentType(extension))) {
      return NextResponse.json({ error: "Photos must be PNG or JPEG images and fit within the 15 MB total limit." }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!validateAnomalyPhotoContent(bytes, extension)) {
      return NextResponse.json({ error: "A selected photo does not match its image type." }, { status: 400 });
    }
    photos.push({ fileName, extension, bytes });
  }

  try {
    const anomaly = await createAnomaly({
      tenantId: session.tenantId,
      vehicleId,
      userId: session.user.id,
      observedDate,
      description: rawDescription.trim(),
      photos,
    });
    return NextResponse.json({ anomaly }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
