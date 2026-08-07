/**
 * Shared logic helpers for the builder. The inline rule editor authors a
 * question's FORWARD `goto` rules (jump to a later question / skip to the end);
 * the declarative `showWhen`/`hideWhen` conditions still work (honored by the
 * engine, drawn on the map) and count toward a question's rule total.
 */
import { SCORE_FIELD, type FormStep } from '@quill/engine';
import type { GotoRule } from '@quill/engine';
import { isInputlessType } from './question-types';

/** How many logic rules a question carries (goto jumps + show/hide conditions). */
export function ruleCount(step: FormStep): number {
  return (step.goto?.length ?? 0) + (step.showWhen ? 1 : 0) + (step.hideWhen ? 1 : 0);
}

/* ── The `goto` vocabulary ─────────────────────────────────────────────────
 * One home for reading and writing a step's `goto` array, because four
 * surfaces author it (this question's Logic dialog, the form-wide Branching
 * dialog, the scheduler panel's After-a-booking picker) and five more draw it
 * (canvas, list, spine badge, settings card, dialogs). Divergence here is not
 * cosmetic: the engine takes the FIRST matching rule, so a catch-all written
 * anywhere but last swallows every rule below it.
 * -------------------------------------------------------------------------- */

/** Sentinel select value for "end the form" (a `target: null` catch-all). */
export const GOTO_END = '__end__';
/** Sentinel select value for "no catch-all at all" — continue in order. */
export const GOTO_NEXT = '';

/**
 * Does this step record an answer?
 *
 * The whole `goto` machinery hangs off this. `resolveGoto` matches a rule
 * against the step's OWN answer — `got.has(v)` for a value rule, `got.size > 0`
 * for the `*` catch-all — so on a step that collects nothing, NO rule can ever
 * fire, whatever it says. A message and a reveal are exactly those steps.
 */
export function stepRecordsAnswer(step: FormStep): boolean {
  return !isInputlessType(step.type);
}

/** Can a catch-all ever fire here? Same question, narrower name. */
export const catchAllFires = stepRecordsAnswer;

/**
 * The `goto` rules that can actually run. On a step that records no answer
 * that is none of them — such rules are dead config and must not colour a
 * border, raise a badge, draw an edge or print a sentence, because each of
 * those advertises routing the respondent will never take.
 *
 * They are IGNORED, never stripped: silently rewriting an author's stored
 * config on open is worse than declining to draw it.
 */
export function liveGotoRules(step: FormStep): GotoRule[] {
  return stepRecordsAnswer(step) ? (step.goto ?? []) : [];
}

/** {@link ruleCount} minus the rules that can never fire. */
export function liveRuleCount(step: FormStep): number {
  return liveGotoRules(step).length + (step.showWhen ? 1 : 0) + (step.hideWhen ? 1 : 0);
}

/**
 * A step's `goto` split into the parts each control owns. The catch-all comes
 * back only when it can fire; every `*` rule is stripped from `valueRules`
 * regardless, so a rule editor can never render `*` as an answer value.
 */
export function splitGoto(step: FormStep): { valueRules: GotoRule[]; catchAll: GotoRule | undefined } {
  const rules = step.goto ?? [];
  const found = rules.find((r) => r.values.includes('*'));
  return {
    valueRules: rules.filter((r) => !r.values.includes('*')),
    catchAll: found && catchAllFires(step) ? found : undefined,
  };
}

/** Read a catch-all back into an Always-go-to select. */
export function alwaysValueOf(catchAll: GotoRule | undefined): string {
  return !catchAll ? GOTO_NEXT : (catchAll.target ?? GOTO_END);
}

/** Rebuild `goto` from its parts — value rules first, catch-all LAST. */
export function buildGoto(valueRules: GotoRule[], always: string): GotoRule[] | undefined {
  const all: GotoRule[] = [...valueRules];
  if (always !== GOTO_NEXT) all.push({ values: ['*'], target: always === GOTO_END ? null : always });
  return all.length ? all : undefined;
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
