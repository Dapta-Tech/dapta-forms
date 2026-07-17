'use client';

import { useState } from 'react';
import type { FormStep } from '@quill/engine';
import { cn } from '@/lib/cn';
import { SortableList, SortableRow } from './sortable';
import { iconForStep, isContactType } from './question-types';
import { ruleCount } from './logic-util';
import type { BuilderMessages } from './builder-messages';
import { tb } from './builder-messages';

/**
 * Sortable id for the partial-submit-point marker. Never a real step key (step
 * keys are slugified question text), so it can share the dnd id space safely.
 */
const PARTIAL_ID = '__partial_submit_point__';

/**
 * The left flow spine — numbered question cards (drag to reorder), a type icon,
 * the truncated title, a purple "Logic" badge when the question carries rules,
 * and a muted "Contact" badge for auto-detected contact fields. The selected
 * card gets a lime left rail. One dashed "+ Add question" at the bottom opens
 * the type gallery.
 *
 * When `partialAfterStep` is set (1..steps.length) a dashed, unnumbered
 * "Partial submit point" marker renders after that step, INSIDE the same
 * dnd-kit list (special id), so it drags exactly like a question. Drops are
 * translated back into domain updates in `handleReorder`.
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
  const [infoOpen, setInfoOpen] = useState(false);

  // Merged sortable ids: step keys with the marker spliced in at its 1-based
  // position. An out-of-range threshold renders no marker (and the add
  // affordance below offers to re-place it).
  const markerIdx =
    partialAfterStep != null && partialAfterStep >= 1 && partialAfterStep <= steps.length
      ? partialAfterStep
      : null;
  const ids = steps.map((s) => s.key);
  if (markerIdx != null) ids.splice(markerIdx, 0, PARTIAL_ID);

  /**
   * Translate a merged-list drop back into a domain update:
   * - the MARKER moved → the new threshold is however many questions ended up
   *   above it, clamped to ≥ 1 (a partial point above every question is
   *   invalid — the minimum is "after question 1");
   * - a QUESTION moved → a plain step reorder. The editor's `reorderSteps`
   *   re-anchors the threshold to the step it was after, so the marker follows
   *   its anchor question.
   */
  function handleReorder(from: number, to: number) {
    if (markerIdx == null) {
      onReorder(from, to);
      return;
    }
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    if (moved === PARTIAL_ID) {
      const threshold = Math.max(1, next.indexOf(PARTIAL_ID));
      if (threshold !== partialAfterStep) onPartialChange(threshold);
      return;
    }
    const fromStep = ids.filter((x) => x !== PARTIAL_ID).indexOf(moved);
    const toStep = next.filter((x) => x !== PARTIAL_ID).indexOf(moved);
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
            const atEnd = markerIdx === steps.length;
            return (
              <SortableRow key={id} id={id}>
                {({ handleProps }) => (
                  <div
                    data-testid="partial-point-row"
                    className="rounded-xl border border-dashed border-secondary/70 bg-secondary/[0.06] py-2 pl-2 pr-2.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        data-testid="partial-point-handle"
                        aria-label={m.partial.move}
                        className="shrink-0 cursor-grab touch-none rounded p-1 text-secondary/70 hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                        {...handleProps}
                      >
                        <i aria-hidden className="pi pi-bars" style={{ fontSize: 12 }} />
                      </button>
                      <i aria-hidden className="pi pi-send shrink-0 text-secondary" style={{ fontSize: 12 }} />
                      <span className="min-w-0 flex-1 text-[11px] font-semibold leading-tight text-secondary">
                        {m.partial.label}
                      </span>
                      <button
                        type="button"
                        data-testid="partial-point-info"
                        aria-label={m.partial.info}
                        aria-expanded={infoOpen}
                        onClick={() => setInfoOpen((v) => !v)}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <i aria-hidden className="pi pi-info-circle" style={{ fontSize: 12 }} />
                      </button>
                      <button
                        type="button"
                        data-testid="partial-point-remove"
                        aria-label={m.partial.remove}
                        onClick={() => {
                          setInfoOpen(false);
                          onPartialChange(undefined);
                        }}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <i aria-hidden className="pi pi-times" style={{ fontSize: 12 }} />
                      </button>
                    </div>
                    {infoOpen ? (
                      <div className="mt-2 flex flex-col gap-1.5 rounded-lg bg-card/80 p-2 text-[11px] leading-snug text-muted-foreground">
                        <p>{m.partial.tipCapture}</p>
                        <p>{m.partial.tipStored}</p>
                        <p>{m.partial.tipNotify}</p>
                        {atEnd ? <p>{m.partial.tipAfterLast}</p> : null}
                        <p className="font-medium text-foreground">{m.partial.tipWhere}</p>
                      </div>
                    ) : null}
                  </div>
                )}
              </SortableRow>
            );
          }

          // Question rows sit in the MERGED list — indices past the marker are
          // shifted one slot; translate back to the step index.
          const stepIndex = markerIdx != null && index > markerIdx ? index - 1 : index;
          const step = steps[stepIndex];
          if (!step) return null;
          const active = stepIndex === selectedIndex;
          const rules = ruleCount(step);
          const contact = isContactType(step.type);
          const title = step.question?.trim();
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
                        {title || m.canvas.titlePlaceholder}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
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

      <button
        type="button"
        onClick={onAdd}
        className="mt-1 flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} />
        {m.shell.addQuestion}
      </button>

      {markerIdx == null && steps.length > 0 ? (
        // No visible marker (unset OR out-of-range) → offer to place one after
        // the selected question (fallback: after question 1).
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
    </div>
  );
}
