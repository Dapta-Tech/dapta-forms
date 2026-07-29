/**
 * Shared logic helpers for the builder. The inline rule editor authors a
 * question's FORWARD `goto` rules (jump to a later question / skip to the end);
 * the declarative `showWhen`/`hideWhen` conditions still work (honored by the
 * engine, drawn on the map) and count toward a question's rule total.
 */
import { SCORE_FIELD, type FormStep } from '@quill/engine';

/** How many logic rules a question carries (goto jumps + show/hide conditions). */
export function ruleCount(step: FormStep): number {
  return (step.goto?.length ?? 0) + (step.showWhen ? 1 : 0) + (step.hideWhen ? 1 : 0);
}

/** A later question a `goto` rule can jump to (only forward targets are valid). */
export interface JumpTarget {
  key: string;
  label: string;
}

/** The forward jump targets for the step at `index` (every later step). */
export function jumpTargetsAfter(steps: FormStep[], index: number, fallback: string): JumpTarget[] {
  return steps
    .slice(index + 1)
    .map((s, i) => ({ key: s.key, label: s.question?.trim() || `${fallback} ${index + i + 2}` }));
}

/** The human label for an option value on a choice/dropdown step (falls back to the raw value). */
export function optionLabel(step: FormStep, value: string): string {
  return (step.options ?? []).find((o) => o.value === value)?.label ?? value;
}

/** The pieces of a condition, ready to render as "«Budget» is greater than 500". */
export interface DescribedCondition {
  /** The referenced question's title (or its raw key when it no longer exists). */
  field: string;
  /** The localized comparison ("is any of", "is greater than", "is between"). */
  operator: string;
  /** The operand(s), already resolved to option LABELS where applicable. */
  operand: string;
  /** True when the referenced field is missing — the rule can never hold. */
  dangling: boolean;
}

/**
 * Turn a `showWhen`/`hideWhen` condition into readable parts (V5-B4).
 *
 * The Logic view used to summarize any condition as the single word
 * "Conditional", which tells you a rule exists and nothing about what it says —
 * so the one view meant for understanding the flow was the one place you could
 * not read it. Resolving the field to its QUESTION TITLE and the values to their
 * OPTION LABELS matters: the stored config holds keys and raw values, which are
 * not what the author typed or recognizes.
 */
export function describeCondition(
  cond: { field: string; op?: string; values?: string[]; value?: number; min?: number; max?: number },
  steps: FormStep[],
  labels: {
    fallbackQuestion: (index: number) => string;
    opIn: string;
    opEq: string;
    opGt: string;
    opLt: string;
    opBetween: string;
    /** Joins the two operands of `between`, e.g. "and". */
    and: string;
    /** Shown in place of an operand the author has not filled in yet. */
    blank: string;
    /** Name for the reserved running-score source. */
    score: string;
  },
): DescribedCondition {
  // The running score is a reserved source, not a question — resolving it
  // against `steps` would find nothing and mark a valid rule as dangling.
  const onScore = cond.field === SCORE_FIELD;
  const sourceIndex = onScore ? -1 : steps.findIndex((s) => s.key === cond.field);
  const source = sourceIndex >= 0 ? steps[sourceIndex] : undefined;
  const field = onScore
    ? labels.score
    : source
      ? source.question?.trim() || labels.fallbackQuestion(sourceIndex)
      : cond.field;
  const dangling = !onScore && !source;

  const num = (n: number | undefined): string => (n == null ? labels.blank : String(n));
  switch (cond.op) {
    case 'eq':
      return { field, operator: labels.opEq, operand: num(cond.value), dangling };
    case 'gt':
      return { field, operator: labels.opGt, operand: num(cond.value), dangling };
    case 'lt':
      return { field, operator: labels.opLt, operand: num(cond.value), dangling };
    case 'between':
      return {
        field,
        operator: labels.opBetween,
        operand: `${num(cond.min)} ${labels.and} ${num(cond.max)}`,
        dangling,
      };
    default: {
      // `in` (or an absent op, which the engine treats as `in`).
      const values = cond.values ?? [];
      const operand = values.length
        ? values.map((v) => (source ? optionLabel(source, v) : v)).join(', ')
        : labels.blank;
      return { field, operator: labels.opIn, operand, dangling };
    }
  }
}

/**
 * Vertical layout: reveal cards live at the END of the list — on a one-page
 * form a reveal plays once, after Submit, never between questions, so a card
 * sitting mid-list would promise an interstitial that never happens there.
 * Every steps mutation in the editor funnels through this on vertical (add,
 * reorder, switching the layout) so the list always tells the truth.
 * Returns the SAME array when nothing needs to move (callers use identity to
 * know whether anything changed — e.g. to avoid dirtying an untouched form).
 */
export function anchorRevealsLast(steps: FormStep[]): FormStep[] {
  const reveals = steps.filter((s) => s.type === 'reveal');
  if (reveals.length === 0) return steps;
  const anchored = [...steps.filter((s) => s.type !== 'reveal'), ...reveals];
  return anchored.every((s, i) => s === steps[i]) ? steps : anchored;
}
