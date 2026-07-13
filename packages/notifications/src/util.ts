import type { EmailMessage } from './email.port';

/** Normalize `to` into a non-empty array of trimmed addresses, or throw. */
export function normalizeRecipients(to: EmailMessage['to']): string[] {
  const list = (Array.isArray(to) ? to : [to])
    .map((addr) => (typeof addr === 'string' ? addr.trim() : ''))
    .filter(Boolean);
  if (list.length === 0) {
    throw new Error('EmailMessage requires at least one recipient');
  }
  return list;
}

/** Format a `Name <email>` sender string, omitting the name when absent. */
export function formatSender(fromEmail: string, fromName?: string): string {
  return fromName ? `${fromName} <${fromEmail}>` : fromEmail;
}

/**
 * HTML-escape a string for safe interpolation into email HTML bodies. Booking
 * fields (attendee name, event title, cancellation reason) are attacker-
 * controlled; interpolating them raw is stored XSS (E8). Escape EVERY dynamic
 * value on the HTML path.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
