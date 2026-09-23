/**
 * The submissions Summary: one card per answering step, the way Typeform's
 * "Summary" reads a form. What an owner used to rebuild by hand in a
 * spreadsheet after downloading the CSV: how many people picked each option,
 * the average of a scale, the latest things people wrote.
 *
 * Pure and framework-free: the API hands it the rows it read (already narrowed
 * by the same status and date filter as the table) and serves the result, so
 * the numbers describe exactly the set of responses the filter describes.
 * Labels come from the stored values through the same helpers the table and
 * the CSV use, so the three never disagree about what an answer says.
 */
import { formatAnswerValue, stepLabel } from './answer-summary';
import {
  isInputlessStep,
  nameAnswer,
  nameFields,
  parseFileAnswer,
  type AnswerValue,
  type FormStep,
} from './form-logic';

/** One response as the summary needs it. `at` is the instant the table shows for it. */
export interface SummaryRow {
  id: string;
  data: Record<string, unknown>;
  /** Completed, else partial, else started (epoch ms). */
  at: number;
}

/** One answer to a text question, with who wrote it and when. */
export interface SummaryAnswer {
  id: string;
  text: string;
  /** The response's first answered name, else email, else phone; null when the form asked none. */
  respondent: string | null;
  at: number;
}

export interface SummaryOption {
  value: string;
  label: string;
  count: number;
  /** Whole percent of the people who answered this question. */
  percent: number;
}

/** One bar of a scale's distribution: a single value (`from === to`) or a range of them. */
export interface SummaryBucket {
  from: number;
  to: number;
  count: number;
  percent: number;
}

interface QuestionBase {
  key: string;
  type: FormStep['type'];
  /** The question as configured, or the key when it is empty. */
  label: string;
  /** Responses that answered this question. */
  answered: number;
  /** Responses in the set being summarized (the "of 30"). */
  total: number;
}

export type QuestionSummary =
  | (QuestionBase & {
      kind: 'choice';
      /** People could pick several, so the percentages can add up to more than 100. */
      multiple: boolean;
      /** Most chosen first; ties keep the form's order. Unchosen options stay, at zero. */
      options: SummaryOption[];
    })
  | (QuestionBase & {
      kind: 'scale';
      /** One decimal; null when nobody answered. */
      average: number | null;
      unit: string | null;
      buckets: SummaryBucket[];
    })
  | (QuestionBase & {
      kind: 'text';
      /** The latest answers, newest first. */
      recent: SummaryAnswer[];
    })
  | (QuestionBase & { kind: 'count' });

export interface SubmissionsSummary {
  total: number;
  questions: QuestionSummary[];
}

/** Types whose answers are read as text, and searched one question at a time. */
const TEXT_TYPES = new Set<FormStep['type']>(['text', 'textarea', 'name', 'email', 'phone', 'url']);

/** How many latest answers a text card shows before "Show more". */
export const SUMMARY_RECENT = 5;

/** A scale with more distinct answers than this is drawn as ranges instead of one bar per value. */
const MAX_VALUE_BARS = 10;

/** Whether a step's answers are free text, searchable from its Summary card. */
export function isTextSummaryStep(step: Pick<FormStep, 'type'>): boolean {
  return TEXT_TYPES.has(step.type);
}

/**
 * The answer keys a text step's value is stored under: its own key, or a name
 * step's sub-fields (firstname, lastname), which are stored flat.
 */
export function summaryAnswerFields(step: FormStep): string[] {
  return nameFields(step);
}

/** One step's answer as text, or `""` when unanswered. */
function answerText(step: FormStep, data: Record<string, unknown>): string {
  if (step.type === 'name') return nameAnswer(step, data);
  return formatAnswerValue(step, data[step.key]);
}

/**
 * Who answered, by the same rule as the response panel's title: the first
 * answered name step, else email, else phone.
 */
export function summaryRespondent(steps: FormStep[], data: Record<string, unknown>): string | null {
  for (const type of ['name', 'email', 'phone'] as const) {
    for (const step of steps) {
      if (step.type !== type) continue;
      const text = answerText(step, data);
      if (text) return text;
    }
  }
  return null;
}

/** One response's answer to a text step, as a Summary card lists it (null when unanswered). */
export function summaryAnswer(
  steps: FormStep[],
  step: FormStep,
  row: SummaryRow,
): SummaryAnswer | null {
  const text = answerText(step, row.data);
  if (!text) return null;
  return { id: row.id, text, respondent: summaryRespondent(steps, row.data), at: row.at };
}

function percentOf(count: number, of: number): number {
  return of > 0 ? Math.round((count / of) * 100) : 0;
}

/** The non-blank option tokens of one choice answer (a single value or a multi-select array). */
function choiceTokens(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return list.map((v) => (v == null ? '' : String(v).trim())).filter((v) => v.length > 0);
}

function summarizeChoice(step: FormStep, rows: SummaryRow[]) {
  const counts = new Map<string, number>();
  for (const o of step.options ?? []) counts.set(o.value, 0);
  let answered = 0;
  for (const row of rows) {
    // A token counted once per response, even if a stored array repeats it.
    const tokens = [...new Set(choiceTokens(row.data[step.key]))];
    if (tokens.length === 0) continue;
    answered++;
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  // Map order is the form's option order, then any stored value no option
  // carries any more (a removed option), which keeps its raw value as label.
  const options = [...counts.entries()]
    .map(([value, count], order) => ({
      value,
      label: formatAnswerValue(step, value),
      count,
      percent: percentOf(count, answered),
      order,
    }))
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .map(({ order: _order, ...o }) => o);
  const multiple = step.type === 'multiple_choice' && step.selectionMode === 'multiple';
  return { answered, multiple, options };
}

/** A slider answer as a number: stored as a number, or as its text. */
function scaleValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Two decimals at most, so a range bound never prints as 12.300000000000001. */
const tidy = (n: number) => Math.round(n * 100) / 100;

function scaleBuckets(step: FormStep, values: number[]): SummaryBucket[] {
  if (values.length === 0) return [];
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  if (distinct.length <= MAX_VALUE_BARS) {
    return distinct.map((v) => {
      const count = values.filter((x) => x === v).length;
      return { from: v, to: v, count, percent: percentOf(count, values.length) };
    });
  }
  // Too many values for one bar each: MAX_VALUE_BARS equal ranges over the
  // slider's own bounds (widened to any stored value outside them), so the
  // shape reads the same whatever the answers were.
  const lo = Math.min(step.min ?? distinct[0]!, distinct[0]!);
  const hi = Math.max(step.max ?? distinct[distinct.length - 1]!, distinct[distinct.length - 1]!);
  const integers = values.every(Number.isInteger) && Number.isInteger(lo) && Number.isInteger(hi);
  const width = integers ? Math.ceil((hi - lo + 1) / MAX_VALUE_BARS) : (hi - lo) / MAX_VALUE_BARS;
  const buckets: SummaryBucket[] = [];
  for (let i = 0; i < MAX_VALUE_BARS; i++) {
    const from = lo + i * width;
    if (from > hi) break;
    const to = integers
      ? Math.min(hi, from + width - 1)
      : i === MAX_VALUE_BARS - 1
        ? hi
        : from + width;
    buckets.push({ from: tidy(from), to: tidy(to), count: 0, percent: 0 });
  }
  for (const v of values) {
    const i = Math.min(buckets.length - 1, Math.floor((v - lo) / width));
    buckets[i]!.count++;
  }
  for (const b of buckets) b.percent = percentOf(b.count, values.length);
  return buckets;
}

function summarizeScale(step: FormStep, rows: SummaryRow[]) {
  const values = rows
    .map((r) => scaleValue(r.data[step.key]))
    .filter((v): v is number => v != null);
  const average =
    values.length > 0
      ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
      : null;
  const unit = step.sliderUnitLabel?.trim() || null;
  return { answered: values.length, average, unit, buckets: scaleBuckets(step, values) };
}

/** Whether a file or booking step was answered. */
function isCounted(step: FormStep, value: unknown): boolean {
  if (step.type === 'file') return parseFileAnswer(value as AnswerValue) != null;
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Summarize `rows` question by question, in form order. `rows` must be newest
 * first (the order the table lists them in): a text card's latest answers are
 * the first ones that answered it. Message and reveal steps collect nothing and
 * get no card, as they get no column.
 */
export function summarizeSubmissions(
  steps: FormStep[],
  rows: SummaryRow[],
  opts: { recent?: number } = {},
): SubmissionsSummary {
  const recentMax = opts.recent ?? SUMMARY_RECENT;
  const answering = steps.filter((s) => !isInputlessStep(s));
  const total = rows.length;
  const questions = answering.map((step): QuestionSummary => {
    const base = { key: step.key, type: step.type, label: stepLabel(step), total };
    if (step.type === 'multiple_choice' || step.type === 'dropdown')
      return { ...base, kind: 'choice', ...summarizeChoice(step, rows) };
    if (step.type === 'slider') return { ...base, kind: 'scale', ...summarizeScale(step, rows) };
    if (step.type === 'file' || step.type === 'scheduler') {
      const answered = rows.filter((r) => isCounted(step, r.data[step.key])).length;
      return { ...base, kind: 'count', answered };
    }
    // Text, and any type added later: read as text, like the table does.
    const recent: SummaryAnswer[] = [];
    let answered = 0;
    for (const row of rows) {
      const hit = summaryAnswer(answering, step, row);
      if (!hit) continue;
      answered++;
      if (recent.length < recentMax) recent.push(hit);
    }
    return { ...base, kind: 'text', answered, recent };
  });
  return { total, questions };
}
