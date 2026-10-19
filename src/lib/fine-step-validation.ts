import {
  getVehicleDocumentExtension,
  MAX_VEHICLE_DOCUMENT_BYTES,
  validateVehicleDocumentContent,
  type VehicleDocumentExtension,
} from "@/lib/vehicle-documents";

export const FINE_STEP_TYPES = ["designation", "contestation", "response", "payment"] as const;
export type FineStepType = (typeof FINE_STEP_TYPES)[number];

export type ParsedFineStep = {
  stepType: FineStepType;
  stepDate: string;
  note: string | null;
  responsePositive: boolean | null;
  designatedDriverId: string | null;
  fileName: string;
  extension: VehicleDocumentExtension;
  fileBytes: Buffer;
};

export type FineStepFormResult =
  | { ok: true; value: ParsedFineStep }
  | { ok: false; error: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const allowedFields = new Set(["stepType", "stepDate", "note", "responsePositive", "designatedDriverId", "evidence"]);

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

export async function parseFineStepForm(form: FormData): Promise<FineStepFormResult> {
  for (const key of form.keys()) if (!allowedFields.has(key)) return { ok: false, error: "Invalid request fields." };
  for (const key of allowedFields) if (form.getAll(key).length > 1) return { ok: false, error: "Invalid duplicate request fields." };

  const stepType = form.get("stepType");
  const stepDate = form.get("stepDate");
  const noteRaw = form.get("note");
  const positiveRaw = form.get("responsePositive");
  const driverRaw = form.get("designatedDriverId");
  const file = form.get("evidence");
  if (typeof stepType !== "string" || !FINE_STEP_TYPES.includes(stepType as FineStepType)
    || typeof stepDate !== "string" || (noteRaw !== null && typeof noteRaw !== "string")
    || (positiveRaw !== null && typeof positiveRaw !== "string")
    || (driverRaw !== null && typeof driverRaw !== "string")
    || !(file instanceof File)) {
    return { ok: false, error: "Choose a valid step and date, then attach required proof." };
  }

  const type = stepType as FineStepType;
  const note = typeof noteRaw === "string" ? noteRaw.trim() : "";
  const driverId = typeof driverRaw === "string" ? driverRaw.trim() : "";
  if (!validDate(stepDate) || note.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)) {
    return { ok: false, error: "Enter a valid date and a note of at most 2,000 characters." };
  }

  let responsePositive: boolean | null = null;
  if (type === "response") {
    if (positiveRaw !== "true" && positiveRaw !== "false") return { ok: false, error: "Choose a positive or negative response." };
    responsePositive = positiveRaw === "true";
  } else if (positiveRaw !== null) {
    return { ok: false, error: "Response outcome is only valid for a response step." };
  }

  let designatedDriverId: string | null = null;
  if (type === "designation") {
    if (!uuidPattern.test(driverId)) return { ok: false, error: "Choose a valid designated driver." };
    designatedDriverId = driverId;
  } else if (driverId) {
    return { ok: false, error: "A designated driver is only valid for a designation step." };
  }

  const fileName = safeFileName(file.name);
  const extension = getVehicleDocumentExtension(fileName);
  if (!extension || fileName.length < 1 || fileName.length > 180 || /[\u0000-\u001f\u007f]/.test(fileName)
    || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_VEHICLE_DOCUMENT_BYTES) {
    return { ok: false, error: "Attach PDF, PNG, JPG, JPEG, or DOCX proof up to 15 MB." };
  }
  const fileBytes = Buffer.from(await file.arrayBuffer());
  if (fileBytes.length !== file.size || !(await validateVehicleDocumentContent(fileBytes, extension))) {
    return { ok: false, error: "The proof does not match a supported file type or size." };
  }

  return { ok: true, value: {
    stepType: type,
    stepDate,
    note: note || null,
    responsePositive,
    designatedDriverId,
    fileName,
    extension,
    fileBytes,
  } };
}
