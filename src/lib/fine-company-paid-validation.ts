import {
  getVehicleDocumentExtension,
  MAX_VEHICLE_DOCUMENT_BYTES,
  validateVehicleDocumentContent,
  type VehicleDocumentExtension,
} from "@/lib/vehicle-documents";

export type ParsedFineCompanyPaidMarker = {
  context: string;
  fileName: string;
  extension: VehicleDocumentExtension;
  fileBytes: Buffer;
};

export type FineCompanyPaidMarkerFormResult =
  | { ok: true; value: ParsedFineCompanyPaidMarker }
  | { ok: false; error: string };

const allowedFields = new Set(["context", "evidence"]);

function safeFileName(value: string) {
  return value.trim().replaceAll("\\", "/").split("/").at(-1)?.trim() ?? "";
}

export async function parseFineCompanyPaidMarkerForm(form: FormData): Promise<FineCompanyPaidMarkerFormResult> {
  for (const key of form.keys()) if (!allowedFields.has(key)) return { ok: false, error: "Invalid request fields." };
  for (const key of allowedFields) if (form.getAll(key).length > 1) return { ok: false, error: "Invalid duplicate request fields." };

  const contextRaw = form.get("context");
  const evidence = form.get("evidence");
  if (typeof contextRaw !== "string" || !(evidence instanceof File)) {
    return { ok: false, error: "Enter context and attach required private proof." };
  }
  const context = contextRaw.trim();
  if (context.length < 1 || context.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(context)) {
    return { ok: false, error: "Enter context of at most 2,000 characters." };
  }

  const fileName = safeFileName(evidence.name);
  const extension = getVehicleDocumentExtension(fileName);
  if (!extension || fileName.length < 1 || fileName.length > 180 || /[\u0000-\u001f\u007f]/.test(fileName)
    || !Number.isSafeInteger(evidence.size) || evidence.size < 1 || evidence.size > MAX_VEHICLE_DOCUMENT_BYTES) {
    return { ok: false, error: "Attach PDF, PNG, JPG, JPEG, or DOCX proof up to 15 MB." };
  }
  const fileBytes = Buffer.from(await evidence.arrayBuffer());
  if (fileBytes.length !== evidence.size || !(await validateVehicleDocumentContent(fileBytes, extension))) {
    return { ok: false, error: "The proof does not match a supported file type or size." };
  }
  return { ok: true, value: { context, fileName, extension, fileBytes } };
}
