/**
 * Pure scoring helpers for the builder's Results + canvas point chips. Mirrors
 * the engine's scoring model (option points on qualification steps; slider-range
 * points; lead-capture never scores) to show the author the "highest possible"
 * total and per-question maxima — read-only display math, never persisted.
 */
import type { FormConfig, FormStep } from '@quill/engine';

/** The most points a single step can contribute (single = best option; multiple = all positives). */
export function maxStepPoints(step: FormStep): number {
  if (step.flowGroup === 'lead_capture') return 0;
  if (step.type === 'dropdown' || step.type === 'multiple_choice') {
    const pts = (step.options ?? []).map((o) => o.points ?? 0);
    if (pts.length === 0) return 0;
    if (step.type === 'multiple_choice' && step.selectionMode === 'multiple') {
      return pts.filter((p) => p > 0).reduce((a, b) => a + b, 0);
    }
    return Math.max(0, ...pts);
  }
  if (step.type === 'slider') {
    const pts = (step.sliderScoring ?? []).map((r) => r.points);
    return pts.length ? Math.max(0, ...pts) : 0;
  }
  return Math.max(0, step.points ?? 0);
}

/** The highest total score a respondent could reach across all scoring steps. */
export function maxScore(config: FormConfig): number {
  return config.steps.reduce((sum, s) => sum + maxStepPoints(s), 0);
}

/** Steps that actually contribute points (for the Results points panel). */
export function scoringSteps(config: FormConfig): FormStep[] {
  return config.steps.filter(
    (s) =>
      s.flowGroup !== 'lead_capture' &&
      (s.type === 'dropdown' || s.type === 'multiple_choice' || s.type === 'slider'),
  );
}
