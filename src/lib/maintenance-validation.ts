import {
  getVehicleDocumentExtension,
  getVehicleDocumentMimeType,
  MAX_VEHICLE_DOCUMENT_BYTES,
  validateVehicleDocumentContent,
} from "@/lib/vehicle-documents";

export type MaintenanceLocationType = "internal" | "external";
export type ParsedMaintenanceForm = {
  interventionDate: string;
  locationType: MaintenanceLocationType;
  garageName: string | null;
  workPerformed: string;
  partsUsed: string | null;
  invoice: {
    fileName: string;
    extension: NonNullable<ReturnType<typeof getVehicleDocumentExtension>>;
    contentType: string;
    bytes: Buffer;
  } | null;
};

export type MaintenanceValidation = { ok: true; value: ParsedMaintenanceForm } | { ok: false; error: string };
const allowedFields = new Set(["interventionDate", "locationType", "garageName", "workPerformed", "partsUsed", "invoice"]);
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function singleText(form: FormData, key: string) {
  const items = form.getAll(key);
  return items.length === 1 && typeof items[0] === "string" ? items[0] : null;
}

export async function parseMaintenanceForm(form: FormData): Promise<MaintenanceValidation> {
  if ([...form.keys()].some((key) => !allowedFields.has(key))) return { ok: false, error: "The intervention form contains unsupported fields." };
  const interventionDate = singleText(form, "interventionDate");
  const rawLocation = singleText(form, "locationType");
  const rawGarageName = singleText(form, "garageName");
  const rawWorkPerformed = singleText(form, "workPerformed");
  const rawParts = singleText(form, "partsUsed");
  if (interventionDate === null || rawLocation === null || rawGarageName === null || rawWorkPerformed === null || rawParts === null) {
    return { ok: false, error: "Complete the intervention date, location, and work performed." };
  }
  if (!validCalendarDate(interventionDate)) return { ok: false, error: "Enter a valid intervention date." };
  if (rawLocation !== "internal" && rawLocation !== "external") return { ok: false, error: "Choose an internal or external location." };
  const garageName = rawGarageName.trim();
  if (rawLocation === "external" && (!garageName || garageName.length > 180 || controls.test(garageName))) {
    return { ok: false, error: "Enter an external garage name up to 180 characters." };
  }
  if (rawLocation === "internal" && garageName) return { ok: false, error: "A garage name is only used for external work." };
  const workPerformed = rawWorkPerformed.trim();
  if (!workPerformed || workPerformed.length > 4000 || controls.test(workPerformed)) {
    return { ok: false, error: "Describe the work performed in 1–4,000 characters." };
  }
  const partsUsed = rawParts.trim();
  if (partsUsed.length > 4000 || controls.test(partsUsed)) return { ok: false, error: "Parts used or ordered must be 4,000 characters or fewer." };

  const invoiceFields = form.getAll("invoice");
  if (invoiceFields.length > 1 || invoiceFields.some((item) => typeof item === "string")) {
    return { ok: false, error: "Choose at most one invoice file." };
  }
  let invoice: ParsedMaintenanceForm["invoice"] = null;
  const candidate = invoiceFields[0];
  if (candidate) {
    const file = candidate as File;
    const fileName = file.name.trim().split(/[\\/]/).at(-1) ?? "";
    const extension = getVehicleDocumentExtension(fileName);
    if (!extension || !fileName || fileName.length > 180 || controls.test(fileName)
      || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_VEHICLE_DOCUMENT_BYTES) {
      return { ok: false, error: "Invoices must be PDF, PNG, JPG, JPEG, or DOCX files up to 15 MB." };
    }
    const contentType = getVehicleDocumentMimeType(extension);
    if (file.type && file.type !== contentType) return { ok: false, error: "The invoice file type does not match its extension." };
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!await validateVehicleDocumentContent(bytes, extension)) return { ok: false, error: "The invoice file content does not match its selected type." };
    invoice = { fileName, extension, contentType, bytes };
  }

  return { ok: true, value: {
    interventionDate,
    locationType: rawLocation,
    garageName: rawLocation === "external" ? garageName : null,
    workPerformed,
    partsUsed: partsUsed || null,
    invoice,
  } };
}

export function parseMaintenanceCancellation(body: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Enter a cancellation reason." };
  const value = body as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || value.action !== "cancel" || typeof value.reason !== "string") {
    return { ok: false, error: "Use the cancel action and provide a reason." };
  }
  const reason = value.reason.trim();
  if (!reason || reason.length > 1000 || controls.test(reason)) return { ok: false, error: "Enter a cancellation reason up to 1,000 characters." };
  return { ok: true, reason };
}


