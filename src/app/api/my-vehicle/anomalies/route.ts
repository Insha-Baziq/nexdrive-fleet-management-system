import { NextResponse } from "next/server";
import { AnomalyError, createAnomaly, getAnomalyPhotoContentType, getAnomalyPhotoExtension, validateAnomalyPhotoContent } from "@/lib/anomalies";
import { getDriverWorkspaceVehicle } from "@/lib/drivers";
import { getOrganizationSession } from "@/lib/organization-session";
import { MAX_VEHICLE_DOCUMENT_BYTES } from "@/lib/vehicle-documents";

const fields = new Set(["observedDate", "description", "photos"]);

function errorResponse(error: unknown) {
  if (error instanceof AnomalyError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Could not process the report." }, { status: 500 });
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export async function POST(request: Request) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (session.role !== "driver") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  // Vehicle, driver, and tenant identity always come from the authenticated session and active assignment.
  const search = new URL(request.url).searchParams;
  if ([...search.keys()].length) return NextResponse.json({ error: "Do not provide vehicle or driver identifiers." }, { status: 400 });
  const driver = await getDriverWorkspaceVehicle(session.tenantId, session.user.id);
  if (!driver?.vehicle_id) {
    return NextResponse.json({ error: "A currently assigned vehicle is required to report a problem." }, { status: 409 });
  }

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
      vehicleId: driver.vehicle_id,
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
