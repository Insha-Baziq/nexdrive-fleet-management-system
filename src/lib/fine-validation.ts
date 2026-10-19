import {
  getVehicleDocumentExtension,
  MAX_VEHICLE_DOCUMENT_BYTES,
  validateVehicleDocumentContent,
  type VehicleDocumentExtension,
} from "@/lib/vehicle-documents";

export const FINE_STATUSES = ["open", "closed", "cancelled"] as const;
export const FINE_TYPES = ["company", "driver"] as const;
export type FineStatus = (typeof FINE_STATUSES)[number];
export type FineType = (typeof FINE_TYPES)[number];

export type ParsedFineInput = {
  vehicleId: string;
  reference: string;
  fineType: FineType;
  infractionAt: string;
  paymentDeadline: string;
  description: string | null;
  amount: string | null;
  fileName: string;
  extension: VehicleDocumentExtension;
  fileBytes: Buffer;
};

export type FineInputError = { ok: false; error: string };
export type FineInputResult = { ok: true; value: ParsedFineInput } | FineInputError;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDateParts(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validDeadline(value: string) {
  const parts = datePattern.exec(value);
  return Boolean(parts && validDateParts(Number(parts[1]), Number(parts[2]), Number(parts[3])));
}

function validInfractionAt(value: string) {
  const parts = dateTimePattern.exec(value);
  if (!parts) return false;
  const [, year, month, day, hour, minute, second = "0", zone] = parts;
  if (!validDateParts(Number(year), Number(month), Number(day))
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
    || !Number.isFinite(Date.parse(value))) return false;
  if (zone !== "Z") {
    const offset = zone.slice(1).split(":").map(Number);
    if (offset[0] > 14 || offset[1] > 59 || (offset[0] === 14 && offset[1] !== 0)) return false;
  }
  return true;
}

function safeFileName(value: string) {
  return value.trim().replaceAll("\\", "/").split("/").at(-1)?.trim() ?? "";
}

export async function parseFineForm(form: FormData): Promise<FineInputResult> {
  const allowedFields = new Set(["vehicleId", "reference", "fineType", "infractionAt", "paymentDeadline", "description", "amount", "evidence"]);
  for (const key of form.keys()) if (!allowedFields.has(key)) return { ok: false, error: "Invalid request fields." };

  const vehicleId = form.get("vehicleId");
  const referenceRaw = form.get("reference");
  const fineType = form.get("fineType");
  const infractionAt = form.get("infractionAt");
  const paymentDeadline = form.get("paymentDeadline");
  const descriptionRaw = form.get("description");
  const amountRaw = form.get("amount");
  const evidence = form.get("evidence");
  if (typeof vehicleId !== "string" || !uuidPattern.test(vehicleId)
    || typeof referenceRaw !== "string" || typeof fineType !== "string"
    || typeof infractionAt !== "string" || typeof paymentDeadline !== "string"
    || (descriptionRaw !== null && typeof descriptionRaw !== "string")
    || (amountRaw !== null && typeof amountRaw !== "string")
    || !(evidence instanceof File)) return { ok: false, error: "Complete the fine details and attach supporting evidence." };

  const reference = referenceRaw.trim();
  const description = typeof descriptionRaw === "string" ? descriptionRaw.trim() : "";
  const amountValue = typeof amountRaw === "string" ? amountRaw.trim() : "";
  const fileName = safeFileName(evidence.name);
  const extension = getVehicleDocumentExtension(fileName);
  if (reference.length < 1 || reference.length > 100 || /[\u0000-\u001f\u007f]/.test(reference)
    || !FINE_TYPES.includes(fineType as FineType)
    || !validInfractionAt(infractionAt) || !validDeadline(paymentDeadline)
    || description.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)
    || (amountValue !== "" && !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(amountValue))
    || !extension || fileName.length < 1 || fileName.length > 180 || /[\u0000-\u001f\u007f]/.test(fileName)
    || !Number.isSafeInteger(evidence.size) || evidence.size < 1 || evidence.size > MAX_VEHICLE_DOCUMENT_BYTES) {
    return { ok: false, error: "Enter valid fine details and attach a supported file up to 15 MB." };
  }

  const fileBytes = Buffer.from(await evidence.arrayBuffer());
  if (fileBytes.length !== evidence.size || !(await validateVehicleDocumentContent(fileBytes, extension))) {
    return { ok: false, error: "The evidence file does not match a supported type or size." };
  }
  return {
    ok: true,
    value: {
      vehicleId,
      reference,
      fineType: fineType as FineType,
      infractionAt,
      paymentDeadline,
      description: description || null,
      amount: amountValue || null,
      fileName,
      extension,
      fileBytes,
    },
  };
}

export function parseFineStatus(value: unknown): FineStatus | null {
  return typeof value === "string" && FINE_STATUSES.includes(value as FineStatus) ? value as FineStatus : null;
}
