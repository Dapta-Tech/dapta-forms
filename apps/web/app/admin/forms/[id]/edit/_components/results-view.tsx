'use client';

import type { FormConfig, FormOutcome, FormStep } from '@quill/engine';
import { createEmptyOutcome } from '@quill/engine';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { TextField, NumberField } from './fields';
import { iconForStep } from './question-types';
import { maxScore, scoringSteps } from './scoring-util';
import type { BuilderMessages } from './builder-messages';
import { tb } from './builder-messages';

/**
 * Unified Scoring & Results — one coherent story: LEFT the points each question
 * awards (choice chips + slider ranges, read-through from the questions), RIGHT
 * the score ranges mapped to an outcome (thank-you message / redirect). "The
 * first matching range wins" is stated. Editing points stays on the question;
 * here you set ranges and outcomes.
 */
export function ResultsView({
  config,
  onScoringChange,
  onOutcomesChange,
  m,
}: {
  config: FormConfig;
  onScoringChange: (enabled: boolean) => void;
  onOutcomesChange: (next: FormOutcome[]) => void;
  m: BuilderMessages;
}) {
  const enabled = config.scoring?.enabled !== false;
  const top = maxScore(config);
  const questions = scoringSteps(config);
  const outcomes = [...(config.outcomes ?? [])].sort((a, b) => (a.minScore ?? 0) - (b.minScore ?? 0));

  function update(index: number, patch: Partial<FormOutcome>) {
    onOutcomesChange(outcomes.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }
  function addRange() {
    const taken = new Set(outcomes.map((o) => o.id));
    const next = createEmptyOutcome(taken);
    next.minScore = outcomes.length ? (outcomes[outcomes.length - 1]?.minScore ?? 0) + 5 : 0;
    onOutcomesChange([...outcomes, next]);
  }

  return (
    <div className="mx-auto grid max-w-[1200px] gap-4 px-4 py-6 lg:grid-cols-2">
      {/* Points */}
      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <i aria-hidden className="pi pi-star text-primary" style={{ fontSize: 15 }} />
              {m.results.pointsTitle}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{tb(m.results.pointsHint, { n: top })}</p>
          </div>
          <Switch checked={enabled} onCheckedChange={onScoringChange} aria-label={m.results.enableScoring} />
        </div>

        {!enabled ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {m.results.scoringOff}
          </p>
        ) : questions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {m.results.noQuestions}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {questions.map((q, i) => (
              <PointsCard key={q.key} step={q} index={i} m={m} />
            ))}
          </div>
        )}
      </section>

      {/* What happens at the end */}
      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <i aria-hidden className="pi pi-check-square text-primary" style={{ fontSize: 15 }} />
            {m.results.endTitle}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{m.results.endHint}</p>
        </div>

        <ScoreBar outcomes={outcomes} top={top} m={m} />

        <div className="flex flex-col gap-3">
          {outcomes.map((o, index) => {
            const lower = o.minScore ?? 0;
            const upper = outcomes[index + 1]?.minScore;
            const range = upper != null ? `${lower}–${upper - 1}` : `${lower}+`;
            const isRedirect = !!o.redirectUrl;
            return (
              <div key={o.id} className="rounded-xl border border-border bg-background p-3.5">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'inline-flex min-w-[52px] shrink-0 items-center justify-center rounded-lg px-2 py-1.5 text-sm font-bold tabular-nums',
                      index === outcomes.length - 1
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {range}
                  </span>
                  <TextField
                    value={o.label}
                    placeholder={m.results.rangeLabelPlaceholder}
                    onChange={(e) => update(index, { label: e.target.value })}
                    className="flex-1 font-medium"
                  />
                  <div className="w-20 shrink-0">
                    <NumberField
                      aria-label={m.results.rangeLabel}
                      value={lower}
                      onChange={(e) => update(index, { minScore: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={m.results.remove}
                    onClick={() => onOutcomesChange(outcomes.filter((_, i) => i !== index))}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <i aria-hidden className="pi pi-trash" style={{ fontSize: 13 }} />
                  </Button>
                </div>
                <div className="mt-2.5 flex items-center gap-2 pl-[64px]">
                  {isRedirect ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-secondary/15 px-2 py-1 text-xs font-semibold text-secondary">
                      <i aria-hidden className="pi pi-external-link" style={{ fontSize: 10 }} />
                      {m.results.redirect}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
                      <i aria-hidden className="pi pi-comment" style={{ fontSize: 10 }} />
                      {m.results.thankYouMessage}
                    </span>
                  )}
                  <TextField
                    value={o.redirectUrl ?? ''}
                    placeholder={m.results.redirectPlaceholder}
                    onChange={(e) => update(index, { redirectUrl: e.target.value || null })}
                    className="flex-1 text-xs"
                  />
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addRange}
            className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} />
            {m.results.addRange}
          </button>
        </div>
      </section>
    </div>
  );
}

/** A segmented bar of the score ranges, from cold (muted) to hot (lime). */
function ScoreBar({ outcomes, top, m }: { outcomes: FormOutcome[]; top: number; m: BuilderMessages }) {
  void m;
  if (outcomes.length === 0) return null;
  const bounds = outcomes.map((o) => o.minScore ?? 0);
  return (
    <div>
      <div className="flex h-9 overflow-hidden rounded-lg">
        {outcomes.map((o, i) => {
          const lower = bounds[i] ?? 0;
          const upper = (i + 1 < bounds.length ? bounds[i + 1] : top) ?? top;
          const span = Math.max(1, upper - lower);
          const hot = i / Math.max(1, outcomes.length - 1);
          return (
            <div
              key={o.id}
              className="flex items-center justify-center text-xs font-semibold"
              style={{
                flex: span,
                background: `color-mix(in srgb, var(--primary) ${Math.round(20 + hot * 80)}%, var(--muted))`,
                color: hot > 0.6 ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              }}
            >
              {o.label || `#${i + 1}`}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>0</span>
        <span>{top}</span>
      </div>
    </div>
  );
}

/** One question's points, read-through from its options/slider ranges. */
function PointsCard({ step, index, m }: { step: FormStep; index: number; m: BuilderMessages }) {
  void index;
  return (
    <div className="rounded-xl border border-border bg-background p-3.5">
      <p className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-foreground">
        <i aria-hidden className={`pi ${iconForStep(step)} text-muted-foreground`} style={{ fontSize: 12 }} />
        {step.question?.trim() || tb(m.canvas.questionN, { n: index + 1 })}
      </p>
      {step.type === 'slider' ? (
        <div className="flex flex-wrap gap-2">
          {(step.sliderScoring ?? []).length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            (step.sliderScoring ?? []).map((r, i) => (
              <span key={i} className="rounded-lg bg-muted px-2.5 py-1 text-xs text-foreground">
                {r.min}–{r.max}
                <span className="ml-1.5 font-semibold text-primary">{r.points >= 0 ? `+${r.points}` : r.points}</span>
              </span>
            ))
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {(step.options ?? []).map((o) => (
            <div key={o.value} className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm">
              <span className="min-w-0 truncate text-foreground">{o.label}</span>
              <span
                className={cn(
                  'ml-2 shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold',
                  (o.points ?? 0) > 0 ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {(o.points ?? 0) > 0 ? `+${o.points}` : (o.points ?? 0)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
