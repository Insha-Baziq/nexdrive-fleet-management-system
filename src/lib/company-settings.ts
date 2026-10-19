import "server-only";
import { pool } from "@/lib/db";

export type CompanyInformation = {
  legal_name: string;
  siret: string | null;
  vat_number: string | null;
  registered_address: string | null;
  administrative_contact_name: string | null;
  administrative_contact_email: string | null;
  administrative_contact_phone: string | null;
};

export type CompanyInformationInput = Omit<CompanyInformation, "legal_name"> & {
  legal_name: string;
};

const fieldNames = [
  "legalName",
  "siret",
  "vatNumber",
  "registeredAddress",
  "administrativeContactName",
  "administrativeContactEmail",
  "administrativeContactPhone",
] as const;

export class CompanyInformationValidationError extends Error {}

function textField(value: unknown, label: string, maxLength: number, required = false) {
  if (typeof value !== "string") throw new CompanyInformationValidationError("Enter valid company information.");
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maxLength) {
    throw new CompanyInformationValidationError(`Enter a ${label} up to ${maxLength} characters${required ? "" : " or leave the field empty"}.`);
  }
  return normalized || null;
}

export function parseCompanyInformation(input: unknown): CompanyInformationInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CompanyInformationValidationError("Enter valid company information.");
  }
  const body = input as Record<string, unknown>;
  if (Object.keys(body).length !== fieldNames.length || fieldNames.some((name) => !Object.hasOwn(body, name))) {
    throw new CompanyInformationValidationError("Enter all company information fields.");
  }

  const legalName = textField(body.legalName, "legal name", 160, true);
  if (!legalName) throw new CompanyInformationValidationError("Enter a legal name up to 160 characters.");
  const siret = textField(body.siret, "SIRET", 14);
  if (siret && !/^\d{14}$/.test(siret)) {
    throw new CompanyInformationValidationError("Enter a 14-digit SIRET or leave the field empty.");
  }

  const vatNumber = textField(body.vatNumber, "VAT number", 32);
  if (vatNumber && !/^[A-Z0-9][A-Z0-9 .\-/]*$/i.test(vatNumber)) {
    throw new CompanyInformationValidationError("Enter a valid VAT number using letters and numbers.");
  }

  const registeredAddress = textField(body.registeredAddress, "registered address", 500);
  const contactName = textField(body.administrativeContactName, "contact name", 120);
  const contactEmail = textField(body.administrativeContactEmail, "contact email", 254);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw new CompanyInformationValidationError("Enter a valid administrative contact email address.");
  }
  const contactPhone = textField(body.administrativeContactPhone, "contact phone", 40);
  if (contactPhone && (!/[0-9]/.test(contactPhone) || !/^[+() 0-9.\-]+$/.test(contactPhone))) {
    throw new CompanyInformationValidationError("Enter a valid administrative contact phone number.");
  }

  return {
    legal_name: legalName,
    siret,
    vat_number: vatNumber?.toUpperCase() ?? null,
    registered_address: registeredAddress,
    administrative_contact_name: contactName,
    administrative_contact_email: contactEmail?.toLowerCase() ?? null,
    administrative_contact_phone: contactPhone,
  };
}

const companySelection = `
  COALESCE(legal_name, name) AS legal_name,
  siret,
  vat_number,
  registered_address,
  administrative_contact_name,
  administrative_contact_email,
  administrative_contact_phone`;

export async function getCompanyInformation(tenantId: string) {
  const result = await pool.query<CompanyInformation>(
    `SELECT ${companySelection} FROM tenant WHERE id=$1`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}

export async function saveCompanyInformation(tenantId: string, company: CompanyInformationInput) {
  const result = await pool.query<CompanyInformation>(
    `UPDATE tenant SET
       legal_name=$2,
       siret=$3,
       vat_number=$4,
       registered_address=$5,
       administrative_contact_name=$6,
       administrative_contact_email=$7,
       administrative_contact_phone=$8
     WHERE id=$1
     RETURNING ${companySelection}`,
    [
      tenantId,
      company.legal_name,
      company.siret,
      company.vat_number,
      company.registered_address,
      company.administrative_contact_name,
      company.administrative_contact_email,
      company.administrative_contact_phone,
    ],
  );
  return result.rows[0] ?? null;
}
