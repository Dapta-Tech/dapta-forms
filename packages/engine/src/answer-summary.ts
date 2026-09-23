/**
 * A submission's answers as the owner reads them: one `{label, value}` row per
 * answered question, in step order, with option values mapped back to their
 * labels and the question text resolved exactly as the respondent saw it.
 *
 * Pure and framework-free so the API can build it and hand plain rows to the
 * notifications package (which stays independent of the engine). Nothing here
 * escapes HTML: the email renderer owns that boundary.
 */
import {
  isInputlessStep,
  nameAnswer,
  parseFileAnswer,
  resolveQuestion,
  type Answers,
  type AnswerValue,
  type FormConfig,
  type FormStep,
} from "./form-logic";

/** One answered question, ready to print. */
export interface AnswerSummaryRow {
  label: string;
  value: string;
}

/** Longest value an email row carries; a pasted essay must not become the email. */
export const ANSWER_VALUE_MAX = 2000;

function isBlank(value: AnswerValue): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Map one raw token to its option label (an unknown token stays as typed). */
function optionLabel(step: FormStep, token: string): string {
  const match = (step.options ?? []).find((o) => o.value === token);
  return match ? match.label : token;
}

/**
 * `2026-09-03T14:30:00.000Z` → `2026-09-03 14:30 UTC`, or read in `timeZone`
 * with its offset (`2026-09-03 09:30 GMT-5`). An unknown zone falls back to
 * UTC; anything that is not a timestamp stays verbatim.
 */
function formatBooking(value: string, timeZone?: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZoneName: "shortOffset",
      }).formatToParts(new Date(ms));
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${get("timeZoneName")}`;
    } catch {
      // Unknown zone: fall through to UTC rather than fail the row.
    }
  }
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** How `formatAnswerValue` prints what has more than one reading. */
export interface AnswerFormatOptions {
  /** Joins a multi-select. Default `; `, the spreadsheet convention. */
  separator?: string;
  /** IANA zone a booking is read in. Default UTC. */
  timeZone?: string;
}

/**
 * The header a step carries in a table or a spreadsheet: its question as
 * configured (trimmed, markdown kept, `[field]` tokens left as written, since a
 * column serves every respondent), or the step key when the question is empty.
 */
export function stepLabel(step: Pick<FormStep, "key" | "question">): string {
  return (step.question ?? "").trim() || step.key;
}

/**
 * One stored answer as the text a person reads: option values mapped back to
 * their labels, a multi-select joined with `opts.separator` (`; ` by default,
 * the spreadsheet convention), an uploaded file as its name only, a booking as
 * a timestamp in `opts.timeZone` (UTC by default), and every string trimmed.
 * Blank answers come back as `""`.
 *
 * A `name` step stores its sub-fields flat, never under its own key: read it
 * with `nameAnswer`, not with this.
 */
export function formatAnswerValue(
  step: FormStep,
  value: unknown,
  opts: AnswerFormatOptions = {},
): string {
  const separator = opts.separator ?? "; ";
  if (value == null) return "";
  if (Array.isArray(value))
    return value
      .filter((v) => v != null && String(v).trim())
      .map((v) => optionLabel(step, String(v).trim()).trim())
      .join(separator);
  if (typeof value === "string") {
    if (step.type === "scheduler")
      return formatBooking(value.trim(), opts.timeZone);
    if (step.type === "multiple_choice" || step.type === "dropdown")
      return optionLabel(step, value.trim()).trim();
    return value.trim();
  }
  if (typeof value === "object") {
    // An uploaded file prints as its name and nothing else. The generic object
    // branch below would join every field, which would put the object key into
    // the owner's email and into the CSV. The key is not secret, but a link
    // built from it would be, and a summary row is the wrong place for either.
    const file = parseFileAnswer(value as AnswerValue);
    if (file) return file.name.trim();
    return Object.values(value)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim())
      .join(" ");
  }
  return String(value);
}

/**
 * One answer as a table or spreadsheet cell: `formatAnswerValue`, except that
 * a boolean reads as a check (`✓`) or nothing, the way the submissions table
 * has always shown it. The admin table and the CSV export both use this, so
 * the screen and the download agree.
 */
export function formatAnswerCell(
  step: FormStep,
  value: unknown,
  opts: AnswerFormatOptions = {},
): string {
  if (typeof value === "boolean") return value ? "\u2713" : "";
  return formatAnswerValue(step, value, opts);
}

/** The answered rows of `answers`, in step order. Unanswered steps are omitted. */
export function summarizeAnswers(
  config: FormConfig,
  answers: Answers,
): AnswerSummaryRow[] {
  const rows: AnswerSummaryRow[] = [];
  for (const step of config.steps) {
    if (isInputlessStep(step)) continue;
    let value: string;
    if (step.type === "name") {
      value = nameAnswer(step, answers);
      if (!value) continue;
    } else {
      const raw = answers[step.key];
      if (isBlank(raw)) continue;
      value = formatAnswerValue(step, raw, { separator: ", " });
      if (!value) continue;
    }
    const question = resolveQuestion(step, answers).trim();
    rows.push({
      label: question || step.key,
      value: value.slice(0, ANSWER_VALUE_MAX),
    });
  }
  return rows;
}
