import type { VehicleInspectionInput } from "@/lib/vehicle-inspections";

export function isValidInspectionDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateVehicleInspectionInput(value: unknown): VehicleInspectionInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["technicalDueDate", "emissionsDueDate"].includes(key))) return null;
  if (typeof input.technicalDueDate !== "string" || !isValidInspectionDate(input.technicalDueDate)) return null;
  const emissionsDueDate = input.emissionsDueDate === undefined || input.emissionsDueDate === null
    ? null
    : input.emissionsDueDate;
  if (emissionsDueDate !== null
    && (typeof emissionsDueDate !== "string" || !isValidInspectionDate(emissionsDueDate))) return null;
  return { technicalDueDate: input.technicalDueDate, emissionsDueDate };
}
