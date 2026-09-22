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
 * score exports as `-5`, not `'-5`). A phone number in E.164 form (`+57 318...`,
 * digits and separators only) is inert too and exports raw: a `+` followed by a
 * digit and nothing but digits, spaces, dots, dashes and parentheses is a
 * number or an arithmetic sum at worst, never a function call.
 */
import {
  formatAnswerValue,
  isInputlessStep,
  nameAnswer,
  nameFields,
  stepLabel,
  type FormStep,
} from '@quill/engine';

/** Leading characters Excel/Sheets interpret as a formula trigger. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** A phone number as the form stores it: `+`, a digit, then digits and separators. */
const PHONE_NUMBER = /^\+\d[\d\s().-]*$/;

/** Escape a single CSV field (with formula-injection neutralization). */
export function csvField(value: unknown): string {
  let s: string;
  if (value == null) s = '';
  else if (Array.isArray(value)) s = value.map((v) => (v == null ? '' : String(v))).join('; ');
  else if (typeof value === 'object') s = JSON.stringify(value);
  else s = String(value);
  // Neutralize user-controlled strings that would execute as a spreadsheet
  // formula; real numbers/booleans are inert and stay verbatim.
  if (typeof value !== 'number' && typeof value !== 'boolean' && FORMULA_TRIGGER.test(s) && !PHONE_NUMBER.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Join a row of already-collected values into a CSV line (with CRLF). */
export function csvRow(values: unknown[]): string {
  return values.map(csvField).join(',') + '\r\n';
}

/** Byte order mark: without it Excel reads a UTF-8 file as Latin-1 and mangles accents. */
export const UTF8_BOM = '\uFEFF';

/** One stored submission, as far as a CSV column needs to read it. */
export interface ExportRow {
  id: string;
  data: Record<string, unknown>;
  score: number | null;
  status: string;
  /** Completion instant already rendered in the workspace zone ('' when absent). */
  submittedAt: string;
}

export interface ExportColumn {
  header: string;
  value(row: ExportRow): unknown;
}

/** The localized headers of the columns that are not questions. */
export interface ExportLabels {
  submittedAt: string;
  status: string;
  score: string;
  submissionId: string;
}

/**
 * The columns of the submissions CSV, in order: the name split in two when the
 * form has a two-field name step, every other answering step in form order
 * headed by its question, then the technical columns. Message and reveal steps
 * collect nothing and get no column. A header that repeats gets ` (2)`, ` (3)`
 * so a spreadsheet can still tell the columns apart.
 */
export function exportColumns(
  steps: FormStep[],
  opts: { scoring: boolean; labels: ExportLabels },
): ExportColumn[] {
  const answering = steps.filter((s) => !isInputlessStep(s));
  const nameStep = answering.find((s) => s.type === 'name');
  const cols: ExportColumn[] = [];

  if (nameStep) {
    const fields = nameFields(nameStep);
    if (fields.length === 2) {
      const [first, last] = fields as [string, string];
      cols.push(
        { header: 'First name', value: (r) => formatAnswerValue(nameStep, r.data[first]) },
        { header: 'Last name', value: (r) => formatAnswerValue(nameStep, r.data[last]) },
      );
    } else {
      cols.push({ header: stepLabel(nameStep), value: (r) => nameAnswer(nameStep, r.data) });
    }
  }
  for (const step of answering) {
    if (step === nameStep) continue;
    cols.push({
      header: stepLabel(step),
      value: (r) => {
        // A name step stores its sub-fields flat, never under its own key.
        if (step.type === 'name') return nameAnswer(step, r.data);
        const raw = r.data[step.key];
        // A real number stays a number so csvField keeps a negative slider
        // value as `-5` instead of neutralizing it to `'-5`.
        return typeof raw === 'number' ? raw : formatAnswerValue(step, raw);
      },
    });
  }

  cols.push(
    { header: opts.labels.submittedAt, value: (r) => r.submittedAt },
    { header: opts.labels.status, value: (r) => r.status },
  );
  if (opts.scoring) cols.push({ header: opts.labels.score, value: (r) => r.score });
  cols.push({ header: opts.labels.submissionId, value: (r) => r.id });

  // Suffix repeats, skipping any suffixed name a question already uses, so
  // `Email`, `Email`, `Email (2)` becomes `Email`, `Email (3)`, `Email (2)`.
  const taken = new Set(cols.map((c) => c.header));
  const seen = new Set<string>();
  for (const col of cols) {
    if (seen.has(col.header)) {
      let n = 2;
      while (taken.has(`${col.header} (${n})`)) n++;
      col.header = `${col.header} (${n})`;
      taken.add(col.header);
    }
    seen.add(col.header);
  }
  return cols;
}
