/**
 * Booking-fields catalog + validators (ported from the OLD FE
 * `utils/booking-fields.ts`). Pure, framework-agnostic: used by the intake
 * config UI (available field types) and by the public booking form to validate
 * answers client-side (the server re-validates required-ness independently).
 */

export type BookingFieldType = 'text' | 'textarea' | 'email' | 'phone' | 'number' | 'select' | 'checkbox' | 'guests';

export interface BookingFieldDef {
  type: BookingFieldType;
  /** Human label shown in the intake-config picker. */
  label: string;
  /** Whether this type carries a fixed-options list (select). */
  hasOptions?: boolean;
}

/** The field types an organizer can add to an event's intake form. */
export const BOOKING_FIELD_CATALOG: BookingFieldDef[] = [
  { type: 'text', label: 'Short text' },
  { type: 'textarea', label: 'Long text' },
  { type: 'email', label: 'Email' },
  { type: 'phone', label: 'Phone' },
  { type: 'number', label: 'Number' },
  { type: 'select', label: 'Dropdown', hasOptions: true },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'guests', label: 'Additional guests (emails)' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Permissive international phone: optional +, digits/spaces/dashes/parens, 7–20 digits.
const PHONE_RE = /^\+?[0-9()\s-]{7,20}$/;

/** Validate a phone value → null if OK, else an error message. Empty is OK (required-ness is separate). */
export function phoneValidator(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return PHONE_RE.test(v) ? null : 'Enter a valid phone number.';
}

/** Parse a guests field (comma/newline/semicolon-separated) into unique, trimmed emails. */
export function parseGuests(value: string): string[] {
  const seen = new Set<string>();
  for (const raw of value.split(/[,;\n]+/)) {
    const e = raw.trim().toLowerCase();
    if (e) seen.add(e);
  }
  return [...seen];
}

/** Validate a guests field → null if every entry is a valid email. Empty is OK. */
export function guestsValidator(value: string): string | null {
  const guests = parseGuests(value);
  if (guests.length === 0) return null;
  const bad = guests.filter((e) => !EMAIL_RE.test(e));
  return bad.length === 0 ? null : `Not a valid email: ${bad[0]}`;
}

/** Dispatch a field value to its type validator (only phone/guests have extra rules). */
export function validateBookingFieldValue(type: string, value: string): string | null {
  if (type === 'phone') return phoneValidator(value);
  if (type === 'guests') return guestsValidator(value);
  if (type === 'email') return value.trim() && !EMAIL_RE.test(value.trim()) ? 'Enter a valid email.' : null;
  return null;
}
