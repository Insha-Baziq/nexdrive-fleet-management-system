import type { AssignmentInput } from "@/lib/assignments";

type Result = { ok: true; value: AssignmentInput } | { ok: false; errors: Record<string, string> };
export type AssignmentCorrectionInput = { startedAt: string; endedAt: string | null; reason: string };
export type AssignmentEndInput = { endedAt: string; reason: string };
type CorrectionResult = { ok: true; value: AssignmentCorrectionInput } | { ok: false; errors: Record<string, string> };
type EndResult = { ok: true; value: AssignmentEndInput } | { ok: false; errors: Record<string, string> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = new Set(["vehicleId", "driverId", "startedAt", "startReason", "closureReason"]);

function optionalReason(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" ? value.trim() || null : false;
}

export function parseAssignmentInput(body: unknown): Result {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: { form: "Enter assignment details." } };
  }
  const raw = body as Record<string, unknown>;
  const errors: Record<string, string> = {};
  if (Object.keys(raw).some((key) => !fields.has(key))) errors.form = "Unexpected assignment fields were supplied.";
  const vehicleId = typeof raw.vehicleId === "string" ? raw.vehicleId : "";
  const driverId = typeof raw.driverId === "string" ? raw.driverId : "";
  if (!uuid.test(vehicleId)) errors.vehicleId = "Select a vehicle.";
  if (!uuid.test(driverId)) errors.driverId = "Select a driver.";
  const validCalendarDate = typeof raw.startedAt === "string" && Number.isFinite(Date.parse(`${raw.startedAt.slice(0, 10)}T00:00:00Z`))
    && new Date(`${raw.startedAt.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === raw.startedAt.slice(0, 10);
  const startedAt = validCalendarDate && typeof raw.startedAt === "string" && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw.startedAt)
    && Number.isFinite(Date.parse(raw.startedAt)) ? new Date(raw.startedAt).toISOString() : "";
  if (!startedAt) errors.startedAt = "Enter a valid start date and time.";
  const startReason = optionalReason(raw.startReason);
  const closureReason = optionalReason(raw.closureReason);
  if (startReason === false || (startReason && startReason.length > 500)) errors.startReason = "Use 500 characters or fewer.";
  if (closureReason === false || (closureReason && closureReason.length > 500)) errors.closureReason = "Use 500 characters or fewer.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: {
    vehicleId, driverId, startedAt,
    startReason: startReason as string | null,
    closureReason: closureReason as string | null,
  } };
}

const correctionFields = new Set(["startedAt", "endedAt", "reason"]);

function isoDateTime(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const calendarDate = value.slice(0, 10);
  const calendarMs = Date.parse(`${calendarDate}T00:00:00Z`);
  if (!Number.isFinite(calendarMs) || new Date(calendarMs).toISOString().slice(0, 10) !== calendarDate) return null;
  return new Date(time).toISOString();
}

export function parseAssignmentCorrectionInput(body: unknown): CorrectionResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: { form: "Enter the corrected assignment dates and a reason." } };
  }
  const raw = body as Record<string, unknown>;
  const errors: Record<string, string> = {};
  if (Object.keys(raw).some((key) => !correctionFields.has(key))) errors.form = "Unexpected assignment fields were supplied.";
  const startedAt = isoDateTime(raw.startedAt);
  if (!startedAt) errors.startedAt = "Enter a valid start date and time.";
  let endedAt: string | null = null;
  if (raw.endedAt !== null && raw.endedAt !== "") {
    const parsedEnd = isoDateTime(raw.endedAt);
    if (!parsedEnd) errors.endedAt = "Enter a valid end date and time, or leave it blank for an active assignment.";
    else endedAt = parsedEnd;
  } else if (!Object.hasOwn(raw, "endedAt")) {
    errors.endedAt = "Enter an end date and time, or leave it blank for an active assignment.";
  }
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (!reason) errors.reason = "Enter a reason for the correction.";
  else if (reason.length > 500) errors.reason = "Use 500 characters or fewer.";
  if (startedAt && endedAt && Date.parse(endedAt) <= Date.parse(startedAt)) {
    errors.endedAt = "The end must be later than the start.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { startedAt: startedAt!, endedAt, reason } };
}

export function parseAssignmentEndInput(body: unknown): EndResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: { form: "Enter an end date and reason." } };
  }
  const raw = body as Record<string, unknown>;
  const errors: Record<string, string> = {};
  if (Object.keys(raw).some((key) => !new Set(["endedAt", "reason"]).has(key))) errors.form = "Unexpected assignment fields were supplied.";
  const endedAt = isoDateTime(raw.endedAt);
  if (!endedAt) errors.endedAt = "Enter a valid end date and time.";
  else if (Date.parse(endedAt) > Date.now() + 60_000) errors.endedAt = "The assignment end cannot be in the future.";
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (!reason) errors.reason = "Enter a reason for ending the assignment.";
  else if (reason.length > 500) errors.reason = "Use 500 characters or fewer.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { endedAt: endedAt!, reason } };
}
