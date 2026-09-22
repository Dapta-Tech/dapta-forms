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

/** `2026-09-03T14:30:00.000Z` → `2026-09-03 14:30 UTC`; anything else verbatim. */
function formatBooking(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
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
 * their labels, a multi-select joined with `separator` (`; ` by default, the
 * spreadsheet convention), an uploaded file as its name only, a booking as a
 * UTC timestamp, and every string trimmed. Blank answers come back as `""`.
 *
 * A `name` step stores its sub-fields flat, never under its own key: read it
 * with `nameAnswer`, not with this.
 */
export function formatAnswerValue(
  step: FormStep,
  value: unknown,
  separator = "; ",
): string {
  if (value == null) return "";
  if (Array.isArray(value))
    return value
      .filter((v) => v != null && String(v).trim())
      .map((v) => optionLabel(step, String(v).trim()).trim())
      .join(separator);
  if (typeof value === "string") {
    if (step.type === "scheduler") return formatBooking(value.trim());
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
      value = formatAnswerValue(step, raw, ", ");
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
