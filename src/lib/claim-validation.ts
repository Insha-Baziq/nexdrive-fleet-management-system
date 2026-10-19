import {
  getVehicleDocumentExtension,
  MAX_VEHICLE_DOCUMENT_BYTES,
  validateVehicleDocumentContent,
  type VehicleDocumentExtension,
} from "@/lib/vehicle-documents";

export type ParsedClaimInput = {
  vehicleId: string;
  incidentDate: string;
  description: string;
  fileName: string;
  extension: VehicleDocumentExtension;
  fileBytes: Buffer;
};

export type ClaimInputResult = { ok: true; value: ParsedClaimInput } | { ok: false; error: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(value: string) {
  const parts = datePattern.exec(value);
  if (!parts) return false;
  const [, year, month, day] = parts.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function safeFileName(value: string) {
  return value.trim().replaceAll("\\", "/").split("/").at(-1)?.trim() ?? "";
}

export async function parseClaimForm(form: FormData): Promise<ClaimInputResult> {
  const allowedFields = new Set(["vehicleId", "incidentDate", "description", "initialEvidence"]);
  for (const key of form.keys()) if (!allowedFields.has(key)) return { ok: false, error: "Invalid request fields." };

  const vehicleId = form.get("vehicleId");
  const incidentDate = form.get("incidentDate");
  const descriptionRaw = form.get("description");
  const file = form.get("initialEvidence");
  if (typeof vehicleId !== "string" || !uuidPattern.test(vehicleId)
    || typeof incidentDate !== "string" || typeof descriptionRaw !== "string"
    || !(file instanceof File)) {
    return { ok: false, error: "Complete the claim details and attach initial evidence." };
  }

  const description = descriptionRaw.trim();
  const fileName = safeFileName(file.name);
  const extension = getVehicleDocumentExtension(fileName);
  if (!validDate(incidentDate) || description.length < 1 || description.length > 4000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)
    || !extension || fileName.length < 1 || fileName.length > 180 || /[\u0000-\u001f\u007f]/.test(fileName)
    || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_VEHICLE_DOCUMENT_BYTES) {
    return { ok: false, error: "Enter a valid incident date and description, and attach a supported file up to 15 MB." };
  }

  const fileBytes = Buffer.from(await file.arrayBuffer());
  if (fileBytes.length !== file.size || !(await validateVehicleDocumentContent(fileBytes, extension))) {
    return { ok: false, error: "The initial evidence does not match a supported type or size." };
  }
  return { ok: true, value: { vehicleId, incidentDate, description, fileName, extension, fileBytes } };
}
