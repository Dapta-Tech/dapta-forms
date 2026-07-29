/**
 * Spreadsheet-paste → options parser (pure, unit-tested — no React, no I/O).
 *
 * Authors keep long option lists (industries, countries, products) in a
 * spreadsheet, usually with the qualification score in the next column.
 * Copying 1–2 columns out of Google Sheets/Excel puts TSV on the clipboard;
 * exports and hand-written lists arrive as CSV/semicolon or one-per-line.
 * This module turns any of those into `FormOption[]` rows, being tolerant
 * per row (a bad score marks THAT row, never fails the paste) so an author
 * can fix two cells instead of re-copying two hundred.
 */
import type { FormOption } from '@quill/engine';
import { slugify } from '@quill/engine';

/** Hard cap on options per question — same ceiling the editor enforces. */
export const OPTIONS_IMPORT_CAP = 200;

/** Header tokens (col 1) that mark row 1 as a header, EN + ES. */
const HEADER_WORDS = /^(option|opci[oó]n|label|etiqueta|choice|answer|respuesta|item)$/i;

export type ImportRowStatus = 'ok' | 'duplicate' | 'invalidPoints';

export interface ImportRow {
  /** 1-based line number in the pasted text (for the preview + error messages). */
  line: number;
  label: string;
  /** Parsed integer score, or null when the row carried none. */
  points: number | null;
  status: ImportRowStatus;
  /** True when a decimal score was rounded to the integer the schema stores. */
  rounded: boolean;
}

export interface ImportParseResult {
  rows: ImportRow[];
  /** Rows that will actually import (status ok, within the cap). */
  importable: ImportRow[];
  delimiter: '\t' | ';' | ',' | null;
  skippedHeader: boolean;
  /** Some line had more than two columns (extras are ignored). */
  extraColumns: boolean;
  /** The cap cut valid rows off the end. */
  truncated: boolean;
}

/**
 * Pick the column delimiter. A tab wins on a SINGLE occurrence: tabs never
 * appear inside a hand-typed label — their presence means the clipboard came
 * from a spreadsheet, where a row with an empty score cell may carry no tab at
 * all. `;`/`,` DO occur inside prose labels ("Health, wellness"), so those
 * need 80% of lines to agree before the paste is treated as two-column.
 * Null = single column (labels only, no scores).
 */
function detectDelimiter(lines: string[]): '\t' | ';' | ',' | null {
  if (lines.some((l) => l.includes('\t'))) return '\t';
  const need = Math.max(1, Math.ceil(lines.length * 0.8));
  for (const d of [';', ','] as const) {
    if (lines.filter((l) => l.includes(d)).length >= need) return d;
  }
  return null;
}

/** Parse a score cell to an integer; null = empty, NaN = invalid. */
function parseScore(raw: string): number {
  // A decimal comma only survives here on tab/semicolon pastes (on a comma
  // paste it was already a column split) — normalize it to a dot.
  return Number(raw.replace(',', '.'));
}

/**
 * Row 1 is a header when its first cell is a known header word, or when the
 * sheet clearly has a score column (some later row parses numeric there) but
 * row 1's second cell does not. A single-line paste is never a header.
 */
function isHeader(cols: string[], hasNumericBelow: boolean): boolean {
  const first = (cols[0] ?? '').trim();
  if (HEADER_WORDS.test(first)) return true;
  const second = (cols[1] ?? '').trim();
  if (second !== '' && Number.isNaN(parseScore(second)) && hasNumericBelow) return true;
  return false;
}

/**
 * Parse pasted spreadsheet text into preview rows. `existingLabels` (append
 * mode) count toward de-duplication — the paste can never re-add an option
 * the question already has. Every anomaly is a per-row status or a flag on
 * the result; parsing itself never throws.
 */
export function parseOptionsPaste(
  text: string,
  opts: { existingLabels?: string[]; cap?: number } = {},
): ImportParseResult {
  const cap = opts.cap ?? OPTIONS_IMPORT_CAP;
  const allLines = text.split(/\r?\n/);
  const lines: { n: number; text: string }[] = [];
  allLines.forEach((l, i) => {
    if (l.trim() !== '') lines.push({ n: i + 1, text: l });
  });

  const result: ImportParseResult = {
    rows: [],
    importable: [],
    delimiter: null,
    skippedHeader: false,
    extraColumns: false,
    truncated: false,
  };
  if (lines.length === 0) return result;

  const delimiter = detectDelimiter(lines.map((l) => l.text));
  result.delimiter = delimiter;
  const split = (l: string) => (delimiter ? l.split(delimiter) : [l]);

  let startAt = 0;
  if (delimiter && lines.length > 1) {
    const numericBelow = lines
      .slice(1)
      .some((l) => {
        const c = split(l.text)[1]?.trim() ?? '';
        return c !== '' && !Number.isNaN(parseScore(c));
      });
    if (isHeader(split(lines[0]!.text), numericBelow)) {
      startAt = 1;
      result.skippedHeader = true;
    }
  }

  const seen = new Set(
    (opts.existingLabels ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean),
  );

  for (let i = startAt; i < lines.length; i++) {
    const cols = split(lines[i]!.text);
    if (cols.length > 2) result.extraColumns = true;
    const label = (cols[0] ?? '').trim().slice(0, 200);
    if (!label) continue; // a delimiter-only line ("\t") carries nothing

    const row: ImportRow = { line: lines[i]!.n, label, points: null, status: 'ok', rounded: false };

    const key = label.toLowerCase();
    if (seen.has(key)) row.status = 'duplicate';
    else seen.add(key);

    const rawScore = (cols[1] ?? '').trim();
    if (rawScore !== '') {
      const num = parseScore(rawScore);
      if (Number.isNaN(num)) {
        // A duplicate row keeps its (more actionable) duplicate status.
        if (row.status === 'ok') row.status = 'invalidPoints';
      } else {
        row.points = Math.round(num);
        row.rounded = num !== row.points;
      }
    }

    result.rows.push(row);
  }

  // Cap so that existing + imported never exceeds the per-question ceiling.
  const ok = result.rows.filter((r) => r.status === 'ok');
  const allowed = Math.max(0, cap - (opts.existingLabels ?? []).length);
  result.importable = ok.slice(0, allowed);
  result.truncated = ok.length > result.importable.length;
  return result;
}

/**
 * Materialize the importable rows into `FormOption[]`. Values are slugified
 * labels, suffixed `-2`, `-3`… on collision (against BOTH the kept existing
 * options and earlier imported rows), and never contain a comma — a comma in
 * an option value is the separator in dynamic-question variant keys.
 * `append` keeps the current options (icons included); `replace` starts clean.
 */
export function buildImportedOptions(
  importable: ImportRow[],
  existing: FormOption[],
  mode: 'replace' | 'append',
): FormOption[] {
  const base = mode === 'append' ? [...existing] : [];
  const taken = new Set(base.map((o) => o.value));
  const out = [...base];
  importable.forEach((r, i) => {
    const root = slugify(r.label, `option_${i + 1}`).replace(/,/g, '');
    let value = root;
    for (let k = 2; taken.has(value); k++) value = `${root}-${k}`;
    taken.add(value);
    const option: FormOption = { label: r.label, value };
    if (r.points != null) option.points = r.points;
    out.push(option);
  });
  return out;
}
