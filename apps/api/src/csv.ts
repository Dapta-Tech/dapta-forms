/**
 * Minimal, dependency-free RFC-4180 CSV encoding for the submissions export.
 * Values are quoted when they contain a comma, quote, or newline; embedded
 * quotes are doubled. Arrays flatten to `a; b; c`; null/undefined to empty.
 *
 * Formula-injection hardening (OWASP CSV injection): a user-supplied value
 * starting with `=`, `+`, `-`, `@`, tab, or CR would be executed as a formula
 * by Excel/Sheets on open (e.g. `=HYPERLINK(...)`). Such fields are neutralized
 * by prefixing a single quote AFTER stringification, BEFORE quoting. Genuine
 * numbers/booleans can't carry a formula and are left untouched (so a negative
 * score exports as `-5`, not `'-5`).
 */

/** Leading characters Excel/Sheets interpret as a formula trigger. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** Escape a single CSV field (with formula-injection neutralization). */
export function csvField(value: unknown): string {
  let s: string;
  if (value == null) s = '';
  else if (Array.isArray(value)) s = value.map((v) => (v == null ? '' : String(v))).join('; ');
  else if (typeof value === 'object') s = JSON.stringify(value);
  else s = String(value);
  // Neutralize user-controlled strings that would execute as a spreadsheet
  // formula; real numbers/booleans are inert and stay verbatim.
  if (typeof value !== 'number' && typeof value !== 'boolean' && FORMULA_TRIGGER.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Join a row of already-collected values into a CSV line (with CRLF). */
export function csvRow(values: unknown[]): string {
  return values.map(csvField).join(',') + '\r\n';
}
