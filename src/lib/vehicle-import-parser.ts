import ExcelJS from "exceljs";
import { parseVehicleInput } from "@/lib/vehicle-validation";
import { isValidInspectionDate } from "@/lib/vehicle-inspection-validation";
import { DRIVER_IMPORT_MAX_BYTES, DRIVER_IMPORT_MAX_ROWS, DriverImportFileError } from "@/lib/driver-import-parser";
import type { VehicleInput } from "@/lib/vehicles";

export const VEHICLE_IMPORT_MAX_BYTES = DRIVER_IMPORT_MAX_BYTES;
export const VEHICLE_IMPORT_MAX_ROWS = DRIVER_IMPORT_MAX_ROWS;

type VehicleImportField =
  | "registration" | "make" | "model" | "year" | "ownershipType" | "registeredHolder" | "insuranceCompany"
  | "insuranceExpiryDate" | "bonusMalus" | "technicalInspectionDate" | "emissionsDueDate";
const requiredFields: VehicleImportField[] = ["registration", "ownershipType"];
const fieldAliases: Record<string, VehicleImportField> = {
  registration: "registration", immatriculation: "registration", platenumber: "registration",
  make: "make", marque: "make",
  model: "model", modele: "model",
  year: "year", annee: "year",
  ownershiptype: "ownershipType", typepropriete: "ownershipType", typedepropriete: "ownershipType", typeownership: "ownershipType",
  registeredholder: "registeredHolder", holder: "registeredHolder", titulaire: "registeredHolder",
  titulairedelacartegrise: "registeredHolder", titulaireregistration: "registeredHolder",
  insurancecompany: "insuranceCompany", insurer: "insuranceCompany", assureur: "insuranceCompany",
  insuranceexpirydate: "insuranceExpiryDate", insuranceexpirationdate: "insuranceExpiryDate",
  dateexpirationassurance: "insuranceExpiryDate", datedexpirationdelassurance: "insuranceExpiryDate",
  bonusmalus: "bonusMalus", technicalinspectionduedate: "technicalInspectionDate", technicalinspectiondate: "technicalInspectionDate",
  echeanceducontroletechnique: "technicalInspectionDate", dateduecontroletechnique: "technicalInspectionDate",
  emissionsinspectionduedate: "emissionsDueDate", emissionsduedate: "emissionsDueDate",
  echeanceducontroleantipollution: "emissionsDueDate", echeanceducontroledespolluants: "emissionsDueDate",
};

export type VehicleImportRow = {
  rowNumber: number;
  registration: string;
  make: string;
  model: string;
  year: string;
  ownershipType: string;
  registeredHolder: string;
  insuranceCompany: string;
  insuranceExpiryDate: string;
  bonusMalus: string;
  technicalInspectionDate: string;
  errors: string[];
  input: VehicleInput | null;
  emissionsDueDate: string | null;
};

function normalizeHeader(value: unknown) {
  return String(value ?? "").replace(/^\uFEFF/, "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
}

function parseCsv(source: string) {
  const records: { rowNumber: number; values: string[] }[] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let lineNumber = 1;
  let recordStartLine = 1;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        field += character;
        if (character === "\n") lineNumber++;
        else if (character === "\r") {
          lineNumber++;
          if (source[index + 1] === "\n") index++;
        }
      }
      continue;
    }
    if (afterQuote && character !== "," && character !== "\n" && character !== "\r") {
      throw new DriverImportFileError("The CSV file contains characters after a quoted field.");
    }
    if (character === '"' && field.length === 0 && !afterQuote) {
      quoted = true;
    } else if (character === '"') {
      throw new DriverImportFileError("The CSV file contains a quote in an unquoted field.");
    } else if (character === ",") {
      record.push(field);
      field = "";
      afterQuote = false;
    } else if (character === "\n" || character === "\r") {
      record.push(field);
      field = "";
      if (record.some((cell) => cell.trim() !== "")) records.push({ rowNumber: recordStartLine, values: record });
      record = [];
      lineNumber++;
      if (character === "\r" && source[index + 1] === "\n") index++;
      recordStartLine = lineNumber;
      afterQuote = false;
    } else {
      field += character;
    }
  }
  if (quoted) throw new DriverImportFileError("The CSV file has an unclosed quoted field.");
  record.push(field);
  if (record.some((cell) => cell.trim() !== "")) records.push({ rowNumber: recordStartLine, values: record });
  return records;
}

function excelDate(value: Date | number) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : "[invalid date]";
  if (!Number.isFinite(value) || value < 1 || value > 2_958_465) return "[invalid date]";
  const date = new Date(Math.round((value - 25_569) * 86_400_000));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function cellValue(value: unknown): unknown {
  if (value instanceof Date || typeof value === "number" || typeof value === "string" || typeof value === "boolean" || value === null) return value;
  if (value && typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) return "[formula]";
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText)) {
      return (value as { richText: { text?: string }[] }).richText.map((part) => part.text ?? "").join("");
    }
    if ("result" in value) return value.result;
  }
  return "";
}

async function workbookRecords(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new DriverImportFileError("The Excel file could not be read. Upload a valid .xlsx workbook.");
  }
  if (workbook.worksheets.length !== 1) throw new DriverImportFileError("The Excel workbook must contain exactly one worksheet.");
  const records: { rowNumber: number; values: unknown[] }[] = [];
  workbook.worksheets[0].eachRow({ includeEmpty: false }, (row: ExcelJS.Row, rowNumber: number) => {
    const values: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell: ExcelJS.Cell, columnNumber: number) => { values[columnNumber - 1] = cellValue(cell.value); });
    if (values.some((value) => String(value ?? "").trim() !== "")) records.push({ rowNumber, values });
  });
  return records;
}

function stringValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value === "[formula]") return "[formula]";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function dateValue(value: unknown) {
  if (value instanceof Date || typeof value === "number") return excelDate(value);
  return stringValue(value);
}

function ownershipCode(value: unknown) {
  const raw = stringValue(value);
  const normalized = raw.normalize("NFKD").replace(/\p{M}/gu, "").trim().toLowerCase().replace(/[ -]+/g, "_");
  const aliases: Record<string, string> = {
    owned: "owned", propriete: "owned", owned_vehicle: "owned",
    long_term_rental: "long_term_rental", location_longue_duree: "long_term_rental", lld: "long_term_rental",
    short_term_rental: "short_term_rental", location_courte_duree: "short_term_rental", lcd: "short_term_rental",
    loan: "loan", pret: "loan", pret_de_vehicule: "loan",
  };
  return aliases[normalized] ?? raw;
}

function bonusMalusValue(value: unknown) {
  const text = stringValue(value);
  return /^\d{1,3},\d{1,2}$/.test(text) ? text.replace(",", ".") : text;
}

export function normalizeVehicleRegistration(value: string) {
  return value.normalize("NFKC").toLocaleUpperCase("en-US").replace(/[\s-]+/gu, "");
}

export async function parseVehicleImportFile(fileName: string, bytes: Uint8Array): Promise<VehicleImportRow[]> {
  if (bytes.byteLength < 1 || bytes.byteLength > VEHICLE_IMPORT_MAX_BYTES) {
    throw new DriverImportFileError("The import file must be between 1 byte and 5 MB.");
  }
  const extension = fileName.toLowerCase().split(".").at(-1);
  let records: { rowNumber: number; values: unknown[] }[];
  if (extension === "csv") {
    let source: string;
    try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new DriverImportFileError("The CSV file must use UTF-8 encoding."); }
    records = parseCsv(source);
  } else if (extension === "xlsx") {
    records = await workbookRecords(bytes);
  } else {
    throw new DriverImportFileError("Choose a CSV or .xlsx file.");
  }
  if (records.length < 2) throw new DriverImportFileError("The import file needs a header row and at least one vehicle row.");
  const columns: VehicleImportField[] = [];
  const seen = new Set<VehicleImportField>();
  for (const cell of records[0].values) {
    const field = fieldAliases[normalizeHeader(cell)];
    if (!field) throw new DriverImportFileError(`Unsupported column “${String(cell ?? "").trim()}”. Use the provided vehicle template.`);
    if (seen.has(field)) throw new DriverImportFileError(`Column “${field}” appears more than once.`);
    seen.add(field);
    columns.push(field);
  }
  const missing = requiredFields.filter((field) => !seen.has(field));
  if (missing.length) throw new DriverImportFileError(`Missing required columns: ${missing.join(", ")}.`);
  const sourceRows = records.slice(1);
  if (sourceRows.length > VEHICLE_IMPORT_MAX_ROWS) throw new DriverImportFileError(`A file can contain at most ${VEHICLE_IMPORT_MAX_ROWS} vehicle rows.`);

  const rows = sourceRows.map(({ rowNumber, values }) => {
    const raw: Partial<Record<VehicleImportField, unknown>> = {};
    columns.forEach((field, index) => {
      raw[field] = field === "insuranceExpiryDate" || field === "technicalInspectionDate" || field === "emissionsDueDate"
        ? dateValue(values[index])
        : stringValue(values[index]);
    });
    const technicalInspectionDate = dateValue(raw.technicalInspectionDate);
    const emissionsDueDateValue = dateValue(raw.emissionsDueDate);
    const parsed = parseVehicleInput({
      registration: raw.registration,
      make: raw.make,
      model: raw.model,
      year: raw.year,
      ownershipType: ownershipCode(raw.ownershipType),
      registeredHolder: raw.registeredHolder,
      insuranceCompany: raw.insuranceCompany,
      insuranceExpiryDate: dateValue(raw.insuranceExpiryDate),
      bonusMalus: bonusMalusValue(raw.bonusMalus),
      technicalInspectionDate,
    });
    const errors = parsed.ok ? [] : Object.values(parsed.errors);
    if (emissionsDueDateValue && !isValidInspectionDate(emissionsDueDateValue)) errors.push("Enter a valid emissions inspection date.");
    if (Object.values(raw).includes("[formula]")) errors.push("Formulas are not supported; enter a value instead.");
    if (values.slice(columns.length).some((value) => String(value ?? "").trim() !== "")) errors.push("This row contains data outside the provided columns.");
    if (emissionsDueDateValue && !technicalInspectionDate) errors.push("A technical inspection due date is required when an emissions due date is provided.");
    const input = parsed.ok && errors.length === 0 ? parsed.value : null;
    return {
      rowNumber,
      registration: stringValue(raw.registration).trim().toUpperCase(),
      make: stringValue(raw.make),
      model: stringValue(raw.model),
      year: stringValue(raw.year),
      ownershipType: stringValue(raw.ownershipType),
      registeredHolder: stringValue(raw.registeredHolder),
      insuranceCompany: stringValue(raw.insuranceCompany),
      insuranceExpiryDate: dateValue(raw.insuranceExpiryDate),
      bonusMalus: bonusMalusValue(raw.bonusMalus),
      technicalInspectionDate,
      errors,
      input,
      emissionsDueDate: emissionsDueDateValue || null,
    };
  });

  const firstRowByRegistration = new Map<string, number>();
  for (const row of rows) {
    if (!row.registration.trim()) continue;
    const key = normalizeVehicleRegistration(row.registration);
    const firstRow = firstRowByRegistration.get(key);
    if (firstRow !== undefined) {
      row.errors.push(`Registration duplicates row ${firstRow} in this file.`);
      row.input = null;
    } else firstRowByRegistration.set(key, row.rowNumber);
  }
  return rows;
}

export function markExistingVehicleRegistrationDuplicates<T extends { registration: string; errors: string[]; input: VehicleInput | null }>(
  rows: T[], existingRegistrations: string[],
) {
  const existing = new Set(existingRegistrations.filter(Boolean).map(normalizeVehicleRegistration));
  return rows.map((row) => existing.has(normalizeVehicleRegistration(row.registration))
    ? { ...row, errors: [...row.errors, "Registration already exists in this organization."], input: null }
    : row);
}
