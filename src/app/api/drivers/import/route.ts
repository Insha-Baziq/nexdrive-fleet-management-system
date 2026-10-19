import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getOrganizationSession } from "@/lib/organization-session";
import { pool } from "@/lib/db";
import {
  DRIVER_IMPORT_MAX_BYTES,
  DRIVER_IMPORT_MAX_ROWS,
  DriverImportFileError,
  markExistingLicenceDuplicates,
  parseDriverImportFile,
  type DriverImportRow,
} from "@/lib/driver-import-parser";

export const runtime = "nodejs";

const workbookHeaders = [
  "Full name", "Date of birth", "Street number", "Street name", "Postal code", "City", "Licence number", "Licence expiry date",
];
const frenchWorkbookHeaders = [
  "Nom complet", "Date de naissance", "Numéro de rue", "Nom de la rue", "Code postal", "Ville", "Numéro de permis", "Date d’expiration du permis",
];
const workbookKeys = ["fullName", "dateOfBirth", "streetNumber", "streetName", "postalCode", "city", "licenceNumber", "licenceExpiryDate"];

type ImportResult = {
  intent: "preview" | "commit";
  rows: Omit<DriverImportRow, "input">[];
  totalRows: number;
  validRows: number;
  errorRows: number;
  canCommit: boolean;
  committed?: boolean;
  createdCount?: number;
};

function denied(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

function publicResult(intent: "preview" | "commit", rows: DriverImportRow[], createdCount?: number): ImportResult {
  const publicRows = rows.map((row) => ({
    rowNumber: row.rowNumber,
    fullName: row.fullName,
    licenceNumber: row.licenceNumber,
    dateOfBirth: row.dateOfBirth,
    streetNumber: row.streetNumber,
    streetName: row.streetName,
    postalCode: row.postalCode,
    city: row.city,
    errors: row.errors,
  }));
  const errorRows = rows.filter((row) => row.errors.length > 0).length;
  return {
    intent,
    rows: publicRows,
    totalRows: rows.length,
    validRows: rows.length - errorRows,
    errorRows,
    canCommit: rows.length > 0 && errorRows === 0,
    ...(intent === "commit" ? { committed: createdCount !== undefined, createdCount: createdCount ?? 0 } : {}),
  };
}

async function fileRows(form: FormData) {
  const file = form.get("file");
  if (!file || typeof file !== "object" || !("arrayBuffer" in file) || !("name" in file) || !("size" in file)) {
    throw new DriverImportFileError("Choose one CSV or .xlsx file.");
  }
  const uploaded = file as File;
  if (uploaded.size < 1 || uploaded.size > DRIVER_IMPORT_MAX_BYTES) {
    throw new DriverImportFileError("The import file must be between 1 byte and 5 MB.");
  }
  const bytes = new Uint8Array(await uploaded.arrayBuffer());
  return parseDriverImportFile(uploaded.name, bytes);
}

async function existingLicenceNumbers(tenantId: string, executor: { query: typeof pool.query }) {
  const result = await executor.query<{ licence_number: string }>(
    "SELECT licence_number FROM driver WHERE tenant_id = $1 AND licence_number IS NOT NULL",
    [tenantId],
  );
  return result.rows.map((row) => row.licence_number);
}

export async function GET(request: Request) {
  const session = await getOrganizationSession();
  if (!session) return denied(401, "Unauthorized.");
  if (session.role !== "administrator" && session.role !== "manager") return denied(403, "Only administrators and managers can import drivers.");
  const searchParams = new URL(request.url).searchParams;
  const format = searchParams.get("format");
  const french = searchParams.get("locale") === "fr";
  const headers = french ? frenchWorkbookHeaders : workbookHeaders;
  if (format === "csv") {
    return new Response(`${headers.join(",")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="nexdrive-driver-import-template.csv"',
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  }
  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Drivers");
    worksheet.columns = headers.map((header, index) => ({ header, key: workbookKeys[index], width: Math.max(header.length + 3, 18) }));
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.getRow(1).font = { bold: true };
    worksheet.autoFilter = { from: "A1", to: "H1" };
    for (const column of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
      worksheet.getColumn(column).numFmt = "@";
    }
    const bytes = await workbook.xlsx.writeBuffer();
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="nexdrive-driver-import-template.xlsx"',
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  }
  return denied(400, "Choose the CSV or XLSX template format.");
}

export async function POST(request: Request) {
  const session = await getOrganizationSession();
  if (!session) return denied(401, "Unauthorized.");
  if (session.role !== "administrator" && session.role !== "manager") return denied(403, "Only administrators and managers can import drivers.");
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > DRIVER_IMPORT_MAX_BYTES + 1024 * 1024) {
    return denied(413, "The import request exceeds the 5 MB file limit.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return denied(400, "Submit one CSV or .xlsx file.");
  }
  if ([...form.keys()].some((key) => key !== "intent" && key !== "file")
    || form.getAll("intent").length !== 1 || form.getAll("file").length !== 1) {
    return denied(400, "Submit one intent and one import file.");
  }
  const intent = form.get("intent");
  if (intent !== "preview" && intent !== "commit") return denied(400, "Choose preview or commit.");

  let rows: DriverImportRow[];
  try {
    rows = await fileRows(form);
  } catch (error) {
    return denied(400, error instanceof DriverImportFileError ? error.message : "Could not read the import file.");
  }
  if (rows.length > DRIVER_IMPORT_MAX_ROWS) return denied(400, `A file can contain at most ${DRIVER_IMPORT_MAX_ROWS} driver rows.`);

  if (intent === "preview") {
    const existing = await existingLicenceNumbers(session.tenantId, pool);
    rows = markExistingLicenceDuplicates(rows, existing);
    return NextResponse.json(publicResult(intent, rows), { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [session.tenantId]);
    const existing = await existingLicenceNumbers(session.tenantId, client);
    rows = markExistingLicenceDuplicates(rows, existing);
    if (rows.some((row) => row.errors.length > 0)) {
      await client.query("ROLLBACK");
      return NextResponse.json(publicResult(intent, rows), { status: 409, headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }

    for (const row of rows) {
      const input = row.input;
      if (!input) throw new Error("Validated import row is missing parsed driver fields.");
      await client.query(
        `INSERT INTO driver
         (id, tenant_id, user_id, full_name, licence_number, licence_expiry_date,
          date_of_birth, street_number, street_name, postal_code, city)
         VALUES ($1, $2, NULL, $3, $4, $5::date, $6::date, $7, $8, $9, $10)`,
        [randomUUID(), session.tenantId, input.fullName, input.licenceNumber, input.licenceExpiryDate,
          input.dateOfBirth, input.streetNumber, input.streetName, input.postalCode, input.city],
      );
    }
    await client.query("COMMIT");
    return NextResponse.json(publicResult(intent, rows, rows.length), { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return denied(500, "The driver import could not be committed. No rows were imported.");
  } finally {
    client.release();
  }
}
