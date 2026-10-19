export const INSURANCE_EVENT_TYPES = ["insured", "suspension", "unpaid"] as const;
export type InsuranceEventType = (typeof INSURANCE_EVENT_TYPES)[number];

export type InsuranceEventInput = {
  eventType: InsuranceEventType;
  eventDate: string;
  description: string;
};

export function isValidCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateInsuranceEventInput(value: unknown): InsuranceEventInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["eventType", "eventDate", "description"].includes(key))) return null;
  if (typeof input.eventType !== "string" || !INSURANCE_EVENT_TYPES.includes(input.eventType as InsuranceEventType)) return null;
  if (typeof input.eventDate !== "string" || !isValidCalendarDate(input.eventDate)) return null;
  if (typeof input.description !== "string") return null;
  const description = input.description.trim();
  if (description.length < 1 || description.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)) return null;
  return { eventType: input.eventType as InsuranceEventType, eventDate: input.eventDate, description };
}

export function validateInsuranceEventCancellation(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["action", "reason"].includes(key)) || input.action !== "cancel" || typeof input.reason !== "string") return null;
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 1000 || /[\u0000-\u001f\u007f]/.test(reason)) return null;
  return reason;
}
