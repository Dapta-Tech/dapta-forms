import type { SubmissionView } from '@quill/types';
import {
  formatAnswerCell,
  formatAnswerValue,
  nameAnswer,
  parseFileAnswer,
  resolveQuestion,
  type Answers,
  type FormStep,
} from '@quill/engine';
import { formatDateTime, type Locale } from '@quill/shared';

/**
 * One answer as the side panel shows it. The table squeezes every answer into
 * one truncated line; the panel is where it is read in full, so each kind keeps
 * the shape that makes it readable: long text with its line breaks, options as
 * separate chips, a URL as a link, a file as the preview control.
 */
export type AnswerView =
  | { key: string; label: string; kind: 'empty' }
  | { key: string; label: string; kind: 'text'; text: string; long: boolean }
  | { key: string; label: string; kind: 'choices'; choices: string[] }
  | { key: string; label: string; kind: 'link'; href: string; text: string }
  | { key: string; label: string; kind: 'file'; name: string };

/** One response, already formatted on the server: the client only lays it out. */
export interface ResponseDetail {
  id: string;
  completed: boolean;
  /** The latest instant known (completed, else partial, else started), as the table shows it. */
  submittedAt: string;
  startedAt: string;
  /** Null when the form does not score, so the panel has no Score row to hide. */
  score: number | null;
  answers: AnswerView[];
  /** The `utm_*` parameters the respondent arrived with, in capture order. */
  utm: Array<[string, string]>;
  /**
   * Who answered, when the form asked: the first name step and the first email
   * step. The panel is titled with them, the way a CRM record is titled with
   * the contact rather than with "Response".
   */
  respondent: { name: string | null; email: string | null };
}

/** A text answer this long, or with a line break, reads as a paragraph rather than a value. */
const LONG_TEXT = 80;

/** Only a web address becomes a link: a stored `javascript:` stays inert text. */
const WEB_URL = /^https?:\/\//i;

/**
 * The panel's view of one answering step. `steps` must already exclude the
 * steps that collect nothing (message, reveal), exactly like the table columns.
 *
 * The question is resolved for THIS respondent (`resolveQuestion`): a step with
 * variants shows the wording that person actually read, and `[field]` tokens are
 * filled with their answers. The table header cannot do that, since one column
 * serves every row; the panel can.
 */
export function answerView(
  step: FormStep,
  data: Record<string, unknown>,
  timeZone: string,
): AnswerView {
  const key = step.key;
  const label = resolveQuestion(step, data as Answers).trim() || step.key;

  // A name step stores its sub-fields flat (firstname, lastname), never under its key.
  if (step.type === 'name') {
    const text = nameAnswer(step, data);
    return text ? { key, label, kind: 'text', text, long: false } : { key, label, kind: 'empty' };
  }

  const raw = data[step.key];

  if (step.type === 'file') {
    const file = parseFileAnswer(raw as never);
    return file ? { key, label, kind: 'file', name: file.name } : { key, label, kind: 'empty' };
  }

  if ((step.type === 'multiple_choice' || step.type === 'dropdown') && raw != null) {
    const tokens = Array.isArray(raw) ? raw : [raw];
    const choices = tokens
      .map((t) => formatAnswerValue(step, t == null ? null : String(t)))
      .filter((c) => c.length > 0);
    return choices.length > 0
      ? { key, label, kind: 'choices', choices }
      : { key, label, kind: 'empty' };
  }

  const text = formatAnswerCell(step, raw, { timeZone });
  if (!text) return { key, label, kind: 'empty' };
  if (step.type === 'url' && WEB_URL.test(text))
    return { key, label, kind: 'link', href: text, text };
  const long = step.type === 'textarea' || text.includes('\n') || text.length > LONG_TEXT;
  return { key, label, kind: 'text', text, long };
}

/** The `utm` map riding inside the answers, as ordered string pairs. */
function utmPairs(data: Record<string, unknown>): Array<[string, string]> {
  const utm = data.utm;
  if (utm == null || typeof utm !== 'object' || Array.isArray(utm)) return [];
  return Object.entries(utm as Record<string, unknown>).filter(
    (e): e is [string, string] => typeof e[1] === 'string' && e[1].trim().length > 0,
  );
}

export function buildResponseDetail(
  row: SubmissionView,
  steps: FormStep[],
  opts: { locale: Locale; timeZone: string; scoring: boolean },
): ResponseDetail {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const when = row.completedAt ?? row.partialAt ?? row.startedAt;
  const at = (ms: number) => formatDateTime(ms, { locale: opts.locale, timeZone: opts.timeZone });
  const answers = steps.map((s) => answerView(s, data, opts.timeZone));
  /** The text of the first answered step of this type, if any. */
  const firstText = (type: FormStep['type']): string | null => {
    for (let i = 0; i < steps.length; i++) {
      const a = answers[i]!;
      if (steps[i]!.type === type && a.kind === 'text') return a.text;
    }
    return null;
  };
  return {
    id: row.id,
    completed: row.completedAt != null,
    submittedAt: at(when),
    startedAt: at(row.startedAt),
    score: opts.scoring ? row.score : null,
    answers,
    utm: utmPairs(data),
    respondent: { name: firstText('name'), email: firstText('email') },
  };
}
