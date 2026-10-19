import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getOrganizationSession } from "@/lib/organization-session";
import { pool } from "@/lib/db";
import {
  markExistingVehicleRegistrationDuplicates,
  parseVehicleImportFile,
  VEHICLE_IMPORT_MAX_BYTES,
  VEHICLE_IMPORT_MAX_ROWS,
  type VehicleImportRow,
} from "@/lib/vehicle-import-parser";
import { DriverImportFileError } from "@/lib/driver-import-parser";

export const runtime = "nodejs";

const englishHeaders = [
  "Registration", "Make", "Model", "Year", "Ownership type", "Registered holder", "Insurance company",
  "Insurance expiry date", "Bonus-malus", "Technical inspection due date", "Emissions inspection due date",
];
const frenchHeaders = [
  "Immatriculation", "Marque", "Modèle", "Année", "Type de propriété", "Titulaire de la carte grise", "Assureur",
  "Date d’expiration de l’assurance", "Bonus-malus", "Échéance du contrôle technique", "Échéance du contrôle antipollution",
];
const workbookKeys = [
  "registration", "make", "model", "year", "ownershipType", "registeredHolder", "insuranceCompany",
  "insuranceExpiryDate", "bonusMalus", "technicalInspectionDate", "emissionsDueDate",
];

type ImportResult = {
  intent: "preview" | "commit";
  rows: Omit<VehicleImportRow, "input">[];
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

function publicResult(intent: "preview" | "commit", rows: VehicleImportRow[], createdCount?: number): ImportResult {
  const publicRows = rows.map((row) => ({
    rowNumber: row.rowNumber,
    registration: row.registration,
    make: row.make,
    model: row.model,
    year: row.year,
    ownershipType: row.ownershipType,
    registeredHolder: row.registeredHolder,
    insuranceCompany: row.insuranceCompany,
    insuranceExpiryDate: row.insuranceExpiryDate,
    bonusMalus: row.bonusMalus,
    technicalInspectionDate: row.technicalInspectionDate,
    emissionsDueDate: row.emissionsDueDate,
    errors: row.errors,
  }));
  const errorRows = rows.filter((row) => row.errors.length > 0).length;
  return {
    intent, rows: publicRows, totalRows: rows.length,
    validRows: rows.length - errorRows, errorRows,
    canCommit: rows.length > 0 && errorRows === 0,
    ...(intent === "commit" ? { committed: createdCount !== undefined, createdCount: createdCount ?? 0 } : {}),
  };
}

async function parseFile(form: FormData) {
  const file = form.get("file");
  if (!file || typeof file !== "object" || !("arrayBuffer" in file) || !("name" in file) || !("size" in file)) {
    throw new DriverImportFileError("Choose one CSV or .xlsx file.");
  }
  const uploaded = file as File;
  if (uploaded.size < 1 || uploaded.size > VEHICLE_IMPORT_MAX_BYTES) {
    throw new DriverImportFileError("The import file must be between 1 byte and 5 MB.");
  }
  return parseVehicleImportFile(uploaded.name, new Uint8Array(await uploaded.arrayBuffer()));
}

async function existingRegistrations(tenantId: string, executor: { query: typeof pool.query }) {
  const result = await executor.query<{ registration: string }>(
    "SELECT registration FROM vehicle WHERE tenant_id = $1",
    [tenantId],
  );
  return result.rows.map((row) => row.registration);
}

export async function GET(request: Request) {
  const session = await getOrganizationSession();
  if (!session) return denied(401, "Unauthorized.");
  if (session.role !== "administrator") return denied(403, "Only administrators can import vehicles.");
  const params = new URL(request.url).searchParams;
  const format = params.get("format");
  const french = params.get("locale") === "fr";
  const headers = french ? frenchHeaders : englishHeaders;
  if (format === "csv") {
    return new Response(`${headers.join(",")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="nexdrive-vehicle-import-template.csv"',
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  }
  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Vehicles");
    worksheet.columns = headers.map((header, index) => ({ header, key: workbookKeys[index], width: Math.max(header.length + 3, 19) }));
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.getRow(1).font = { bold: true };
    worksheet.autoFilter = { from: "A1", to: "K1" };
    for (const column of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]) worksheet.getColumn(column).numFmt = "@";
    for (let row = 2; row <= VEHICLE_IMPORT_MAX_ROWS + 1; row++) {
      worksheet.getCell(`E${row}`).dataValidation = {
        type: "list", allowBlank: false, formulae: ['"owned,long_term_rental,short_term_rental,loan"'],
        showErrorMessage: true, errorTitle: "Ownership type", error: "Choose a listed ownership code.",
      };
    }
    const bytes = await workbook.xlsx.writeBuffer();
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="nexdrive-vehicle-import-template.xlsx"',
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  }
  return denied(400, "Choose the CSV or XLSX template format.");
}

export async function POST(request: Request) {
  const session = await getOrganizationSession();
  if (!session) return denied(401, "Unauthorized.");
  if (session.role !== "administrator") return denied(403, "Only administrators can import vehicles.");
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > VEHICLE_IMPORT_MAX_BYTES + 1024 * 1024) {
    return denied(413, "The import request exceeds the 5 MB file limit.");
  }
  let form: FormData;
  try { form = await request.formData(); }
  catch { return denied(400, "Submit one CSV or .xlsx file."); }
  if ([...form.keys()].some((key) => key !== "intent" && key !== "file")
    || form.getAll("intent").length !== 1 || form.getAll("file").length !== 1) {
    return denied(400, "Submit one intent and one import file.");
  }
  const intent = form.get("intent");
  if (intent !== "preview" && intent !== "commit") return denied(400, "Choose preview or commit.");
  let rows: VehicleImportRow[];
  try { rows = await parseFile(form); }
  catch (error) {
    return denied(400, error instanceof DriverImportFileError ? error.message : "Could not read the import file.");
  }
  if (rows.length > VEHICLE_IMPORT_MAX_ROWS) return denied(400, `A file can contain at most ${VEHICLE_IMPORT_MAX_ROWS} vehicle rows.`);

  if (intent === "preview") {
    rows = markExistingVehicleRegistrationDuplicates(rows, await existingRegistrations(session.tenantId, pool));
    return NextResponse.json(publicResult(intent, rows), { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [session.tenantId]);
    rows = markExistingVehicleRegistrationDuplicates(rows, await existingRegistrations(session.tenantId, client));
    if (rows.some((row) => row.errors.length > 0)) {
      await client.query("ROLLBACK");
      return NextResponse.json(publicResult(intent, rows), { status: 409, headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }

    for (const row of rows) {
      const input = row.input;
      if (!input) throw new Error("Validated import row is missing parsed vehicle fields.");
      const id = randomUUID();
      await client.query(
        `INSERT INTO vehicle
         (id, tenant_id, registration, make, model, year, technical_inspection_date,
          insurance_company, insurance_expiry_date, bonus_malus, ownership_type, registered_holder, insurance_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9::date, $10, $11, $12,
           CASE WHEN NULLIF(BTRIM($8::text), '') IS NOT NULL AND $9::date >= CURRENT_DATE
             THEN 'insured' ELSE 'to_complete' END)`,
        [id, session.tenantId, input.registration, input.make, input.model, input.year, input.technicalInspectionDate,
          input.insuranceCompany, input.insuranceExpiryDate, input.bonusMalus, input.ownershipType, input.registeredHolder],
      );
      if (input.technicalInspectionDate) {
        await client.query(
          `INSERT INTO vehicle_inspection
           (tenant_id, vehicle_id, technical_due_date, emissions_due_date, source, recorded_by_user_id)
           VALUES ($1, $2, $3::date, $4::date, 'staff', $5)`,
          [session.tenantId, id, input.technicalInspectionDate, row.emissionsDueDate, session.user.id],
        );
      }
    }
    await client.query("COMMIT");
    return NextResponse.json(publicResult(intent, rows, rows.length), { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return denied(500, "The vehicle import could not be committed. No rows were imported.");
  } finally { client.release(); }
}
