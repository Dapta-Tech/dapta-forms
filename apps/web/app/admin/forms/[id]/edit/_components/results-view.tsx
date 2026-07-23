'use client';

import { useEffect, useState } from 'react';
import type { FormConfig, FormOutcome, FormStep } from '@quill/engine';
import { createEmptyOutcome } from '@quill/engine';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { HelpTip } from '@/components/ui/help-tip';
import { TextField, NumberField, TextArea } from './fields';
import { iconForStep } from './question-types';
import { maxScore, scoringSteps } from './scoring-util';
import type { BuilderMessages } from './builder-messages';
import { tb } from './builder-messages';
import type { EditorMessages } from './messages';

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
  onStepScoringChange,
  m,
  rm,
}: {
  config: FormConfig;
  onScoringChange: (enabled: boolean) => void;
  onOutcomesChange: (next: FormOutcome[]) => void;
  /** Toggle ONE question's contribution, by its index in `config.steps` — V5-B2. */
  onStepScoringChange: (stepIndex: number, on: boolean) => void;
  m: BuilderMessages;
  /** Results-tab clarity strings from the shared catalog (admin.editor.resultsHelp). */
  rm: EditorMessages['resultsHelp'];
}) {
  const enabled = config.scoring?.enabled !== false;
  const top = maxScore(config);
  const questions = scoringSteps(config);
  // Real question numbers: map each step to its position in the FULL step list,
  // so a scored slider at question 5 reads "5" — not its index in the filtered
  // scoring list. Reference identity holds (filter doesn't clone the steps).
  const stepIndex = new Map<FormStep, number>(config.steps.map((s, i) => [s, i]));
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
            <p className="mt-1 text-sm text-muted-foreground">
              {enabled ? tb(m.results.pointsHint, { n: top }) : m.results.pointsHintOff}
            </p>
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
            {questions.map((q) => (
              <PointsCard
                key={q.key}
                step={q}
                index={stepIndex.get(q) ?? 0}
                onScoringChange={(on) => onStepScoringChange(stepIndex.get(q) ?? 0, on)}
                m={m}
              />
            ))}
          </div>
        )}
      </section>

      {/* What happens at the end. Outcomes ARE the score's routing table, so with
          scoring off they route nothing — the engine now resolves to null and the
          form's own ending shows (V5-A1). The panel goes inert rather than
          hiding: the ranges are still there, and hiding them would read as data
          loss. Kept editable-looking-but-disabled would be worse, so it is
          visibly dimmed with the reason stated. */}
      <section
        data-testid="results-end"
        data-scoring-off={!enabled || undefined}
        className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5"
      >
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <i aria-hidden className="pi pi-check-square text-primary" style={{ fontSize: 15 }} />
            {m.results.endTitle}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{m.results.endHint}</p>
        </div>

        {!enabled ? (
          <p
            data-testid="results-outcomes-inert"
            className="flex items-start gap-2 rounded-xl border border-dashed border-border p-4 text-sm leading-relaxed text-muted-foreground"
          >
            <i aria-hidden className="pi pi-info-circle mt-0.5 shrink-0 text-secondary" style={{ fontSize: 13 }} />
            {rm.outcomesInert}
          </p>
        ) : null}

        <fieldset
          disabled={!enabled}
          className={cn(
            'flex flex-col gap-4 border-0 p-0',
            !enabled && 'pointer-events-none select-none opacity-40',
          )}
        >
        <ScoreBar outcomes={outcomes} top={top} m={m} />

        <div className="flex flex-col gap-3">
          {outcomes.map((o, index) => {
            const lower = o.minScore ?? 0;
            const upper = outcomes[index + 1]?.minScore;
            // Two ranges claiming the same threshold made this print an
            // inverted bucket ("0–-1") as if it were legitimate. When the next
            // range starts at or below this one, this range is unreachable —
            // say so instead of drawing a nonsense span.
            const shadowed = upper != null && upper <= lower;
            const range = shadowed
              ? m.results.rangeUnreachable
              : upper != null
                ? `${lower}–${upper - 1}`
                : `${lower}+`;
            return (
              <div
                key={o.id}
                data-testid="outcome-row"
                data-unreachable={shadowed || undefined}
                className={cn(
                  'rounded-xl border bg-background p-3.5',
                  shadowed ? 'border-destructive/50' : 'border-border',
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'inline-flex min-w-[52px] shrink-0 items-center justify-center rounded-lg px-2 py-1.5 text-sm font-bold tabular-nums',
                      shadowed
                        ? 'bg-destructive/15 text-destructive'
                        : index === outcomes.length - 1
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {range}
                  </span>
                  <span className="relative flex flex-1 items-center gap-1.5">
                    <TextField
                      value={o.label}
                      placeholder={m.results.rangeLabelPlaceholder}
                      onChange={(e) => update(index, { label: e.target.value })}
                      className="flex-1 font-medium"
                      data-testid="outcome-label"
                    />
                    <HelpTip text={rm.outcomeHeadingHelp2} label={rm.messageLabel} />
                  </span>
                  <div className="w-20 shrink-0">
                    <NumberField
                      aria-label={m.results.rangeLabel}
                      value={lower}
                      onChange={(e) => update(index, { minScore: Number(e.target.value) || 0 })}
                      data-testid="outcome-minscore"
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
                {/* The label above IS the heading respondents see on the thank-you
                    screen when their score lands in this range. */}
                <p className="mt-1.5 pl-[64px] text-[11px] text-muted-foreground">{rm.outcomeHeadingHelp}</p>
                {/* Per-outcome thank-you BODY (V4-16): the editable "page" shown
                    for this range; empty falls back to the shared thank-you body.
                    Interpolation of [field] tokens happens in the renderer. */}
                <div className="mt-2.5 flex flex-col gap-1 pl-[64px]">
                  <label htmlFor={`outcome-message-${o.id}`} className="text-xs font-medium text-foreground">
                    {rm.messageLabel}
                  </label>
                  <TextArea
                    id={`outcome-message-${o.id}`}
                    value={o.message ?? ''}
                    rows={2}
                    placeholder={m.results.messagePlaceholder}
                    onChange={(e) => update(index, { message: e.target.value || null })}
                    data-testid="outcome-message"
                    className="text-xs"
                  />
                  <p className="text-[11px] text-muted-foreground">{rm.messageHelp}</p>
                </div>
                {/* Redirect is a clearly-separate, optional URL — normalized to
                    https:// on blur so a schemeless entry never 400s the save. */}
                <div className="mt-2.5 flex flex-col gap-1 pl-[64px]">
                  <span className="flex items-center gap-1.5">
                    <label htmlFor={`outcome-redirect-${o.id}`} className="text-xs font-medium text-foreground">
                      {rm.redirectLabel}
                    </label>
                    <HelpTip text={rm.redirectHelp2} label={rm.redirectLabel} />
                  </span>
                  <RedirectField
                    id={`outcome-redirect-${o.id}`}
                    value={o.redirectUrl ?? null}
                    placeholder={m.results.redirectPlaceholder}
                    onCommit={(url) => update(index, { redirectUrl: url })}
                  />
                  <p className="text-[11px] text-muted-foreground">{rm.redirectHelp}</p>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addRange}
            data-testid="results-add-range"
            className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} />
            {m.results.addRange}
          </button>
        </div>
        </fieldset>
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

/**
 * Normalize a user-typed redirect: prepend `https://` when the scheme is omitted
 * (so `example.com` becomes a valid URL the schema accepts instead of 400-ing);
 * an empty value → null (no redirect → the respondent sees the thank-you screen).
 */
function normalizeRedirect(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v; // already carries a scheme
  return `https://${v}`;
}

/**
 * Redirect input that holds a local draft while typing and only commits a
 * NORMALIZED URL on blur — so autosave never fires a schemeless (doomed) URL,
 * and `example.com` is silently upgraded to `https://example.com`.
 */
function RedirectField({
  id,
  value,
  placeholder,
  onCommit,
}: {
  id: string;
  value: string | null;
  placeholder: string;
  onCommit: (url: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  // Re-sync when the stored value changes elsewhere (e.g. ranges re-sorted).
  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);
  return (
    <TextField
      id={id}
      type="url"
      inputMode="url"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const normalized = normalizeRedirect(draft);
        if (normalized !== (value ?? null)) onCommit(normalized);
        setDraft(normalized ?? '');
      }}
      className="text-xs"
      data-testid="outcome-redirect"
    />
  );
}

/** One question's points, read-through from its options/slider ranges. */
/**
 * One question's point table in Results, with its own scoring toggle (V5-B2).
 *
 * The toggle is the SAME `step.scoringEnabled` the question's settings panel
 * edits, so the two views can never disagree. A question opted out stays listed
 * (you need to see it to turn it back on) but is dimmed and its points struck
 * from the total.
 */
function PointsCard({
  step,
  index,
  onScoringChange,
  m,
}: {
  step: FormStep;
  index: number;
  /** Toggle THIS question's contribution to the score. */
  onScoringChange: (on: boolean) => void;
  m: BuilderMessages;
}) {
  const on = step.scoringEnabled !== false;
  return (
    <div
      data-testid="points-card"
      data-scoring-off={!on || undefined}
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
          className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded bg-muted px-1 text-xs font-bold tabular-nums text-muted-foreground"
        >
          {index + 1}
        </span>
        <i aria-hidden className={`pi ${iconForStep(step)} text-muted-foreground`} style={{ fontSize: 12 }} />
        <span className="min-w-0 flex-1 truncate">
          {step.question?.trim() || tb(m.canvas.questionN, { n: index + 1 })}
        </span>
        <Switch
          checked={on}
          onCheckedChange={onScoringChange}
          aria-label={`${m.settings.scoring} — ${step.question?.trim() || tb(m.canvas.questionN, { n: index + 1 })}`}
          data-testid="points-card-toggle"
        />
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
