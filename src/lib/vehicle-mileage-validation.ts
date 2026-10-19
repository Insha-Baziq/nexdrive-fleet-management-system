export type MileageReadingInput = {
  readingDate: string;
  mileage: number;
  note: string | null;
  acknowledgeLowerThanReadingId: string | null;
};

type InputResult =
  | { ok: true; value: MileageReadingInput }
  | { ok: false; errors: Record<string, string> };

const MAX_MILEAGE = 2_147_483_647;
const MAX_NOTE_LENGTH = 500;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseMileageReadingInput(body: unknown): InputResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: { form: "Enter a reading date and odometer value." } };
  }

  const raw = body as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const unexpectedFields = Object.keys(raw).filter((key) => !["readingDate", "mileage", "note", "acknowledgeLowerThanReadingId"].includes(key));
  if (unexpectedFields.length) errors.form = "Unexpected reading fields were supplied.";

  if (!isCalendarDate(raw.readingDate)) errors.readingDate = "Enter a valid calendar date.";

  const mileage = typeof raw.mileage === "number"
    ? raw.mileage
    : typeof raw.mileage === "string" && raw.mileage.trim() !== ""
      ? Number(raw.mileage)
      : Number.NaN;
  if (!Number.isSafeInteger(mileage) || mileage < 0 || mileage > MAX_MILEAGE) {
    errors.mileage = "Enter a whole kilometre value from 0 to 2,147,483,647.";
  }

  let note: string | null = null;
  if (raw.note !== undefined && raw.note !== null && typeof raw.note !== "string") {
    errors.note = "Enter a text note.";
  } else if (typeof raw.note === "string") {
    note = raw.note.trim() || null;
    if (note && note.length > MAX_NOTE_LENGTH) errors.note = `Use ${MAX_NOTE_LENGTH} characters or fewer.`;
  }

  const acknowledgeLowerThanReadingId = raw.acknowledgeLowerThanReadingId === undefined || raw.acknowledgeLowerThanReadingId === null
    ? null : raw.acknowledgeLowerThanReadingId;
  if (acknowledgeLowerThanReadingId !== null && (typeof acknowledgeLowerThanReadingId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(acknowledgeLowerThanReadingId))) {
    errors.form = "Confirmation de kilométrage invalide.";
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { readingDate: raw.readingDate as string, mileage, note, acknowledgeLowerThanReadingId: acknowledgeLowerThanReadingId as string | null } };
}

export function parseMileageCancellationReason(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false as const, errors: { cancellationReason: "Enter a cancellation reason." } };
  }
  const raw = body as Record<string, unknown>;
  if (Object.keys(raw).some((key) => key !== "cancellationReason")) {
    return { ok: false as const, errors: { form: "Unexpected cancellation fields were supplied." } };
  }
  const reason = typeof raw.cancellationReason === "string" ? raw.cancellationReason.trim() : "";
  if (!reason || reason.length > 1000) {
    return { ok: false as const, errors: { cancellationReason: "Enter a reason of 1 to 1,000 characters." } };
  }
  return { ok: true as const, value: reason };
}
