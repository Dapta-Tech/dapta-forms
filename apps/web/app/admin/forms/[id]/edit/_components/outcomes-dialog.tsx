'use client';

import { useEffect, useState } from 'react';
import type { FormConfig, FormOutcome } from '@quill/engine';
import { createEmptyOutcome } from '@quill/engine';
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
 * the rest of the form-wide routing now lives. Every behaviour it already
 * encoded is a bug fix and is carried over verbatim:
 *
 *  - a range whose SUCCESSOR starts at or below it is unreachable and says so,
 *    instead of printing an inverted span ("0–-1") as if it were legitimate;
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
 * `v4-reveal` Playwright specs drive; they are preserved exactly.
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

            <div className="flex max-h-[58vh] flex-col gap-3 overflow-y-auto pr-1">
              {outcomes.map((o, index) => {
                const lower = o.minScore ?? 0;
                const upper = outcomes[index + 1]?.minScore;
                // Two ranges claiming the same threshold made this print an
                // inverted bucket ("0–-1") as if it were legitimate. When the
                // next range starts at or below this one, this range is
                // unreachable — say so instead of drawing a nonsense span.
                const shadowed = upper != null && upper <= lower;
                const range = shadowed
                  ? bm.results.rangeUnreachable
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
                          placeholder={bm.results.rangeLabelPlaceholder}
                          onChange={(e) => update(index, { label: e.target.value })}
                          className="flex-1 font-medium"
                          data-testid="outcome-label"
                        />
                        <HelpTip text={rm.outcomeHeadingHelp2} label={rm.messageLabel} />
                      </span>
                      <div className="w-20 shrink-0">
                        <NumberField
                          aria-label={bm.results.rangeLabel}
                          value={lower}
                          step={1}
                          onChange={(e) => {
                            // The schema requires an integer. A float ("7.5") or
                            // an exponent ("1e35") used to be committed, fail
                            // validation, and take every LATER edit down with
                            // it — the whole form stopped autosaving over one
                            // keystroke in this box. Constrain it here instead.
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n)) return update(index, { minScore: 0 });
                            update(index, {
                              minScore: Math.trunc(Math.max(-1_000_000, Math.min(1_000_000, n))),
                            });
                          }}
                          data-testid="outcome-minscore"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={bm.results.remove}
                        onClick={() => onOutcomesChange(outcomes.filter((_, i) => i !== index))}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <i aria-hidden className="pi pi-trash" style={{ fontSize: 13 }} />
                      </Button>
                    </div>
                    {/* The label above IS the heading respondents see on the
                        thank-you screen when their score lands in this range. */}
                    <p className="mt-1.5 pl-[64px] text-xs text-muted-foreground">{rm.outcomeHeadingHelp}</p>
                    {/* Per-outcome thank-you BODY: the editable "page" shown for
                        this range; empty falls back to the shared thank-you
                        body. Interpolation of [field] tokens happens in the
                        renderer. */}
                    <div className="mt-2.5 flex flex-col gap-1 pl-[64px]">
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
                      <div className="mt-2.5 flex flex-col gap-1 pl-[64px]">
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
                      <div className="mt-2.5 flex flex-col gap-1 pl-[64px]">
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

/** A segmented bar of the score ranges, from cold (muted) to hot (lime). */
function ScoreBar({ outcomes, top }: { outcomes: FormOutcome[]; top: number }) {
  if (outcomes.length === 0) return null;
  const bounds = outcomes.map((o) => o.minScore ?? 0);
  return (
    <div data-testid="outcomes-score-bar">
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
