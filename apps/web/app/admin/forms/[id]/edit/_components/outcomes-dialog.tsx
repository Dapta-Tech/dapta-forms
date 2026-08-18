'use client';

import { useEffect, useState } from 'react';
import type { FormConfig, FormOutcome, OutcomeRange } from '@quill/engine';
import { createEmptyOutcome, outcomeGaps, outcomeRanges, overlappingOutcomes } from '@quill/engine';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HelpTip } from '@/components/ui/help-tip';
import { cn } from '@/lib/cn';
import { TextField, NumberField } from './fields';
import { TokenTextarea, tokenOptionsBefore, allTokenKeys } from './token-textarea';
import { maxScore } from './scoring-util';
import { tb } from './builder-messages';
import type { BuilderMessages } from './builder-messages';
import type { EditorMessages } from './messages';

/**
 * The FORM-WIDE outcome table (F3b) — score ranges mapped to what a respondent
 * sees at the end.
 *
 * This is the Results tab's right-hand section, moved behind the Logic tab where
 * the rest of the form-wide routing now lives.
 *
 * A range is now something the author TYPES — both ends of it, in the row it
 * belongs to. It used to be something they inferred: an outcome stored only
 * where it started, so widening a range meant editing a different row, and the
 * span itself was printed back at them from a badge on the far side of the one
 * they were in. Everything below follows from making the span explicit —
 * `outcomeRanges` fills it in for the configs that predate `maxScore`, so old
 * and new forms read the same.
 *
 * Every behaviour it already encoded is a bug fix and is carried over:
 *
 *  - two ranges may never claim the same score, and the bound that would do it
 *    is REFUSED at the point of entry rather than stored and flagged;
 *  - `minScore` is forced to an INTEGER in bounds — a float or an exponent used
 *    to be committed, fail schema validation, and take every LATER edit down
 *    with it, so the whole form stopped autosaving over one keystroke;
 *  - with scoring off the section goes visibly INERT with the reason stated
 *    rather than hiding, because hiding a table the author filled in reads as
 *    data loss;
 *  - answer-forced overrides beat the score outright, which is why they are
 *    shown at all — without them the range labels can be read carefully and
 *    still be wrong.
 *
 * The `outcome-*` / `results-*` testids are the ones the `v4-save` and
 * `v4-reveal` Playwright specs drive; they are preserved. `outcome-minscore`
 * now names the range's lower bound rather than its only number, and
 * `outcome-maxscore` (or `outcome-maxscore-open` on the top range) is its pair.
 */

/** `fields.tsx` `controlBase`, compact — the shell `TokenTextarea` renders into. */
const OUTCOME_TEXTAREA_CLASS =
  'rounded-md border border-input bg-background px-3 py-2 text-xs transition-colors ' +
  'placeholder:text-muted-foreground hover:border-muted-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y';

export function OutcomesDialog({
  open,
  onClose,
  config,
  onOutcomesChange,
  bm,
  rm,
}: {
  open: boolean;
  onClose: () => void;
  config: FormConfig;
  onOutcomesChange: (next: FormOutcome[]) => void;
  bm: BuilderMessages;
  /** Results-tab clarity strings from the shared catalog (`admin.editor.resultsHelp`). */
  rm: EditorMessages['resultsHelp'];
}) {
  const enabled = config.scoring?.enabled !== false;
  const top = maxScore(config);
  const outcomes = [...(config.outcomes ?? [])].sort((a, b) => (a.minScore ?? 0) - (b.minScore ?? 0));
  // The thank-you screen runs AFTER every step, so every captured field is
  // available to recall there — pass the full list, not a prefix.
  const endingTokens = tokenOptionsBefore(config.steps, config.steps.length);
  const allKeys = allTokenKeys(config.steps);
  const bmTokens = bm.tokens;
  const tokenMessages = {
    pickerLabel: bmTokens.pickerLabel,
    pickerEmpty: bmTokens.pickerEmpty,
    pickerNoMatch: bmTokens.pickerNoMatch,
    warnLater: bmTokens.warnLater,
    warnUnknown: bmTokens.warnUnknown,
    warnRaw: bmTokens.warnRaw,
  };

  // The spans every row draws, plus the two things that can be wrong with them.
  // One source for all three — the badge, the bar, and the Logic canvas chips
  // each used to derive the range on their own, which is three chances to
  // disagree about the same numbers.
  const spans = outcomeRanges(outcomes);
  const overlapping = new Set(overlappingOutcomes(outcomes));
  const gaps = outcomeGaps(outcomes);

  function update(index: number, patch: Partial<FormOutcome>) {
    onOutcomesChange(outcomes.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }
  function addRange() {
    const taken = new Set(outcomes.map((o) => o.id));
    const next = createEmptyOutcome(taken);
    const last = outcomes[outcomes.length - 1];
    if (last) {
      const lastSpan = spans[spans.length - 1];
      next.minScore = (lastSpan?.max ?? last.minScore ?? 0) + 1;
      // The new range takes over the open top, so the one below it has to close
      // — otherwise the two overlap the moment the row appears.
      const closed = outcomes.map((o, i) =>
        i === outcomes.length - 1 && o.maxScore == null
          ? { ...o, maxScore: (next.minScore ?? 0) - 1 }
          : o,
      );
      onOutcomesChange([...closed, next]);
      return;
    }
    next.minScore = 0;
    onOutcomesChange([next]);
  }

  /**
   * Commit a bound, or say why not.
   *
   * Two ranges claiming the same score is never a state worth storing: only one
   * of them can ever win, so the other is dead and the panel is lying about it.
   * The bound is refused here, at entry, and the field reverts on its own —
   * `NumberField` re-reads its display from the prop, and the prop never moved.
   *
   * Scoped to the row being edited. A collision this edit causes BETWEEN two
   * OTHER rows (possible when a threshold shift moves someone's implicit end)
   * is still stored and still flagged on the row it lands on — refusing an edit
   * over a conflict elsewhere on screen would be unexplainable.
   */
  function commitBound(index: number, patch: Partial<FormOutcome>): string | null {
    const candidate = outcomes.map((o, i) => (i === index ? { ...o, ...patch } : o));
    const span = outcomeRanges(candidate)[index];
    if (!span) return null;
    if (span.max != null && span.max < span.min) return bm.results.rangeInverted;
    const clash = firstClash(candidate, index);
    if (clash) return tb(bm.results.rangeOverlap, clash);
    onOutcomesChange(candidate);
    return null;
  }

  return (
    <Modal open={open} onClose={onClose} title={bm.outcomes.title} labelId="outcomes-dialog-title" size="xl">
      <div data-testid="outcomes-dialog" className="flex flex-col gap-4">
        <section data-testid="results-end" data-scoring-off={!enabled || undefined} className="flex flex-col gap-4">
          <div>
            <p className="text-xs text-muted-foreground">{bm.outcomes.subtitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">{bm.results.endHint}</p>
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
            <ScoreBar outcomes={outcomes} top={top} />

            {/* The scroll container. Named so the regression spec can read its
                `scrollTop` — editing a score used to throw this back to 0. */}
            <div
              data-testid="outcomes-scroller"
              className="flex max-h-[58vh] flex-col gap-3 overflow-y-auto pr-1"
            >
              {outcomes.map((o, index) => {
                const span = spans[index] ?? { min: o.minScore ?? 0, max: null };
                // The top range is deliberately left open: something has to
                // catch a score above every bound, and a form whose best lead
                // falls through to the generic ending is the worst possible
                // place to discover that.
                const openEnded = span.max == null;
                const collides = overlapping.has(index);
                return (
                  <div
                    key={o.id}
                    data-testid="outcome-row"
                    data-overlap={collides || undefined}
                    className={cn(
                      'rounded-xl border bg-background p-3.5',
                      collides ? 'border-destructive/50' : 'border-border',
                    )}
                  >
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="flex min-w-[180px] flex-1 flex-col gap-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          {bm.results.rangeLabel}
                        </span>
                        <span className="relative flex items-center gap-1.5">
                          <TextField
                            value={o.label}
                            placeholder={bm.results.rangeLabelPlaceholder}
                            onChange={(e) => update(index, { label: e.target.value })}
                            className="flex-1 font-medium"
                            data-testid="outcome-label"
                          />
                          <HelpTip text={rm.outcomeHeadingHelp2} label={rm.messageLabel} />
                        </span>
                      </div>
                      <RangeBounds
                        min={span.min}
                        max={span.max}
                        openEnded={openEnded}
                        onCommit={(patch) => commitBound(index, patch)}
                        m={bm.results}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={bm.results.remove}
                        onClick={() => onOutcomesChange(outcomes.filter((_, i) => i !== index))}
                        className="mb-0.5 shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <i aria-hidden className="pi pi-trash" style={{ fontSize: 13 }} />
                      </Button>
                    </div>
                    {/* The label above IS the heading respondents see on the
                        thank-you screen when their score lands in this range. */}
                    <p className="mt-1.5 text-xs text-muted-foreground">{rm.outcomeHeadingHelp}</p>
                    {/* Per-outcome thank-you BODY: the editable "page" shown for
                        this range; empty falls back to the shared thank-you
                        body. Interpolation of [field] tokens happens in the
                        renderer. */}
                    <div className="mt-2.5 flex flex-col gap-1">
                      <span className="text-xs font-medium text-foreground">{rm.messageLabel}</span>
                      {/* The recall picker, same as everywhere else in the
                          editor. This was a plain textarea, so typing `@` here
                          did nothing while it worked in every other copy field.
                          Every field is captured BEFORE the thank-you screen, so
                          all of them are offered. */}
                      <TokenTextarea
                        value={o.message ?? ''}
                        rows={2}
                        onChange={(v) => update(index, { message: v || null })}
                        placeholder={bm.results.messagePlaceholder}
                        ariaLabel={rm.messageLabel}
                        tokens={endingTokens}
                        allKeys={allKeys}
                        m={tokenMessages}
                        hint={bmTokens.hint}
                        testId="outcome-message"
                        className={OUTCOME_TEXTAREA_CLASS}
                      />
                      <p className="text-xs text-muted-foreground">{rm.messageHelp}</p>
                    </div>
                    {/* Redirect is a clearly-separate, optional URL — normalized
                        to https:// on blur so a schemeless entry never 400s the
                        save. */}
                    <div className="mt-2.5 flex flex-col gap-1">
                      <span className="flex items-center gap-1.5">
                        <label htmlFor={`outcome-redirect-${o.id}`} className="text-xs font-medium text-foreground">
                          {rm.redirectLabel}
                        </label>
                        <HelpTip text={rm.redirectHelp2} label={rm.redirectLabel} />
                      </span>
                      <RedirectField
                        id={`outcome-redirect-${o.id}`}
                        value={o.redirectUrl ?? null}
                        placeholder={bm.results.redirectPlaceholder}
                        onCommit={(url) => update(index, { redirectUrl: url })}
                      />
                      <p className="text-xs text-muted-foreground">{rm.redirectHelp}</p>
                    </div>
                    {/* How long the thank-you shows before the redirect. Stored
                        with no control anywhere for a release, so a form could
                        sit on a delay nobody could see, change, or explain. Only
                        relevant with a destination — without one there is
                        nothing to delay. */}
                    {o.redirectUrl?.trim() ? (
                      <div className="mt-2.5 flex flex-col gap-1">
                        <span className="flex items-center gap-1.5">
                          <label htmlFor={`outcome-delay-${o.id}`} className="text-xs font-medium text-foreground">
                            {rm.redirectDelayLabel}
                          </label>
                          <HelpTip text={rm.redirectDelayHelp} label={rm.redirectDelayLabel} />
                        </span>
                        <Input
                          id={`outcome-delay-${o.id}`}
                          type="number"
                          min={0}
                          step={100}
                          className="max-w-[160px]"
                          data-testid="outcome-redirect-delay"
                          value={String(o.redirectDelayMs ?? 0)}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            update(index, {
                              redirectDelayMs: Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0,
                            });
                          }}
                        />
                        <p className="text-xs text-muted-foreground">{rm.redirectDelayHint}</p>
                      </div>
                    ) : null}
                    {/* Answer-forced overrides. These beat the score outright, so
                        a range can read "6 and up" while a lead who cleared it
                        still lands here — the one rule that made the panel lie.
                        Shown read-only with a way to remove it: authoring a new
                        one needs a field+bound picker, and being able to SEE it
                        is what was actually missing. */}
                    {o.overrides?.length ? (
                      <div className="mt-2.5 flex flex-col gap-1">
                        <span className="text-xs font-medium text-foreground">{rm.overridesLabel}</span>
                        {o.overrides.map((rule, ri) => (
                          <div
                            key={`${rule.field}-${ri}`}
                            data-testid="outcome-override"
                            className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5"
                          >
                            <code className="min-w-0 truncate text-xs text-muted-foreground">
                              {describeOverride(rule, rm)}
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={rm.overrideRemove}
                              onClick={() =>
                                update(index, {
                                  overrides: (o.overrides ?? []).filter((_, j) => j !== ri),
                                })
                              }
                            >
                              {rm.overrideRemove}
                            </Button>
                          </div>
                        ))}
                        <p className="text-xs text-muted-foreground">{rm.overridesHelp}</p>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              <button
                type="button"
                onClick={addRange}
                data-testid="results-add-range"
                className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary-edge/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} />
                {bm.results.addRange}
              </button>
            </div>

            {/* Scores no range covers. Reported, never blocked: a gap is a real
                choice — those respondents see the form's own ending — and it is
                also the state almost every half-typed set of ranges passes
                through. It sits OUTSIDE the scroller so it stays readable
                whichever row is on screen. */}
            {gaps.length > 0 ? (
              <p
                data-testid="outcome-gap-note"
                className="flex items-start gap-2 rounded-md border border-secondary/40 bg-secondary/10 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
              >
                <i aria-hidden className="pi pi-info-circle mt-0.5 shrink-0 text-secondary" style={{ fontSize: 11 }} />
                {tb(bm.results.rangeGapNote, { ranges: gaps.map(spanText).join(', ') })}
              </p>
            ) : null}
          </fieldset>
        </section>

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" data-testid="outcomes-dialog-close" onClick={onClose}>
            {bm.logicDialog.done}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * A span as the author reads it: `0–2`, `6+` for the open top one, and a bare
 * `2` for a range of one score — "no range covers 2–2" is not how anyone says it.
 */
export function spanText(span: OutcomeRange): string {
  if (span.max == null) return `${span.min}+`;
  return span.max === span.min ? `${span.min}` : `${span.min}–${span.max}`;
}

/**
 * The first range the one at `index` would collide with, named so the refusal
 * can point at it. An unlabelled range answers to `#n`, the same fallback the
 * score bar uses, because "that would overlap ''" is not a sentence.
 */
export function firstClash(
  outcomes: FormOutcome[],
  index: number,
): { label: string; range: string } | null {
  const spans = outcomeRanges(outcomes);
  const mine = spans[index];
  if (!mine) return null;
  for (let i = 0; i < outcomes.length; i++) {
    if (i === index) continue;
    const other = spans[i];
    if (!other) continue;
    const mineEndsFirst = mine.max != null && mine.max < other.min;
    const otherEndsFirst = other.max != null && other.max < mine.min;
    if (mineEndsFirst || otherEndsFirst) continue;
    return { label: outcomes[i]!.label || `#${i + 1}`, range: spanText(other) };
  }
  return null;
}

/** An integer the config schema will accept: `minScore`/`maxScore` are `int()`. */
export function toStoredInt(raw: string): number {
  const n = Number(raw);
  // A float ("7.5") or an exponent ("1e35") used to be committed, fail schema
  // validation, and take every LATER edit down with it — the whole form stopped
  // autosaving over one keystroke in this box. Constrain it here instead.
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(Math.max(-1_000_000, Math.min(1_000_000, n)));
}

/**
 * The two ends of one range.
 *
 * An outcome used to store only where it STARTED. The span was printed back at
 * the author from a badge on the other side of the row, derived from a
 * neighbour's number — so to widen a range you edited a different row, and to
 * read one you looked somewhere other than the fields you typed in.
 *
 * Both ends commit on BLUR, not per keystroke. That is what makes a refusal
 * possible at all: an overlap has to be judged against a finished number, and
 * "10" passes through "1" on the way in. It also stops the list re-sorting under
 * the pointer while a threshold is half-typed.
 *
 * `onCommit` returns the reason it refused, or null once it has written. On a
 * refusal nothing is written, so `NumberField` re-reads its display from the
 * unchanged prop and the field puts itself back.
 */
function RangeBounds({
  min,
  max,
  openEnded,
  onCommit,
  m,
}: {
  min: number;
  /** The effective upper bound — explicit, derived, or null when open-ended. */
  max: number | null;
  openEnded: boolean;
  onCommit: (patch: Partial<FormOutcome>) => string | null;
  m: BuilderMessages['results'];
}) {
  const [error, setError] = useState<string | null>(null);
  // A refusal is about the numbers as they now stand; once they move, it is
  // stale. Clearing on the committed value (not on keystrokes) keeps the reason
  // on screen while the author reads it.
  useEffect(() => {
    setError(null);
  }, [min, max]);

  function commit(patch: Partial<FormOutcome>) {
    setError(onCommit(patch));
  }

  return (
    <>
      <div className="flex w-20 shrink-0 flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{m.rangeFrom}</span>
        <NumberField
          aria-label={m.rangeFrom}
          value={min}
          step={1}
          data-testid="outcome-minscore"
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          onBlur={(e) => commit({ minScore: toStoredInt(e.target.value) })}
        />
      </div>
      <div className="flex w-20 shrink-0 flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{m.rangeTo}</span>
        {openEnded ? (
          // Not a disabled number box: there is no number here to disable. The
          // top range is open on purpose, and saying so is the point.
          <Input
            readOnly
            aria-label={m.rangeTo}
            title={m.rangeOpenEndedHelp}
            value={m.rangeOpenEnded}
            data-testid="outcome-maxscore-open"
            className="cursor-default text-center text-xs text-muted-foreground"
          />
        ) : (
          <NumberField
            aria-label={m.rangeTo}
            value={max ?? ''}
            step={1}
            data-testid="outcome-maxscore"
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            onBlur={(e) => {
              // Cleared = "wherever the next range starts", the implicit end
              // every config had before this field existed. Storing 0 here
              // instead would silently kill the range.
              const raw = e.target.value.trim();
              commit({ maxScore: raw === '' ? undefined : toStoredInt(raw) });
            }}
          />
        )}
      </div>
      {error ? (
        <p
          role="alert"
          data-testid="outcome-range-error"
          className="order-last flex w-full items-start gap-1.5 text-xs leading-relaxed text-destructive"
        >
          <i aria-hidden className="pi pi-exclamation-triangle mt-0.5 shrink-0" style={{ fontSize: 10 }} />
          {error}
        </p>
      ) : null}
    </>
  );
}

/**
 * An answer-forced override, read back as a sentence.
 *
 * The stored shape is `{ field, maxValue?, minValue?, values? }` and it decides
 * which outcome a lead lands in BEFORE any score is compared — so leaving it
 * invisible meant the range labels could be read carefully and still be wrong.
 * A clause the schema allows but nothing sets renders as the bare field, which
 * is honest: it says a rule exists without inventing what it means.
 */
function describeOverride(
  rule: { field: string; maxValue?: number; minValue?: number; values?: string[] },
  rm: EditorMessages['resultsHelp'],
): string {
  if (rule.maxValue != null) {
    return tb(rm.overrideAtMost, { field: rule.field, bound: String(rule.maxValue) });
  }
  if (rule.minValue != null) {
    return tb(rm.overrideAtLeast, { field: rule.field, bound: String(rule.minValue) });
  }
  if (rule.values?.length) {
    return tb(rm.overrideIsAnyOf, { field: rule.field, bound: rule.values.join(', ') });
  }
  return rule.field;
}

/**
 * Below this share of the bar a segment is too narrow to show words at all
 * (~40px on the dialog's ~560px bar), so it shows initials instead. A fixed
 * share rather than a measured width keeps the bar a pure function of the
 * outcomes, which is what lets the spec exercise it as one.
 */
const INITIALS_SHARE = 0.12;

/**
 * What a bar segment prints for an outcome label given its share of the bar:
 * the label itself when there is room to truncate it legibly, otherwise the
 * initials of its first two words ("Muy buen fit" -> "MB", "P3" -> "P3"). Never
 * more than three characters in the narrow case, so a code like "P3" or "#4"
 * survives whole. Exported for the spec.
 */
export function segmentLabel(label: string, share: number): string {
  if (share >= INITIALS_SHARE) return label;
  const trimmed = label.trim();
  if (trimmed.length <= 3) return trimmed;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

/**
 * A segmented bar of the score ranges, from cold (muted) to hot (lime).
 *
 * Widths come from `outcomeRanges`, the same helper the rows and the Logic
 * canvas read, rather than from this component's own re-derivation of where the
 * next range starts. It also draws the GAPS: a bar that tiles edge to edge over
 * ranges that do not is the exact picture the author is trying to check here.
 */
export function ScoreBar({ outcomes, top }: { outcomes: FormOutcome[]; top: number }) {
  if (outcomes.length === 0) return null;
  const spans = outcomeRanges(outcomes);
  // Segments in score order, gaps interleaved. The open top range is measured
  // to the form's highest possible score, or one point if it starts above it.
  const segments: { key: string; width: number; label: string | null; hot: number }[] = [];
  let previousEnd: number | null = null;
  outcomes.forEach((o, i) => {
    const span = spans[i] ?? { min: o.minScore ?? 0, max: null };
    if (previousEnd != null && span.min > previousEnd + 1) {
      segments.push({ key: `gap-${o.id}`, width: span.min - previousEnd - 1, label: null, hot: 0 });
    }
    const end = span.max ?? Math.max(top, span.min);
    segments.push({
      key: o.id,
      width: Math.max(1, end - span.min + 1),
      label: o.label || `#${i + 1}`,
      hot: i / Math.max(1, outcomes.length - 1),
    });
    previousEnd = end;
  });
  const total = segments.reduce((n, s) => n + s.width, 0);
  return (
    <div data-testid="outcomes-score-bar">
      <div className="flex h-9 overflow-hidden rounded-lg">
        {segments.map((s) =>
          s.label == null ? (
            <div
              key={s.key}
              data-testid="outcomes-score-gap"
              aria-hidden
              className="border-x border-dashed border-border bg-muted/20"
              style={{ flex: s.width }}
            />
          ) : (
            <div
              key={s.key}
              data-testid="outcomes-score-segment"
              title={s.label}
              className="flex min-w-0 items-center justify-center overflow-hidden text-xs font-semibold"
              style={{
                flex: s.width,
                background: `color-mix(in srgb, var(--primary) ${Math.round(20 + s.hot * 80)}%, var(--muted))`,
                color: s.hot > 0.6 ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              }}
            >
              {/* The segment is as wide as its RANGE, not its label: a 3-point
                  range beside a 70-point one gets a sliver whatever it is
                  called. So the label yields, never the layout: it truncates
                  with an ellipsis, and a sliver shows only its initials. The
                  `title` (and the row below) carry the full text. */}
              <span className="min-w-0 truncate px-1.5">{segmentLabel(s.label, s.width / total)}</span>
            </div>
          ),
        )}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
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
