/**
 * Minimal RFC 5545 iTIP builder for booking invites. Emits a VCALENDAR with one
 * VEVENT, METHOD REQUEST (confirm/reschedule) or CANCEL, a STABLE UID per
 * booking, and an INCREASING SEQUENCE (confirm=0, reschedule=1, cancel=2) so
 * calendar clients update the same event. CRLF line endings, 75-octet UTF-8
 * line folding, and TEXT escaping per the spec.
 */

export type IcsMethod = 'REQUEST' | 'CANCEL';

export interface IcsInput {
  /** Stable per-booking id (e.g. the booking uid). */
  uid: string;
  method: IcsMethod;
  /** 0 = confirm, 1 = reschedule, 2 = cancel. Must strictly increase per UID. */
  sequence: number;
  startUtc: string;
  endUtc: string;
  title: string;
  description?: string | null;
  location?: string | null;
  organizer?: { name?: string | null; email?: string | null } | null;
  attendees: Array<{ name?: string | null; email: string }>;
  /** DTSTAMP instant (ISO). Injected for deterministic output/tests. */
  stamp: string;
}

/** Escape a TEXT value (RFC 5545 §3.3.11). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Format an ISO instant as a UTC iCalendar date-time (YYYYMMDDTHHMMSSZ). */
function toIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Fold a content line to <=75 octets (UTF-8), continuation lines start with a space. */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    // Avoid splitting a multi-byte char: back off until a lead byte boundary.
    let end = Math.min(start + limit, bytes.length);
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines are prefixed with one space
  }
  return out.join('\r\n ');
}

export function buildIcs(input: IcsInput): string {
  const status = input.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Slate//Calendars//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${input.method}`,
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${toIcsUtc(input.stamp)}`,
    `DTSTART:${toIcsUtc(input.startUtc)}`,
    `DTEND:${toIcsUtc(input.endUtc)}`,
    `SUMMARY:${escapeText(input.title)}`,
    `STATUS:${status}`,
  ];
  if (input.description) lines.push(`DESCRIPTION:${escapeText(input.description)}`);
  if (input.location) lines.push(`LOCATION:${escapeText(input.location)}`);
  if (input.organizer?.email) {
    const cn = input.organizer.name ? `;CN=${escapeText(input.organizer.name)}` : '';
    lines.push(`ORGANIZER${cn}:mailto:${input.organizer.email}`);
  }
  for (const a of input.attendees) {
    const cn = a.name ? `;CN=${escapeText(a.name)}` : '';
    lines.push(`ATTENDEE${cn};RSVP=TRUE:mailto:${a.email}`);
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** Content type for an iTIP attachment of the given method. */
export function icsContentType(method: IcsMethod): string {
  return `text/calendar; method=${method}; charset=utf-8`;
}
