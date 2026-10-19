export const CLAIM_CONTACT_ROLES = ["insurer", "expert", "garage", "other"] as const;
export type ClaimContactRole = (typeof CLAIM_CONTACT_ROLES)[number];

export type ParsedClaimContact = {
  role: ClaimContactRole;
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
};

export type ClaimContactInputResult = { ok: true; value: ParsedClaimContact } | { ok: false; error: string };

const allowedFields = new Set(["role", "name", "phone", "email", "note"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nameControl = /[\u0000-\u001f\u007f]/;
const noteControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function optionalText(value: unknown, label: string, max: number, allowNewlines = false) {
  if (value === undefined || value === null) return { ok: true as const, value: null };
  if (typeof value !== "string") return { ok: false as const, error: `${label} must be text.` };
  const normalized = value.trim();
  if (!normalized) return { ok: true as const, value: null };
  const hasControl = allowNewlines ? noteControl.test(normalized) : nameControl.test(normalized);
  if (normalized.length > max || hasControl) return { ok: false as const, error: `${label} exceeds the allowed length or contains unsupported characters.` };
  return { ok: true as const, value: normalized };
}

export function parseClaimContactInput(input: unknown): ClaimContactInputResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Enter valid contact details." };
  const value = input as Record<string, unknown>;
  for (const key of Object.keys(value)) if (!allowedFields.has(key)) return { ok: false, error: "Invalid contact fields." };
  if (typeof value.role !== "string" || !CLAIM_CONTACT_ROLES.includes(value.role as ClaimContactRole)) {
    return { ok: false, error: "Choose an in-scope contact role." };
  }
  if (typeof value.name !== "string") return { ok: false, error: "Enter a contact name." };
  const name = value.name.trim();
  if (!name || name.length > 160 || nameControl.test(name)) return { ok: false, error: "Contact name must be 1–160 characters." };

  const phone = optionalText(value.phone, "Phone", 80);
  const email = optionalText(value.email, "Email", 254);
  const note = optionalText(value.note, "Note", 1000, true);
  if (!phone.ok) return { ok: false, error: phone.error };
  if (!email.ok) return { ok: false, error: email.error };
  if (!note.ok) return { ok: false, error: note.error };
  if (email.value && !emailPattern.test(email.value)) return { ok: false, error: "Enter a valid email address." };

  return {
    ok: true,
    value: { role: value.role as ClaimContactRole, name, phone: phone.value, email: email.value, note: note.value },
  };
}
