/**
 * Which columns of the submissions table filter, and what their menus offer,
 * worked out on the server from the form and the unfiltered counts. Plain
 * data, so it crosses into the client filter controls as props.
 */
import {
  formatAnswerValue,
  isFilterableChoiceStep,
  stepLabel,
  type FormStep,
  type SubmissionFacets,
} from '@quill/engine';
import type { FilterScope } from './filters';

export interface FilterOption {
  value: string;
  label: string;
  /** Responses that chose it, over every response (before filtering). */
  count: number;
  /** Whole percent of the responses that answered the question. */
  percent: number;
}

export type FilterColumn =
  | { id: 'date' | 'status' | 'score'; kind: 'date' | 'status' | 'score'; label: string }
  | { id: string; kind: 'choice'; key: string; label: string; options: FilterOption[] };

/** A choice column's id: its question key, prefixed so it can never collide with `date`. */
export function choiceColumnId(key: string): string {
  return `q:${key}`;
}

export function filterScope(steps: FormStep[], scoring: boolean): FilterScope {
  return { choiceKeys: new Set(steps.filter(isFilterableChoiceStep).map((s) => s.key)), scoring };
}

/**
 * The filterable columns, in the table's order: the response date, the
 * status, the score when the form scores, then each choice question. A choice
 * menu lists the counts from `facets` (every option in the form's order, then
 * any stored value an option no longer carries); without facets (the Summary,
 * which only needs the labels for its chips) it lists the form's options.
 */
export function filterColumns(opts: {
  steps: FormStep[];
  scoring: boolean;
  facets: SubmissionFacets | null;
  labels: { date: string; status: string; score: string };
}): FilterColumn[] {
  const columns: FilterColumn[] = [
    { id: 'date', kind: 'date', label: opts.labels.date },
    { id: 'status', kind: 'status', label: opts.labels.status },
  ];
  if (opts.scoring) columns.push({ id: 'score', kind: 'score', label: opts.labels.score });
  for (const step of opts.steps) {
    if (!isFilterableChoiceStep(step)) continue;
    const counted = opts.facets?.choices[step.key];
    const options =
      counted ??
      (step.options ?? []).map((o) => ({
        value: o.value,
        label: formatAnswerValue(step, o.value),
        count: 0,
        percent: 0,
      }));
    columns.push({
      id: choiceColumnId(step.key),
      kind: 'choice',
      key: step.key,
      label: stepLabel(step),
      options,
    });
  }
  return columns;
}
