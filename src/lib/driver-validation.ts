import type { DriverInput } from "@/lib/drivers";

type InputResult =
  | { ok: true; value: DriverInput }
  | { ok: false; errors: Record<string, string> };

const fields = new Set([
  "fullName", "licenceNumber", "licenceExpiryDate", "userId",
  "dateOfBirth", "streetNumber", "streetName", "postalCode", "city",
]);

function dateField(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value : false;
}

export function parseDriverInput(body: unknown): InputResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: { form: "Enter driver details." } };
  }
  const raw = body as Record<string, unknown>;
  const errors: Record<string, string> = {};
  if (Object.keys(raw).some((field) => !fields.has(field))) {
    errors.form = "Unexpected driver fields were supplied.";
  }
  const fullName = typeof raw.fullName === "string" ? raw.fullName.trim() : "";
  const licenceNumber = typeof raw.licenceNumber === "string" ? raw.licenceNumber.trim() : "";
  const licenceExpiryDate = dateField(raw.licenceExpiryDate);
  const dateOfBirth = dateField(raw.dateOfBirth);
  const userId = raw.userId === null || raw.userId === undefined
    ? null : typeof raw.userId === "string" ? raw.userId.trim() || null : false;
  const streetNumber = typeof raw.streetNumber === "string" ? raw.streetNumber.trim() : "";
  const streetName = typeof raw.streetName === "string" ? raw.streetName.trim() : "";
  const postalCode = typeof raw.postalCode === "string" ? raw.postalCode.trim() : "";
  const city = typeof raw.city === "string" ? raw.city.trim() : "";
  if (!fullName || fullName.length > 160) errors.fullName = "Enter a full name (up to 160 characters).";
  if (licenceNumber.length > 80) errors.licenceNumber = "Use 80 characters or fewer.";
  if (licenceExpiryDate === false) errors.licenceExpiryDate = "Enter a valid date.";
  if (dateOfBirth === null || dateOfBirth === false) {
    errors.dateOfBirth = "Enter a valid date of birth.";
  } else if (dateOfBirth > new Date().toISOString().slice(0, 10)) {
    errors.dateOfBirth = "Date of birth cannot be in the future.";
  }
  if (!streetNumber || streetNumber.length > 24 || /[\u0000-\u001f\u007f]/.test(streetNumber)) {
    errors.streetNumber = "Enter a street number (up to 24 characters).";
  }
  if (!streetName || streetName.length > 160 || /[\u0000-\u001f\u007f]/.test(streetName)) {
    errors.streetName = "Enter a street name (up to 160 characters).";
  }
  if (!postalCode || postalCode.length > 24 || /[\u0000-\u001f\u007f]/.test(postalCode)) {
    errors.postalCode = "Enter a postal code (up to 24 characters).";
  }
  if (!city || city.length > 120 || /[\u0000-\u001f\u007f]/.test(city)) {
    errors.city = "Enter a city (up to 120 characters).";
  }
  if (userId === false || (userId && userId.length > 128)) errors.userId = "Select a valid Driver account.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: {
    fullName, licenceNumber: licenceNumber || null,
    licenceExpiryDate: licenceExpiryDate as string | null,
    userId: userId as string | null,
    dateOfBirth: dateOfBirth as string,
    streetNumber,
    streetName,
    postalCode,
    city,
  } };
}
