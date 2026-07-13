/**
 * Minimal, dependency-free RFC-4180 CSV encoding for the submissions export.
 * Values are quoted when they contain a comma, quote, or newline; embedded
 * quotes are doubled. Arrays flatten to `a; b; c`; null/undefined to empty.
 */

/** Escape a single CSV field. */
export function csvField(value: unknown): string {
  let s: string;
  if (value == null) s = '';
  else if (Array.isArray(value)) s = value.map((v) => (v == null ? '' : String(v))).join('; ');
  else if (typeof value === 'object') s = JSON.stringify(value);
  else s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Join a row of already-collected values into a CSV line (with CRLF). */
export function csvRow(values: unknown[]): string {
  return values.map(csvField).join(',') + '\r\n';
}
