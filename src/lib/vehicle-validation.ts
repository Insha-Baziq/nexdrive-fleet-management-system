import { VEHICLE_OWNERSHIP_TYPES, type VehicleInput, type VehicleOwnershipType } from "@/lib/vehicles";

type InputResult =
  | { ok: true; value: VehicleInput }
  | { ok: false; errors: Record<string, string> };

const fields = new Set([
  "registration", "make", "model", "year",
  "technicalInspectionDate", "insuranceCompany", "insuranceExpiryDate", "bonusMalus",
  "ownershipType", "registeredHolder",
]);

function textField(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum + 1) : "";
}

function dateField(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : false;
}

export function parseVehicleInput(body: unknown): InputResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: { form: "Enter vehicle details." } };
  }

  const raw = body as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const extraFields = Object.keys(raw).filter((field) => !fields.has(field));
  if (extraFields.length) errors.form = "Unexpected vehicle fields were supplied.";

  const registration = textField(raw.registration, 24).toUpperCase();
  const make = textField(raw.make, 80);
  const model = textField(raw.model, 80);
  const insuranceCompany = textField(raw.insuranceCompany, 120) || null;
  const ownershipType = raw.ownershipType;
  const registeredHolder = textField(raw.registeredHolder, 160) || null;
  if (!registration || registration.length > 24) errors.registration = "Enter a registration (up to 24 characters).";
  if (make.length > 80) errors.make = "Use 80 characters or fewer.";
  if (model.length > 80) errors.model = "Use 80 characters or fewer.";
  if (insuranceCompany && insuranceCompany.length > 120) errors.insuranceCompany = "Use 120 characters or fewer.";
  if (!VEHICLE_OWNERSHIP_TYPES.includes(ownershipType as VehicleOwnershipType)) {
    errors.ownershipType = "Choisissez le type de propriété ou d'utilisation du véhicule.";
  }
  if (registeredHolder && registeredHolder.length > 160) {
    errors.registeredHolder = "Utilisez 160 caractères ou moins.";
  }
  if (ownershipType && ownershipType !== "owned" && !registeredHolder) {
    errors.registeredHolder = "Indiquez le titulaire de la carte grise.";
  }

  const yearValue = raw.year === "" || raw.year === null || raw.year === undefined
    ? null : Number(raw.year);
  if (yearValue !== null && (!Number.isInteger(yearValue) || yearValue < 1886 || yearValue > 2100)) {
    errors.year = "Enter a valid vehicle year.";
  }

  const technicalInspectionDate = dateField(raw.technicalInspectionDate);
  const insuranceExpiryDate = dateField(raw.insuranceExpiryDate);
  if (technicalInspectionDate === false) errors.technicalInspectionDate = "Enter a valid date.";
  if (insuranceExpiryDate === false) errors.insuranceExpiryDate = "Enter a valid date.";

  const bonusValue = raw.bonusMalus === "" || raw.bonusMalus === null || raw.bonusMalus === undefined
    ? null : Number(raw.bonusMalus);
  if (bonusValue !== null && (!Number.isFinite(bonusValue) || bonusValue < 0 || bonusValue > 999.99 || Math.abs(Math.round(bonusValue * 100) - bonusValue * 100) > 1e-8)) {
    errors.bonusMalus = "Enter a value from 0 to 999.99 with up to two decimals.";
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      registration, make, model, year: yearValue,
      technicalInspectionDate: technicalInspectionDate as string | null,
      insuranceCompany, insuranceExpiryDate: insuranceExpiryDate as string | null,
      bonusMalus: bonusValue,
      ownershipType: ownershipType as VehicleOwnershipType,
      registeredHolder: ownershipType === "owned" ? null : registeredHolder,
    },
  };
}
