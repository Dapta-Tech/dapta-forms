'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormConfig, FormStep } from '@quill/engine';
import { conditionNeverHolds, conditionsContradict } from '@quill/engine';
import { cn } from '@/lib/cn';
import { iconForStep } from './question-types';
import { describeCondition, liveRuleCount } from './logic-util';
import {
  anchorIn,
  anchorOut,
  computeLayout,
  edgePath,
  NODE_H,
  type LayoutNode,
} from './logic-layout';
import { tb, type BuilderMessages } from './builder-messages';

/**
 * The Logic canvas: the form's routing drawn left-to-right, with alternatives as
 * parallel rows and forward jumps as real edges.
 *
 * Layout is computed in `logic-layout.ts` (pure, tested). This file is the
 * viewport: pan, zoom, level-of-detail, the per-node hover controls, and drag.
 *
 * DRAG has two meanings and they are deliberately distinguishable by where you
 * drop, because the config offers no third option: step ORDER is the array
 * order, and there are no coordinates in it. So dropping a node back on the
 * spine REORDERS the step (the same mutation the left rail performs), and
 * dropping it anywhere else PINS it — a `logicLayout` override that only the
 * builder reads. "Auto-arrange" drops every override at once, which is the
 * escape hatch that keeps pinning from rotting: a pinned node whose step later
 * moved would otherwise sit where it no longer belongs.
 */

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.6;
/** Below this, a node is a coloured chip — its title would be unreadable anyway. */
const LOD_TITLE = 0.55;
/** Above this there is room for the rule summary under the title. */
const LOD_DETAIL = 0.9;
/** How close to the spine a drop counts as "back on the spine" (reorder). */
const SPINE_BAND = NODE_H;

export function LogicCanvas({
  config,
  m,
  onEditStep,
  onEditOutcomes,
  onMoveStep,
  onPinNode,
  onAutoArrange,
}: {
  config: FormConfig;
  m: BuilderMessages;
  /** Open the per-question logic dialog for `index`. */
  onEditStep: (index: number) => void;
  /** Open the form-wide outcomes dialog. */
  onEditOutcomes: () => void;
  /** Reorder a step — the same mutation the question rail performs. */
  onMoveStep: (from: number, to: number) => void;
  /** Pin (or, with `null`, unpin) one node's position. */
  onPinNode: (id: string, pos: { x: number; y: number } | null) => void;
  onAutoArrange: () => void;
}) {
  const layout = useMemo(() => computeLayout(config), [config]);
  const [zoom, setZoom] = useState(0.8);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panning = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  // The wheel listener is bound ONCE (non-passive, so it can preventDefault),
  // which means it cannot read `zoom` from its closure. It reads the live value
  // from here — and writes the new one back — so consecutive ticks inside a
  // single frame still compound, exactly as a `setZoom` updater used to.
  const zoomRef = useRef(zoom);
  // EVERY zoom change goes through here, so the ref can never lag the state:
  // a wheel tick that lands between a button click and the next render still
  // compounds on the button's step instead of overwriting it.
  const applyZoom = useCallback((next: number) => {
    zoomRef.current = next;
    setZoom(next);
  }, []);

  // Centre the graph on first paint (and whenever the form's shape changes
  // enough to move the bounding box) rather than pinning it to a corner.
  const fit = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const next = Math.min(1, Math.max(MIN_ZOOM, (box.width - 64) / Math.max(1, layout.width)));
    applyZoom(next);
    setPan({ x: 32, y: box.height / 2 });
  }, [layout.width, applyZoom]);

  useEffect(() => {
    fit();
    // Only on mount and when the graph's extent changes — refitting on every
    // keystroke would yank the view out from under an author mid-edit.
  }, [fit]);

  // Wheel zooms toward the pointer. Non-passive so the page behind never
  // scrolls while the canvas is under the cursor.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const px = e.clientX - box.left;
      const py = e.clientY - box.top;
      // Both values are computed FIRST and the setters called in sequence.
      // Nesting `setPan` inside `setZoom`'s updater made that updater impure,
      // and React double-invokes updaters under StrictMode — so in `pnpm dev`
      // every tick enqueued the pan delta twice and the zoom drifted off the
      // cursor. Production applied it once, which is why it only bit in dev.
      const z = zoomRef.current;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      applyZoom(next);
      // Keep the graph point under the cursor fixed while the scale changes.
      setPan((p) => ({ x: px - ((px - p.x) * next) / z, y: py - ((py - p.y) * next) / z }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const toGraph = (clientX: number, clientY: number) => {
    const box = viewportRef.current!.getBoundingClientRect();
    return { x: (clientX - box.left - pan.x) / zoom, y: (clientY - box.top - pan.y) / zoom };
  };

  function startPan(e: React.PointerEvent) {
    if (e.button !== 0) return;
    panning.current = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function movePan(e: React.PointerEvent) {
    if (drag) {
      const p = toGraph(e.clientX, e.clientY);
      setDrag((d) => (d ? { ...d, x: p.x - d.dx, y: p.y - d.dy } : d));
      return;
    }
    const start = panning.current;
    if (!start) return;
    setPan({ x: start.x + (e.clientX - start.px), y: start.y + (e.clientY - start.py) });
  }
  function endPan(e: React.PointerEvent) {
    panning.current = null;
    if (!drag) return;
    commitDrag();
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  /**
   * Resolve a drop. Back on the spine → reorder by the x it landed at, and drop
   * any pin so the node returns to the derived grid. Off the spine → pin.
   */
  function commitDrag() {
    const d = drag;
    setDrag(null);
    if (!d) return;
    const node = layout.nodes.find((n) => n.id === d.id);
    if (!node || node.stepIndex == null) {
      if (node) onPinNode(d.id, { x: d.x, y: d.y });
      return;
    }
    const onSpine = Math.abs(d.y + NODE_H / 2) < SPINE_BAND;
    if (!onSpine) {
      onPinNode(d.id, { x: d.x, y: d.y });
      return;
    }
    // Rank the dropped node against the other steps by their laid-out x.
    const others = layout.nodes
      .filter((n) => n.stepIndex != null && n.id !== d.id)
      .sort((a, b) => a.x - b.x);
    let to = others.filter((n) => n.x + n.w / 2 < d.x + node.w / 2).length;
    to = Math.min(config.steps.length - 1, Math.max(0, to));
    onPinNode(d.id, null);
    if (to !== node.stepIndex) onMoveStep(node.stepIndex, to);
  }

  const nodePos = (n: LayoutNode) => (drag?.id === n.id ? { x: drag.x, y: drag.y } : { x: n.x, y: n.y });

  if (config.steps.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">{m.map.empty}</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="logic-map">
      <div
        ref={viewportRef}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        data-testid="logic-canvas-viewport"
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:20px_20px]',
          drag ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          {/* Edges first so nodes paint over them. The SVG is deliberately
              oversized and offset: node coordinates are centred on the spine, so
              half the graph lives at negative y. */}
          <svg
            className="pointer-events-none absolute overflow-visible"
            style={{ left: 0, top: 0, width: 1, height: 1 }}
            aria-hidden
          >
            {layout.edges.map((e) => {
              const from = layout.nodes.find((n) => n.id === e.from);
              const to = layout.nodes.find((n) => n.id === e.to);
              if (!from || !to) return null;
              const a = anchorOut({ ...from, ...nodePos(from) });
              const b = anchorIn({ ...to, ...nodePos(to) });
              // A catch-all rule (`values: ['*']`) has no option to name, so the
              // layout flags it and the wording is chosen HERE, where the
              // messages are: a scheduler's "any answer" is a booking. Without
              // this the edge printed a bare asterisk.
              const label = e.catchAll
                ? from.step?.type === 'scheduler'
                  ? m.branching.anyBooking
                  : m.branching.anyAnswer
                : e.label;
              return (
                <g key={e.id} data-testid={`logic-edge-${e.kind}`}>
                  <path
                    d={edgePath(a, b)}
                    fill="none"
                    strokeWidth={e.kind === 'goto' ? 2 : 1.5}
                    className={e.kind === 'goto' ? 'stroke-secondary' : 'stroke-border'}
                    strokeDasharray={e.kind === 'goto' ? '5 4' : undefined}
                  />
                  {label && zoom >= LOD_TITLE ? (
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 - 6}
                      textAnchor="middle"
                      className="fill-secondary text-[10px] font-semibold"
                    >
                      {label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>

          {layout.nodes.map((n) => {
            const pos = nodePos(n);
            return (
              <div
                key={n.id}
                style={{ left: pos.x, top: pos.y, width: n.w, height: n.h }}
                className="absolute"
                onPointerDown={(e) => {
                  // Start and End are markers, not cards — nothing to drag.
                  if (n.kind === 'start' || n.kind === 'end') return;
                  e.stopPropagation();
                  // stopPropagation means the viewport's own pointerdown (which
                  // would have captured) never runs — so capture HERE, on the
                  // viewport element that owns the move/up handlers. Without
                  // this, releasing outside the canvas leaves the drag armed
                  // and the node re-attaches to the pointer on re-entry.
                  viewportRef.current?.setPointerCapture(e.pointerId);
                  const p = toGraph(e.clientX, e.clientY);
                  setDrag({ id: n.id, dx: p.x - pos.x, dy: p.y - pos.y, x: pos.x, y: pos.y });
                }}
              >
                {n.kind === 'start' ? (
                  <StartNode label={m.map.start} />
                ) : n.kind === 'end' ? (
                  <EndNode label={m.map.end} />
                ) : n.kind === 'outcome' ? (
                  <OutcomeNode node={n} zoom={zoom} m={m} onOpen={onEditOutcomes} />
                ) : (
                  <StepNode node={n} zoom={zoom} steps={config.steps} m={m} onEdit={onEditStep} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-3 py-1.5">
        <ZoomButton icon="pi-minus" label={m.map.zoomOut} onClick={() => applyZoom(Math.max(MIN_ZOOM, zoomRef.current / 1.2))} testId="logic-zoom-out" />
        <span className="w-12 text-center text-xs tabular-nums text-muted-foreground" data-testid="logic-zoom-level">
          {Math.round(zoom * 100)}%
        </span>
        <ZoomButton icon="pi-plus" label={m.map.zoomIn} onClick={() => applyZoom(Math.min(MAX_ZOOM, zoomRef.current * 1.2))} testId="logic-zoom-in" />
        <ZoomButton icon="pi-arrows-alt" label={m.map.zoomFit} onClick={fit} testId="logic-zoom-fit" />
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          onClick={onAutoArrange}
          data-testid="logic-auto-arrange"
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <i aria-hidden className="pi pi-sparkles" style={{ fontSize: 11 }} />
          {m.map.autoArrange}
        </button>
        <span className="ml-auto text-[11px] text-muted-foreground">{m.map.dragHint}</span>
      </div>
    </div>
  );
}

function ZoomButton({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testId}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <i aria-hidden className={`pi ${icon}`} style={{ fontSize: 11 }} />
    </button>
  );
}

function StartNode({ label }: { label: string }) {
  return (
    <span
      data-testid="logic-start"
      className="inline-flex h-full items-center gap-2 rounded-full border border-primary-edge/40 bg-primary/[0.08] px-4"
    >
      <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-primary" />
      <span className="text-xs font-semibold uppercase tracking-wide text-primary">{label}</span>
    </span>
  );
}

/** The shared "skip to end" terminal — every `target: null` jump lands here. */
function EndNode({ label }: { label: string }) {
  return (
    <span
      data-testid="logic-end"
      className="inline-flex h-full items-center gap-2 rounded-full border border-primary-edge/50 bg-primary/[0.08] px-4"
    >
      <i aria-hidden className="pi pi-flag-fill text-primary" style={{ fontSize: 10 }} />
      <span className="text-xs font-semibold uppercase tracking-wide text-primary">{label}</span>
    </span>
  );
}

/**
 * A question. Detail scales with zoom: far out it is a numbered chip whose
 * title would be illegible anyway; closer in the title appears, then the rule
 * summary under it.
 */
function StepNode({
  node,
  zoom,
  steps,
  m,
  onEdit,
}: {
  node: LayoutNode;
  zoom: number;
  steps: FormStep[];
  m: BuilderMessages;
  onEdit: (index: number) => void;
}) {
  const step = node.step!;
  const index = node.stepIndex!;
  // An inlined copy of `ruleCount` used to live here; it counted a stale
  // catch-all on a message/reveal and coloured this node's border for a rule
  // that can never fire. `liveRuleCount` is the one definition every surface
  // reads — see its doc comment, which names this border specifically.
  const rules = liveRuleCount(step);
  // Both audits the old map already performed, kept because this is the screen
  // an author opens to find out WHY a question never appears.
  const broken =
    conditionsContradict(step.showWhen, step.hideWhen) || !!conditionNeverHolds(step.showWhen);
  const title = step.question?.trim() || tb(m.canvas.questionN, { n: index + 1 });

  return (
    <div
      data-testid="logic-node"
      data-step-key={step.key}
      className={cn(
        'group relative flex h-full w-full select-none flex-col justify-center gap-0.5 rounded-xl border bg-card px-3 shadow-sm',
        broken ? 'border-destructive/60' : rules > 0 ? 'border-secondary/50' : 'border-border',
        node.pinned && 'ring-1 ring-secondary/40',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums',
            rules > 0 ? 'bg-secondary/15 text-secondary' : 'bg-muted text-muted-foreground',
          )}
        >
          {index + 1}
        </span>
        <i aria-hidden className={`pi ${iconForStep(step)} shrink-0 text-muted-foreground`} style={{ fontSize: 12 }} />
        {zoom >= LOD_TITLE ? (
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{title}</span>
        ) : null}
        {step.hidden ? (
          <span
            data-testid="logic-hidden-badge"
            className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground"
          >
            {m.badges.hidden}
          </span>
        ) : null}
      </div>

      {zoom >= LOD_DETAIL && (step.showWhen || step.hideWhen) ? (
        <ConditionLine step={step} steps={steps} m={m} />
      ) : null}

      {broken ? (
        <span
          data-testid="logic-never-appears"
          className="truncate text-[10px] font-medium text-destructive"
        >
          {m.map.neverAppears}
        </span>
      ) : null}

      {/* Hover controls. One opens the question's whole logic; the pointerdown
          guard keeps a click on them from starting a drag of the node. */}
      <div className="absolute -bottom-3 left-1/2 flex -translate-x-1/2 gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <NodeAction
          icon="pi-sitemap"
          label={tb(m.branching.editAria, { question: title })}
          testId="logic-node-edit"
          onClick={() => onEdit(index)}
        />
      </div>
    </div>
  );
}

function NodeAction({
  icon,
  label,
  testId,
  onClick,
}: {
  icon: string;
  label: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-popover text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <i aria-hidden className={`pi ${icon}`} style={{ fontSize: 10 }} />
    </button>
  );
}

/** One show/hide rule as a sentence — the same describer the list view uses. */
function ConditionLine({ step, steps, m }: { step: FormStep; steps: FormStep[]; m: BuilderMessages }) {
  const cond = step.showWhen ?? step.hideWhen!;
  const show = !!step.showWhen;
  const d = describeCondition(cond, steps, {
    fallbackQuestion: (i) => tb(m.canvas.questionN, { n: i + 1 }),
    opIn: m.map.condIn,
    opEq: m.map.condEq,
    opGt: m.map.condGt,
    opLt: m.map.condLt,
    opBetween: m.map.condBetween,
    and: m.map.condAnd,
    blank: m.map.condBlank,
    score: m.map.condScore,
  });
  return (
    <span
      data-testid={`logic-cond-${show ? 'show' : 'hide'}`}
      className="truncate text-[10px] leading-tight text-muted-foreground"
    >
      <span className={cn('font-semibold', show ? 'text-secondary' : 'text-destructive')}>
        {show ? m.map.condShowIf : m.map.condHideIf}
      </span>{' '}
      {d.field} {d.operator} {d.operand}
    </span>
  );
}

/** A terminal score bucket. Opening it goes to the form-wide outcomes editor. */
function OutcomeNode({
  node,
  zoom,
  m,
  onOpen,
}: {
  node: LayoutNode;
  zoom: number;
  m: BuilderMessages;
  onOpen: () => void;
}) {
  const outcome = node.outcome!;
  const redirects = !!outcome.redirectUrl;
  return (
    <div
      data-testid="logic-outcome"
      className={cn(
        'group flex h-full w-full select-none flex-col justify-center gap-0.5 rounded-xl border border-primary-edge/50 bg-primary/[0.06] px-3 shadow-sm',
        node.pinned && 'ring-1 ring-secondary/40',
      )}
    >
      <div className="flex items-center gap-2">
        <i
          aria-hidden
          className={`pi ${redirects ? 'pi-external-link' : 'pi-flag-fill'} shrink-0 text-primary`}
          style={{ fontSize: 12 }}
        />
        {zoom >= LOD_TITLE ? (
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
            {outcome.label || m.map.outcomeKicker}
          </span>
        ) : null}
        <span className="shrink-0 rounded bg-primary/15 px-1 py-0.5 text-[9px] font-bold tabular-nums text-primary">
          {outcome.minScore ?? 0}+
        </span>
      </div>
      {zoom >= LOD_DETAIL && redirects ? (
        <span className="truncate text-[10px] text-muted-foreground">
          {tb(m.map.redirect, { url: (outcome.redirectUrl ?? '').replace(/^https?:\/\//, '') })}
        </span>
      ) : null}
      <div className="absolute -bottom-3 left-1/2 flex -translate-x-1/2 gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <NodeAction icon="pi-flag" label={m.outcomes.open} testId="logic-outcome-edit" onClick={onOpen} />
      </div>
    </div>
  );
}
