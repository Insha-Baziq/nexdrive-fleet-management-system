import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { getRecordArchiveState } from "@/lib/record-archive";
import {
  createDriverDocumentUpload,
  DRIVER_DOCUMENT_CATEGORIES,
  DriverDocumentError,
  listDriverDocuments,
} from "@/lib/driver-documents";
import { getVehicleDocumentExtension, MAX_VEHICLE_DOCUMENT_BYTES } from "@/lib/vehicle-documents";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedFields = new Set(["name", "category", "expiryDate", "fileName", "fileSize"]);
const staffRoles = ["administrator", "fleet_manager", "manager"];

function errorResponse(error: unknown) {
  if (error instanceof DriverDocumentError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Could not process driver document." }, { status: 500 });
}

export async function POST(request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!staffRoles.includes(session.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id: driverId } = await params;
  if (!uuid.test(driverId)) return NextResponse.json({ error: "Driver not found." }, { status: 404 });
  const recordState = await getRecordArchiveState(session.tenantId, driverId, "driver");
  if (recordState === "missing") return NextResponse.json({ error: "Driver not found." }, { status: 404 });
  if (recordState === "archived") return NextResponse.json({ error: "Restore this driver before adding documents." }, { status: 409 });
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
  const expiryDate = input.expiryDate === undefined ? null : input.expiryDate;
  const fileName = typeof input.fileName === "string" ? input.fileName.trim().split(/[\\/]/).at(-1) ?? "" : "";
  const fileSize = input.fileSize;
  const extension = getVehicleDocumentExtension(fileName);
  const validDate = expiryDate === null || (
    typeof expiryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(expiryDate)
    && !Number.isNaN(Date.parse(`${expiryDate}T00:00:00Z`))
    && new Date(`${expiryDate}T00:00:00Z`).toISOString().slice(0, 10) === expiryDate
  );
  const expiryRequired = category === "driving_licence" || category === "identity_document";
  if (expiryRequired && expiryDate === null) {
    return NextResponse.json({ error: "An expiry date is required for this document category." }, { status: 400 });
  }
  if (name.length < 1 || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)
    || typeof category !== "string" || !DRIVER_DOCUMENT_CATEGORIES.includes(category as typeof DRIVER_DOCUMENT_CATEGORIES[number])
    || !validDate || !extension || fileName.length < 1 || fileName.length > 180
    || /[\u0000-\u001f\u007f]/.test(fileName)
    || !Number.isSafeInteger(fileSize) || Number(fileSize) < 1 || Number(fileSize) > MAX_VEHICLE_DOCUMENT_BYTES) {
    return NextResponse.json({ error: "Enter valid document details and choose a supported file up to 15 MB." }, { status: 400 });
  }
  try {
    const upload = await createDriverDocumentUpload({
      tenantId: session.tenantId,
      driverId,
      userId: session.user.id,
      role: session.role,
      name,
      category: category as typeof DRIVER_DOCUMENT_CATEGORIES[number],
      expiryDate: expiryDate as string | null,
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
  const { id: driverId } = await params;
  if (!uuid.test(driverId)) return NextResponse.json({ error: "Driver not found." }, { status: 404 });
  try {
    const documents = await listDriverDocuments(session.tenantId, driverId, session.role, session.user.id);
    return NextResponse.json({ documents }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return errorResponse(error);
  }
}
