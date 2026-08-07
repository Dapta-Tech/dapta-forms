'use client';

import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import type { FormStep } from '@quill/engine';
import { cn } from '@/lib/cn';
import { liveRuleCount } from './logic-util';
import { SortableList, SortableRow } from './sortable';
import { iconForStep, isContactType, stepListLabel } from './question-types';
import type { BuilderMessages } from './builder-messages';
import { tb } from './builder-messages';

/**
 * Sortable id for the partial-submit marker. Never a real step key (step keys
 * are slugified question text), so it shares the dnd id space safely.
 */
const PARTIAL_ID = '__partial_submit_point__';

const isMarker = (id: string): boolean => id === PARTIAL_ID;

/**
 * The left flow spine — numbered question cards (drag to reorder), a type icon,
 * the truncated title, a purple "Logic" badge when the question carries rules,
 * and a muted "Contact" badge for auto-detected contact fields. The selected
 * card gets a lime left rail. One dashed "+ Add question" at the bottom opens
 * the type gallery.
 *
 * One dashed, unnumbered marker renders INSIDE the same dnd-kit list (under a
 * special id) so it drags exactly like a question: the "Partial submit point"
 * (`partialAfterStep`, 1..steps.length). Drops are translated back into domain
 * updates in `handleReorder`.
 *
 * The reveal screen used to have a second marker here, because it was a
 * form-level singleton with a position. It is a `reveal` STEP now — a numbered
 * card like any other — so a form can hold several and each is dragged and
 * edited as itself.
 */
export function QuestionSpine({
  steps,
  selectedIndex,
  onSelect,
  onReorder,
  onAdd,
  partialAfterStep,
  onPartialChange,
  m,
}: {
  steps: FormStep[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  onAdd: () => void;
  /** 1-based `config.partialSubmitAfterStep`; marker shows when 1..steps.length. */
  partialAfterStep?: number;
  /** Set (1-based), move, or clear (`undefined`) the partial-submit threshold. */
  onPartialChange: (afterStep: number | undefined) => void;
  m: BuilderMessages;
}) {
  // Effective 1-based marker slot (null = not shown) — only for an in-range
  // threshold.
  const partialIdx =
    partialAfterStep != null && partialAfterStep >= 1 && partialAfterStep <= steps.length
      ? partialAfterStep
      : null;

  // Merged sortable ids: step keys with the marker spliced in after its anchor.
  const ids: string[] = [];
  steps.forEach((s, i) => {
    ids.push(s.key);
    if (partialIdx === i + 1) ids.push(PARTIAL_ID);
  });

  /**
   * Translate a merged-list drop back into a domain update:
   * - the MARKER moved → its new position is however many QUESTIONS ended up
   *   above it (the marker doesn't count), clamped to ≥ 1 (a marker above every
   *   question is invalid — the minimum is "after question 1");
   * - a QUESTION moved → a plain step reorder. The editor re-anchors the
   *   threshold to the step it sits after, so the marker follows its anchor.
   */
  function handleReorder(from: number, to: number) {
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    if (moved === PARTIAL_ID) {
      const threshold = Math.max(1, questionsAbove(next, PARTIAL_ID));
      if (threshold !== partialAfterStep) onPartialChange(threshold);
      return;
    }
    const fromStep = questionIndex(ids, moved);
    const toStep = questionIndex(next, moved);
    if (fromStep >= 0 && toStep >= 0 && fromStep !== toStep) onReorder(fromStep, toStep);
  }

  return (
    <div data-testid="question-spine" className="flex h-full flex-col gap-3 border-r border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{m.shell.questions}</h2>
        <span className="text-xs text-muted-foreground">{steps.length}</span>
      </div>

      <SortableList ids={ids} onReorder={handleReorder} className="flex flex-col gap-2">
        {(id, index) => {
          if (id === PARTIAL_ID) {
            const atEnd = partialIdx === steps.length;
            return (
              <SortableRow key={id} id={id}>
                {({ handleProps }) => (
                  <SpineMarker
                    testidPrefix="partial-point"
                    icon="pi-send"
                    label={m.partial.label}
                    moveLabel={m.partial.move}
                    infoLabel={m.partial.info}
                    removeLabel={m.partial.remove}
                    onRemove={() => onPartialChange(undefined)}
                    handleProps={handleProps}
                    tips={
                      <>
                        <p>{m.partial.tipCapture}</p>
                        <p>{m.partial.tipStored}</p>
                        <p>{m.partial.tipNotify}</p>
                        {atEnd ? <p>{m.partial.tipAfterLast}</p> : null}
                        <p className="font-medium text-foreground">{m.partial.tipWhere}</p>
                      </>
                    }
                  />
                )}
              </SortableRow>
            );
          }

          // Question rows sit in the MERGED list — translate the merged position
          // back to the step index (count the questions above it).
          const stepIndex = questionsBeforePosition(ids, index);
          const step = steps[stepIndex];
          if (!step) return null;
          const active = stepIndex === selectedIndex;
          // `liveRuleCount`, not `ruleCount`: a stale catch-all on a message or
          // a reveal can never fire, and the settings panel already refuses to
          // count it — the badge here has to agree, or the spine advertises a
          // rule the panel says does not exist.
          const rules = liveRuleCount(step);
          const contact = isContactType(step.type);
          const title = stepListLabel(step, m);
          return (
            <SortableRow key={id} id={id}>
              {({ handleProps }) => (
                <div
                  className={cn(
                    'relative flex items-center gap-2 overflow-hidden rounded-xl border py-2.5 pl-2 pr-2.5 transition-colors',
                    active
                      ? 'border-primary bg-primary/[0.07]'
                      : 'border-border bg-card hover:border-muted-foreground/60',
                  )}
                >
                  {active ? (
                    <span aria-hidden className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-primary" />
                  ) : null}
                  <button
                    type="button"
                    aria-label={m.shell.addQuestion}
                    className="shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                    {...handleProps}
                  >
                    <i aria-hidden className="pi pi-bars" style={{ fontSize: 12 }} />
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelect(stepIndex)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <span
                      className={cn(
                        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums',
                        active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {stepIndex + 1}
                    </span>
                    <i
                      aria-hidden
                      className={cn('pi shrink-0 text-muted-foreground', iconForStep(step))}
                      style={{ fontSize: 13 }}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">
                        {title}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        {/* A hidden step looked identical to a normal one here,
                            in the Logic map and in Results — the single missing
                            marker behind several "why is this not working"
                            traps (its points never score, a reveal pinned to it
                            never plays, a partial point on it never fires). */}
                        {step.hidden ? (
                          <span
                            data-testid="spine-hidden-badge"
                            className="inline-flex shrink-0 items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                          >
                            {m.badges.hidden}
                          </span>
                        ) : null}
                        {rules > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-secondary/15 px-1.5 py-0.5 text-[10px] font-semibold text-secondary">
                            <i aria-hidden className="pi pi-sitemap" style={{ fontSize: 9 }} />
                            {rules === 1 ? m.badges.ruleOne : tb(m.badges.rules, { n: rules })}
                          </span>
                        ) : contact ? (
                          <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {m.badges.contact}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </div>
              )}
            </SortableRow>
          );
        }}
      </SortableList>

      {/* The dashed add button at the end of the list — the Typeform shape,
          where the Pages panel closes with its own "+ Add content" and the
          toolbar carries a second route to the same gallery. It was removed
          once as a "duplicate", then asked back: adding where the questions
          ARE reads better than reaching up to the toolbar. */}
      <button
        type="button"
        onClick={onAdd}
        className="mt-1 flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} />
        {m.shell.addQuestion}
      </button>

      {partialIdx == null && steps.length > 0 ? (
        // No visible partial marker (unset OR out-of-range) → offer to place one
        // after the selected question (fallback: after question 1).
        <button
          type="button"
          data-testid="partial-point-add"
          onClick={() => onPartialChange(Math.min(steps.length, (selectedIndex ?? 0) + 1))}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-secondary/50 py-2 text-xs font-medium text-secondary/90 transition-colors hover:border-secondary hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} />
          {m.partial.add}
        </button>
      ) : null}

      {(() => {
        // Lead-capture nudge: the form asks for an email but has no partial
        // threshold, so a respondent who answers everything and abandons at the
        // end (e.g. a required scheduler) leaves NOTHING behind. Suggest the
        // fix with a one-click "capture after the email question". Only when
        // the email question is not the last step — after the last question a
        // threshold never fires (the final submit already captures it all).
        const emailIdx = steps.findIndex((s) => s.type === 'email' && !s.hidden);
        if (partialIdx != null || emailIdx < 0 || emailIdx >= steps.length - 1) return null;
        return (
          <div
            data-testid="partial-point-suggest"
            className="rounded-xl border border-secondary/40 bg-secondary/[0.06] p-3 text-xs text-muted-foreground"
          >
            <p>{m.partial.suggestEmail}</p>
            <button
              type="button"
              data-testid="partial-point-suggest-apply"
              onClick={() => onPartialChange(emailIdx + 1)}
              className="mt-2 rounded-md border border-secondary/60 px-2.5 py-1 font-medium text-secondary transition-colors hover:bg-secondary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {m.partial.suggestEmailAction}
            </button>
          </div>
        );
      })()}
    </div>
  );
}

/** How many QUESTIONS (non-markers) sit above `markerId` in a merged id list. */
function questionsAbove(list: string[], markerId: string): number {
  const idx = list.indexOf(markerId);
  if (idx < 0) return 0;
  let count = 0;
  for (let i = 0; i < idx; i += 1) if (!isMarker(list[i]!)) count += 1;
  return count;
}

/** How many QUESTIONS (non-markers) sit strictly before merged index `pos`. */
function questionsBeforePosition(list: string[], pos: number): number {
  let count = 0;
  for (let i = 0; i < pos; i += 1) if (!isMarker(list[i]!)) count += 1;
  return count;
}

/** The 0-based step index of `key` among the QUESTIONS (ignoring markers). */
function questionIndex(list: string[], key: string): number {
  let count = 0;
  for (const id of list) {
    if (isMarker(id)) continue;
    if (id === key) return count;
    count += 1;
  }
  return -1;
}

/**
 * A dashed, draggable flow marker row (partial-submit / reveal). Renders a drag
 * grip, a type icon, the label, an info toggle with a popover, and a remove (×).
 * Testids are derived from `testidPrefix` (`{prefix}-row|-handle|-info|-remove`)
 * so each marker keeps a stable, distinct handle for the editor e2e specs.
 */
function SpineMarker({
  testidPrefix,
  icon,
  label,
  moveLabel,
  infoLabel,
  removeLabel,
  tips,
  onRemove,
  handleProps,
}: {
  testidPrefix: string;
  icon: string;
  label: string;
  moveLabel: string;
  infoLabel: string;
  removeLabel: string;
  tips: ReactNode;
  onRemove: () => void;
  handleProps: HTMLAttributes<HTMLElement>;
}) {
  const [infoOpen, setInfoOpen] = useState(false);

  // Escape collapses the popover, matching HelpTip and the app's other
  // overlays — it was the one disclosure the key did nothing on.
  useEffect(() => {
    if (!infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInfoOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [infoOpen]);
  return (
    <div
      data-testid={`${testidPrefix}-row`}
      className="rounded-xl border border-dashed border-secondary/70 bg-secondary/[0.06] py-2 pl-2 pr-2.5"
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          data-testid={`${testidPrefix}-handle`}
          aria-label={moveLabel}
          className="shrink-0 cursor-grab touch-none rounded p-1 text-secondary/70 hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          {...handleProps}
        >
          <i aria-hidden className="pi pi-bars" style={{ fontSize: 12 }} />
        </button>
        <i aria-hidden className={cn('pi shrink-0 text-secondary', icon)} style={{ fontSize: 12 }} />
        <span className="min-w-0 flex-1 text-[11px] font-semibold leading-tight text-secondary">
          {label}
        </span>
        <button
          type="button"
          data-testid={`${testidPrefix}-info`}
          aria-label={infoLabel}
          aria-expanded={infoOpen}
          onClick={() => setInfoOpen((v) => !v)}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <i aria-hidden className="pi pi-info-circle" style={{ fontSize: 12 }} />
        </button>
        <button
          type="button"
          data-testid={`${testidPrefix}-remove`}
          aria-label={removeLabel}
          onClick={() => {
            setInfoOpen(false);
            onRemove();
          }}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <i aria-hidden className="pi pi-times" style={{ fontSize: 12 }} />
        </button>
      </div>
      {infoOpen ? (
        <div className="mt-2 flex flex-col gap-1.5 rounded-lg bg-card/80 p-2 text-[11px] leading-snug text-muted-foreground">
          {tips}
        </div>
      ) : null}
    </div>
  );
}
