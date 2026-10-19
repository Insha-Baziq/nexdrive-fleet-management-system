import ExcelJS from "exceljs";
import { parseDriverInput } from "@/lib/driver-validation";
import type { DriverInput } from "@/lib/drivers";

export const DRIVER_IMPORT_MAX_ROWS = 500;
export const DRIVER_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

const headers = [
  "fullName", "dateOfBirth", "streetNumber", "streetName", "postalCode", "city",
  "licenceNumber", "licenceExpiryDate",
] as const;
const requiredHeaders = headers.filter((header) => header !== "licenceExpiryDate");
const headerAliases: Record<string, (typeof headers)[number]> = {
  fullname: "fullName",
  dateofbirth: "dateOfBirth",
  streetnumber: "streetNumber",
  streetname: "streetName",
  postalcode: "postalCode",
  city: "city",
  licencenumber: "licenceNumber",
  licensenumber: "licenceNumber",
  licenceexpirydate: "licenceExpiryDate",
  licenseexpirydate: "licenceExpiryDate",
  nomcomplet: "fullName",
  datedenaissance: "dateOfBirth",
  numeroderue: "streetNumber",
  nomdelarue: "streetName",
  codepostal: "postalCode",
  ville: "city",
  numerodepermis: "licenceNumber",
  datedexpirationdupermis: "licenceExpiryDate",
};

export type DriverImportRow = {
  rowNumber: number;
  fullName: string;
  licenceNumber: string;
  dateOfBirth: string;
  streetNumber: string;
  streetName: string;
  postalCode: string;
  city: string;
  errors: string[];
  input: DriverInput | null;
};

export class DriverImportFileError extends Error {}

function normalizedHeader(value: unknown) {
  return String(value ?? "").replace(/^\uFEFF/, "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
}

function parseCsv(source: string) {
  const records: { rowNumber: number; values: string[] }[] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
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
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === '"') {
      throw new DriverImportFileError("The CSV file contains a quote in an unquoted field.");
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      record.push(field);
      field = "";
      if (record.some((cell) => cell.trim() !== "")) records.push({ rowNumber: recordStartLine, values: record });
      record = [];
      lineNumber++;
      if (character === "\r" && source[index + 1] === "\n") index++;
      recordStartLine = lineNumber;
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
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return "";
    return value.toISOString().slice(0, 10);
  }
  if (!Number.isFinite(value) || value < 1 || value > 2_958_465) return "";
  const milliseconds = Math.round((value - 25_569) * 86_400_000);
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function cellValue(value: unknown): unknown {
  if (value instanceof Date || typeof value === "number" || typeof value === "string" || typeof value === "boolean" || value === null) return value;
  if (value && typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) return "[formula]";
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText)) {
      return (value as { richText: { text?: string }[] }).richText.map((part: { text?: string }) => part.text ?? "").join("");
    }
    if ("result" in value) return value.result;
  }
  return "";
}

async function parseWorkbook(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  try {
    const workbookBytes = Uint8Array.from(bytes).buffer;
    await workbook.xlsx.load(workbookBytes as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new DriverImportFileError("The Excel file could not be read. Upload a valid .xlsx workbook.");
  }
  if (workbook.worksheets.length !== 1) {
    throw new DriverImportFileError("The Excel workbook must contain exactly one worksheet.");
  }
  const worksheet = workbook.worksheets[0];
  const records: { rowNumber: number; values: unknown[] }[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row: ExcelJS.Row, rowNumber: number) => {
    const values: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell: ExcelJS.Cell, columnNumber: number) => {
      values[columnNumber - 1] = cellValue(cell.value);
    });
    if (values.some((value) => String(value ?? "").trim() !== "")) records.push({ rowNumber, values });
  });
  return records;
}

function dateValue(value: unknown) {
  if (value instanceof Date || typeof value === "number") return excelDate(value);
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function textValue(value: unknown) {
  if (value === null || value === undefined || value === "[formula]") return value === "[formula]" ? "[formula]" : "";
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

export function normalizeDriverLicence(value: string) {
  return value.normalize("NFKC").toLocaleUpperCase("en-US").replace(/[\s-]+/gu, "");
}

export async function parseDriverImportFile(fileName: string, bytes: Uint8Array): Promise<DriverImportRow[]> {
  if (bytes.byteLength < 1 || bytes.byteLength > DRIVER_IMPORT_MAX_BYTES) {
    throw new DriverImportFileError("The import file must be between 1 byte and 5 MB.");
  }
  const extension = fileName.toLowerCase().split(".").at(-1);
  let records: { rowNumber: number; values: unknown[] }[];
  if (extension === "csv") {
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new DriverImportFileError("The CSV file must use UTF-8 encoding.");
    }
    records = parseCsv(source);
  } else if (extension === "xlsx") {
    records = await parseWorkbook(bytes);
  } else {
    throw new DriverImportFileError("Choose a CSV or .xlsx file.");
  }
  if (records.length < 2) throw new DriverImportFileError("The import file needs a header row and at least one driver row.");

  const headerRecord = records[0];
  const columns: (typeof headers)[number][] = [];
  const seenHeaders = new Set<string>();
  for (const cell of headerRecord.values) {
    const normalized = normalizedHeader(cell);
    const header = headerAliases[normalized];
    if (!header) throw new DriverImportFileError(`Unsupported column “${String(cell ?? "").trim()}”. Use the provided driver template.`);
    if (seenHeaders.has(header)) throw new DriverImportFileError(`Column “${header}” appears more than once.`);
    seenHeaders.add(header);
    columns.push(header);
  }
  const missing = requiredHeaders.filter((header) => !seenHeaders.has(header));
  if (missing.length) throw new DriverImportFileError(`Missing required columns: ${missing.join(", ")}.`);

  const sourceRows = records.slice(1);
  if (sourceRows.length > DRIVER_IMPORT_MAX_ROWS) {
    throw new DriverImportFileError(`A file can contain at most ${DRIVER_IMPORT_MAX_ROWS} driver rows.`);
  }
  const rows = sourceRows.map(({ rowNumber, values }) => {
    const raw: Record<string, unknown> = {};
    columns.forEach((header, index) => {
      raw[header] = header === "dateOfBirth" || header === "licenceExpiryDate"
        ? dateValue(values[index])
        : textValue(values[index]);
    });
    const parsed = parseDriverInput({
      fullName: raw.fullName,
      licenceNumber: raw.licenceNumber,
      licenceExpiryDate: raw.licenceExpiryDate ?? "",
      dateOfBirth: raw.dateOfBirth,
      streetNumber: raw.streetNumber,
      streetName: raw.streetName,
      postalCode: raw.postalCode,
      city: raw.city,
    });
    const errors = parsed.ok ? [] : Object.values(parsed.errors);
    if (!textValue(raw.licenceNumber).trim()) errors.push("Licence number is required for duplicate matching.");
    if (Object.values(raw).includes("[formula]")) errors.push("Formulas are not supported; enter a value instead.");
    if (values.slice(columns.length).some((value) => String(value ?? "").trim() !== "")) {
      errors.push("This row contains data outside the provided columns.");
    }
    return {
      rowNumber,
      fullName: textValue(raw.fullName),
      licenceNumber: textValue(raw.licenceNumber),
      dateOfBirth: dateValue(raw.dateOfBirth),
      streetNumber: textValue(raw.streetNumber),
      streetName: textValue(raw.streetName),
      postalCode: textValue(raw.postalCode),
      city: textValue(raw.city),
      errors,
      input: parsed.ok && errors.length === 0 ? parsed.value : null,
    };
  });

  const firstRowByLicence = new Map<string, number>();
  for (const row of rows) {
    if (!row.licenceNumber.trim()) continue;
    const key = normalizeDriverLicence(row.licenceNumber);
    const firstRow = firstRowByLicence.get(key);
    if (firstRow !== undefined) {
      row.errors.push(`Licence number duplicates row ${firstRow} in this file.`);
      row.input = null;
    } else {
      firstRowByLicence.set(key, row.rowNumber);
    }
  }
  return rows;
}

export function markExistingLicenceDuplicates<T extends { licenceNumber: string; rowNumber: number; errors: string[]; input: DriverInput | null }>(
  rows: T[], existingLicenceNumbers: string[],
) {
  const existing = new Set(existingLicenceNumbers.filter(Boolean).map(normalizeDriverLicence));
  return rows.map((row) => {
    if (row.licenceNumber.trim() && existing.has(normalizeDriverLicence(row.licenceNumber))) {
      const errors = [...row.errors, "Licence number already exists in this organization."];
      return { ...row, errors, input: null };
    }
    return row;
  });
}
