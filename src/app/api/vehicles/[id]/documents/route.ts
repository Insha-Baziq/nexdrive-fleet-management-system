import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { getRecordArchiveState } from "@/lib/record-archive";
import {
  createVehicleDocumentUpload,
  getVehicleDocumentExtension,
  MAX_VEHICLE_DOCUMENT_BYTES,
  VEHICLE_DOCUMENT_CATEGORIES,
  VehicleDocumentError,
  type VehicleDocumentCategory,
} from "@/lib/vehicle-documents";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedFields = new Set(["name", "category", "expiryDate", "visibleToDriver", "fileName", "fileSize"]);

function errorResponse(error: unknown) {
  if (error instanceof VehicleDocumentError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Could not process vehicle document." }, { status: 500 });
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
  if (recordState === "archived") return NextResponse.json({ error: "Restore this vehicle before adding documents." }, { status: 409 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((field) => !allowedFields.has(field))) {
    return NextResponse.json({ error: "Invalid request fields." }, { status: 400 });
  }
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const category = input.category;
  const expiryDate = input.expiryDate;
  const visibleToDriver = input.visibleToDriver;
  const fileName = typeof input.fileName === "string" ? input.fileName.trim().split(/[\\/]/).at(-1) ?? "" : "";
  const fileSize = input.fileSize;
  const extension = getVehicleDocumentExtension(fileName);
  const validDate = expiryDate === null || (
    typeof expiryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(expiryDate)
    && !Number.isNaN(Date.parse(`${expiryDate}T00:00:00Z`))
    && new Date(`${expiryDate}T00:00:00Z`).toISOString().slice(0, 10) === expiryDate
  );
  if (name.length < 1 || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)
    || typeof category !== "string" || !VEHICLE_DOCUMENT_CATEGORIES.includes(category as VehicleDocumentCategory)
    || !validDate || typeof visibleToDriver !== "boolean"
    || !extension || fileName.length < 1 || fileName.length > 180
    || /[\u0000-\u001f\u007f]/.test(fileName)
    || !Number.isSafeInteger(fileSize) || Number(fileSize) < 1 || Number(fileSize) > MAX_VEHICLE_DOCUMENT_BYTES) {
    return NextResponse.json({ error: "Enter valid document details and choose a supported file up to 15 MB." }, { status: 400 });
  }

  try {
    const upload = await createVehicleDocumentUpload({
      tenantId: session.tenantId,
      vehicleId,
      userId: session.user.id,
      name,
      category: category as VehicleDocumentCategory,
      expiryDate: expiryDate as string | null,
      visibleToDriver,
      fileName,
      fileSize: Number(fileSize),
      extension,
    });
    return NextResponse.json({ upload }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(_request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id: vehicleId } = await params;
  if (!uuid.test(vehicleId)) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  const { pool } = await import("@/lib/db");
  const vehicle = await pool.query("SELECT 1 FROM vehicle WHERE tenant_id = $1 AND id = $2", [session.tenantId, vehicleId]);
  if (!vehicle.rows[0]) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  const { listVehicleDocuments } = await import("@/lib/vehicle-documents");
  try {
    const documents = await listVehicleDocuments(session.tenantId, vehicleId, { id: session.user.id }, session.role);
    return NextResponse.json({ documents });
  } catch (error) {
    return errorResponse(error);
  }
}
