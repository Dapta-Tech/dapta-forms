/**
 * Pure scoring helpers for the builder's Results + canvas point chips. Mirrors
 * the engine's scoring model (option points on qualification steps; slider-range
 * points; lead-capture never scores) to show the author the "highest possible"
 * total and per-question maxima — read-only display math, never persisted.
 */
import type { FormConfig, FormStep } from '@quill/engine';
import { sliderRangeUnreachable } from '@quill/engine';

/**
 * The most points a single step can contribute (single = best option; multiple =
 * all positives) — counting only what the RUNTIME can actually award.
 *
 * The builder used to answer a different question than the engine: it summed
 * every configured point, including steps the engine never scores. That made
 * "Highest possible" a number no respondent could reach, and sized the outcome
 * bar to it — so an author could set a top bucket that was silently dead.
 * Excluded here for the same reasons `computeScore` excludes them:
 *  - `hidden` steps are skipped by `visibleSteps`, so they never score even
 *    though their answer is captured and stored;
 *  - a scoring range that `sliderRangeUnreachable` already flags can never match.
 */
export function maxStepPoints(step: FormStep): number {
  if (step.flowGroup === 'lead_capture') return 0;
  if (step.scoringEnabled === false) return 0; // per-question opt-out (V5-B2)
  if (step.hidden) return 0; // never walked ⇒ never scored (engine visibleSteps)
  if (step.type === 'dropdown' || step.type === 'multiple_choice') {
    const pts = (step.options ?? []).map((o) => o.points ?? 0);
    if (pts.length === 0) return 0;
    if (step.type === 'multiple_choice' && step.selectionMode === 'multiple') {
      return pts.filter((p) => p > 0).reduce((a, b) => a + b, 0);
    }
    return Math.max(0, ...pts);
  }
  if (step.type === 'slider') {
    const pts = (step.sliderScoring ?? [])
      .filter((r) => !sliderRangeUnreachable(step, r))
      .map((r) => r.points);
    return pts.length ? Math.max(0, ...pts) : 0;
  }
  return Math.max(0, step.points ?? 0);
}

/** The highest total score reachable across a list of steps (option/slider
 *  points summed). Shared by {@link maxScore} and the builder's per-question
 *  scoring hint, which receives the steps array but not the whole config. */
export function maxScoreForSteps(steps: FormStep[]): number {
  return steps.reduce((sum, s) => sum + maxStepPoints(s), 0);
}

/** The highest total score a respondent could reach across all scoring steps. */
export function maxScore(config: FormConfig): number {
  return maxScoreForSteps(config.steps);
}

/** Steps that actually contribute points (for the Results points panel). */
export function scoringSteps(config: FormConfig): FormStep[] {
  return config.steps.filter(
    (s) =>
      s.flowGroup !== 'lead_capture' &&
      // A hidden step contributes nothing, so listing it among "the questions
      // that score" invited exactly the misconfiguration it enables.
      !s.hidden &&
      (s.type === 'dropdown' || s.type === 'multiple_choice' || s.type === 'slider'),
  );
}
