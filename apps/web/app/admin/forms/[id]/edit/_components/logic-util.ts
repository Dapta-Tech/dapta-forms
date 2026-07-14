/**
 * Shared logic helpers for the builder. The inline rule editor authors a
 * question's FORWARD `goto` rules (jump to a later question / skip to the end);
 * the declarative `showWhen`/`hideWhen` conditions still work (honored by the
 * engine, drawn on the map) and count toward a question's rule total.
 */
import type { FormStep } from '@quill/engine';

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
