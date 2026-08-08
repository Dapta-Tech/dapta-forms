'use client';

import type { FormConfig, FormOption, FormStep, SliderScoringRange } from '@quill/engine';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/cn';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';
import { NumberField } from './fields';
import { iconForStep } from './question-types';
import { maxScore, maxStepPoints, scoringSteps } from './scoring-util';
import { SliderScoringEditor } from './slider-scoring-editor';
import { tb } from './builder-messages';
import type { BuilderMessages } from './builder-messages';
import type { EditorMessages } from './messages';

/**
 * The FORM-WIDE scoring editor (F3b).
 *
 * Points are editable in exactly one place today — question by question, inside
 * the Build panel's option editor — and the only form-wide view of them (the
 * Results tab's `PointsCard`) is READ-ONLY. So "what are all my point values?"
 * costs one click per question, and "make every 'Enterprise' worth 3" costs one
 * click per question again. This dialog is that table, editable in one scroll:
 * the same cards, the same per-question toggle, with the points as inputs.
 *
 * Points are INTEGERS and may be NEGATIVE — the real forms use −2 … +3, so
 * nothing here clamps to positives. What it does guard is a non-finite value
 * reaching the config: `Number("")`, `Number("-")` and `Number("1e999")` are all
 * things a keyboard produces mid-typing, and one of them landing in `points`
 * fails schema validation and takes the WHOLE form's autosave down until it is
 * undone (the same failure `results-view.tsx` documents on `minScore`).
 */
export function ScoringDialog({
  open,
  onClose,
  config,
  onScoringChange,
  onStepScoringChange,
  onStepPatch,
  bm,
  em,
}: {
  open: boolean;
  onClose: () => void;
  config: FormConfig;
  /** The FORM-level scoring switch (mirrors `ResultsView`). */
  onScoringChange: (enabled: boolean) => void;
  /** Toggle ONE question's contribution, by its index in `config.steps`. */
  onStepScoringChange: (stepIndex: number, on: boolean) => void;
  /** Per-step patch — maps straight onto the editor's `patchStep(index, patch)`. */
  onStepPatch: (stepIndex: number, patch: Partial<FormStep>) => void;
  bm: BuilderMessages;
  em: EditorMessages;
}) {
  const enabled = config.scoring?.enabled !== false;
  const top = maxScore(config);
  const questions = scoringSteps(config);
  // Real question numbers: each scoring step's position in the FULL step list,
  // so a scored slider at question 5 reads "5" — not its index in the filtered
  // list. Reference identity holds (filter does not clone the steps).
  const stepIndex = new Map<FormStep, number>(config.steps.map((s, i) => [s, i]));

  return (
    <Modal open={open} onClose={onClose} title={bm.scoring.title} labelId="scoring-dialog-title" size="xl">
      <div data-testid="scoring-dialog" className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{bm.scoring.subtitle}</p>
            <p data-testid="scoring-total" className="mt-1 text-xs font-medium tabular-nums text-foreground">
              {enabled ? tb(bm.results.pointsHint, { n: top }) : bm.results.pointsHintOff}
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={onScoringChange}
            aria-label={bm.results.enableScoring}
            data-testid="scoring-dialog-toggle"
          />
        </div>

        {/* Scoring off: the points are STILL SHOWN, inert, with the reason.
            Hiding a table of numbers the author typed reads as data loss — the
            same argument `results-view.tsx` makes for the outcome ranges. */}
        {!enabled ? (
          <p
            data-testid="scoring-inert"
            className="flex items-start gap-2 rounded-xl border border-dashed border-border p-4 text-sm leading-relaxed text-muted-foreground"
          >
            <i aria-hidden className="pi pi-info-circle mt-0.5 shrink-0 text-secondary" style={{ fontSize: 13 }} />
            {bm.scoring.inert}
          </p>
        ) : null}

        {questions.length === 0 ? (
          <p
            data-testid="scoring-empty"
            className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
          >
            {bm.results.noQuestions}
          </p>
        ) : (
          <fieldset
            disabled={!enabled}
            className={cn(
              'flex max-h-[62vh] flex-col gap-3 overflow-y-auto border-0 p-0 pr-1',
              !enabled && 'pointer-events-none select-none opacity-40',
            )}
          >
            {questions.map((q) => {
              const index = stepIndex.get(q) ?? 0;
              return (
                <PointsCard
                  key={q.key}
                  step={q}
                  index={index}
                  onScoringChange={(on) => onStepScoringChange(index, on)}
                  onPatch={(patch) => onStepPatch(index, patch)}
                  bm={bm}
                  em={em}
                />
              );
            })}
          </fieldset>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" data-testid="scoring-dialog-close" onClick={onClose}>
            {bm.logicDialog.done}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Coerce a typed points string into something the schema accepts.
 *
 * NEGATIVES ARE VALID and deliberately preserved (the real forms use −2 … +3);
 * only non-finite input is rejected, and the value is truncated to an integer
 * and bounded so an exponent ("1e35") can never be committed. Returning 0 for
 * garbage keeps autosave alive — the alternative is a config that no longer
 * parses, which stops EVERY later edit from saving, not just this one.
 */
export function commitPoints(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(Math.max(-1_000_000, Math.min(1_000_000, n)));
}

/**
 * One question's point table — the Results tab's read-only `PointsCard` with the
 * values turned into inputs, and the same per-question scoring toggle.
 *
 * The toggle writes the SAME `step.scoringEnabled` the question's settings panel
 * edits, so the two views can never disagree. A question opted out stays listed
 * (you need to see it to turn it back on) but is dimmed and its points struck
 * from the total.
 */
function PointsCard({
  step,
  index,
  onScoringChange,
  onPatch,
  bm,
  em,
}: {
  step: FormStep;
  index: number;
  /** Toggle THIS question's contribution to the score. */
  onScoringChange: (on: boolean) => void;
  onPatch: (patch: Partial<FormStep>) => void;
  bm: BuilderMessages;
  em: EditorMessages;
}) {
  const on = step.scoringEnabled !== false;
  const title = step.question?.trim() || tb(bm.canvas.questionN, { n: index + 1 });
  const options = step.options ?? [];

  function setOptionPoints(optionIndex: number, raw: string) {
    const points = commitPoints(raw);
    onPatch({
      options: options.map((o, i): FormOption => (i === optionIndex ? { ...o, points } : o)),
    });
  }

  return (
    <div
      data-testid="points-card"
      data-scoring-off={!on || undefined}
      data-step-key={step.key}
      className={cn(
        'rounded-xl border border-border bg-background p-3.5 transition-opacity',
        !on && 'opacity-50',
      )}
    >
      <p
        className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-foreground"
        data-testid="points-question"
      >
        {/* Real question number = position in the FULL step list, so a scored
            slider that is question 5 reads "5" (not its filtered index). */}
        <span
          data-testid="points-question-number"
          className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-sm bg-muted px-1 text-xs font-bold tabular-nums text-muted-foreground"
        >
          {index + 1}
        </span>
        <i aria-hidden className={`pi ${iconForStep(step)} text-muted-foreground`} style={{ fontSize: 12 }} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {/* This question's own ceiling, so the form total above is traceable to
            the rows that produce it rather than being a number to take on faith. */}
        <span
          data-testid="points-card-max"
          className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-muted-foreground"
        >
          {tb(bm.scoring.stepMax, { n: maxStepPoints(step) })}
        </span>
        <Switch
          checked={on}
          onCheckedChange={onScoringChange}
          aria-label={`${bm.settings.scoring} — ${title}`}
          data-testid="points-card-toggle"
        />
      </p>

      {step.type === 'slider' ? (
        /* A slider scores by RANGE, not by option — it has no options at all.
           Reusing the real range editor keeps the bounds check, the overlap
           warning and the seeding behaviour instead of reimplementing three
           quiet correctness rules in a second place. */
        <div data-testid="points-slider">
          <SliderScoringEditor
            step={step}
            ranges={step.sliderScoring ?? []}
            onChange={(next: SliderScoringRange[]) => onPatch({ sliderScoring: next })}
            m={em.sliderScoring}
          />
        </div>
      ) : options.length === 0 ? (
        <p data-testid="points-no-options" className="text-xs text-muted-foreground">
          {bm.scoring.noOptions}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {options.map((o, oi) => (
            <div
              key={o.value}
              data-testid="points-option"
              className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate text-foreground">{o.label}</span>
              <div className="w-20 shrink-0">
                <NumberField
                  aria-label={`${em.options.points} — ${o.label}`}
                  data-testid="points-option-input"
                  value={o.points ?? 0}
                  step={1}
                  className="text-right text-xs"
                  onChange={(e) => setOptionPoints(oi, e.target.value)}
                />
              </div>
            </div>
          ))}
          <p className="text-xs leading-relaxed text-muted-foreground">{em.options.pointsHint}</p>
        </div>
      )}
    </div>
  );
}
