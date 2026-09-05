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
  nameFields,
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

function formatValue(step: FormStep, value: AnswerValue): string {
  if (Array.isArray(value))
    return value.map((v) => optionLabel(step, v)).join(", ");
  if (typeof value === "string") {
    if (step.type === "scheduler") return formatBooking(value.trim());
    if (step.type === "multiple_choice" || step.type === "dropdown")
      return optionLabel(step, value.trim());
    return value.trim();
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value)
      .filter((v) => typeof v === "string" && v.trim())
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
      value = nameFields(step)
        .map((field) => answers[field])
        .filter(
          (v): v is string => typeof v === "string" && v.trim().length > 0,
        )
        .map((v) => v.trim())
        .join(" ");
      if (!value) continue;
    } else {
      const raw = answers[step.key];
      if (isBlank(raw)) continue;
      value = formatValue(step, raw);
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
