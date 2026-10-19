import {
  getVehicleDocumentExtension,
  MAX_VEHICLE_DOCUMENT_BYTES,
  validateVehicleDocumentContent,
  type VehicleDocumentExtension,
} from "@/lib/vehicle-documents";

export const CLAIM_STAGE_TYPES = [
  "garage_designated", "expert_scheduled", "expert_completed", "quote_received", "repair_completed",
] as const;
export type ClaimStageType = (typeof CLAIM_STAGE_TYPES)[number];

export type ParsedClaimStage = {
  stepType: ClaimStageType;
  stepDate: string;
  note: string | null;
  fileName: string | null;
  extension: VehicleDocumentExtension | null;
  fileBytes: Buffer | null;
};

export type ClaimStageFormResult = { ok: true; value: ParsedClaimStage } | { ok: false; error: string };
export type ClaimLifecycleAction = "close" | "archive" | "cancel";

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

export async function parseClaimStageForm(form: FormData): Promise<ClaimStageFormResult> {
  const allowedFields = new Set(["stepType", "stepDate", "note", "evidence"]);
  for (const key of form.keys()) if (!allowedFields.has(key)) return { ok: false, error: "Invalid request fields." };
  for (const key of allowedFields) if (form.getAll(key).length > 1) return { ok: false, error: "Invalid duplicate request fields." };

  const stepType = form.get("stepType");
  const stepDate = form.get("stepDate");
  const noteRaw = form.get("note");
  const file = form.get("evidence");
  if (typeof stepType !== "string" || !CLAIM_STAGE_TYPES.includes(stepType as ClaimStageType)
    || typeof stepDate !== "string" || (noteRaw !== null && typeof noteRaw !== "string")
    || (file !== null && !(file instanceof File))) {
    return { ok: false, error: "Choose a valid stage and date." };
  }

  const note = typeof noteRaw === "string" ? noteRaw.trim() : "";
  if (!validDate(stepDate) || note.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)) {
    return { ok: false, error: "Enter a valid date and a note of at most 2,000 characters." };
  }
  if (!(file instanceof File)) return { ok: true, value: { stepType: stepType as ClaimStageType, stepDate, note: note || null, fileName: null, extension: null, fileBytes: null } };

  const fileName = safeFileName(file.name);
  const extension = getVehicleDocumentExtension(fileName);
  if (!extension || fileName.length < 1 || fileName.length > 180 || /[\u0000-\u001f\u007f]/.test(fileName)
    || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_VEHICLE_DOCUMENT_BYTES) {
    return { ok: false, error: "Attach a supported evidence file up to 15 MB." };
  }
  const fileBytes = Buffer.from(await file.arrayBuffer());
  if (fileBytes.length !== file.size || !(await validateVehicleDocumentContent(fileBytes, extension))) {
    return { ok: false, error: "Evidence does not match a supported file type or size." };
  }
  return { ok: true, value: {
    stepType: stepType as ClaimStageType,
    stepDate,
    note: note || null,
    fileName,
    extension,
    fileBytes,
  } };
}

export function parseClaimLifecycleInput(input: unknown): { ok: true; action: ClaimLifecycleAction; reason: string | null } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Invalid request body." };
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["action", "reason"].includes(key))) return { ok: false, error: "Invalid request fields." };
  if (body.action !== "close" && body.action !== "archive" && body.action !== "cancel") return { ok: false, error: "Choose a valid claim action." };
  if (body.reason !== undefined && typeof body.reason !== "string") return { ok: false, error: "Enter a valid reason." };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (body.action === "cancel" && (reason.length < 1 || reason.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason))) {
    return { ok: false, error: "A cancellation reason of 1 to 1,000 characters is required." };
  }
  if (body.action !== "cancel" && reason.length > 1000) return { ok: false, error: "Reason must be at most 1,000 characters." };
  return { ok: true, action: body.action, reason: reason || null };
}
