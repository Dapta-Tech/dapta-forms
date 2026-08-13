import type { FormConfig, FormOutcome, FormStep, OutcomeRange } from '@quill/engine';
import { isScoreCondition, outcomeRanges } from '@quill/engine';
import { liveGotoRules } from './logic-util';

/**
 * Where every node on the Logic canvas goes — a pure function of the config, so
 * it can be reasoned about and tested without a DOM.
 *
 * The old Logic view drew ONE vertical column and told three lies with it:
 *
 *  1. Mutually exclusive OUTCOMES rendered in series, so four score buckets read
 *     as "first A, then B, then C, then D" — a sequence, when they are choices.
 *  2. Steps gated by a `showWhen` on the running score rendered inline in that
 *     same column, so three score-gated booking screens read as three
 *     consecutive questions rather than three alternatives, exactly one of which
 *     any respondent ever sees.
 *  3. A `goto` target was drawn twice — once as a chip under its source, once as
 *     a node in the column — with no edge connecting them.
 *
 * The fix in all three cases is the same: things that are ALTERNATIVES get
 * parallel rows at the same column, and things that are SEQUENTIAL advance a
 * column. That is the whole model.
 *
 * Positions are DERIVED. `config.logicLayout` may override any node's
 * coordinates (the author dragged it), but the derived layout is always the
 * fallback and the thing "Auto-arrange" restores.
 */

export const NODE_W = 208;
export const NODE_H = 72;
export const COL_GAP = 72;
export const ROW_GAP = 20;
/** The start capsule is a marker, not a card. */
export const START_W = 96;

export interface LayoutNode {
  id: string;
  kind: 'start' | 'step' | 'outcome' | 'end';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Index into `config.steps` — absent on the start capsule and on outcomes. */
  stepIndex?: number;
  step?: FormStep;
  outcome?: FormOutcome;
  /**
   * The span that outcome covers. Resolved here because it is a property of the
   * outcome LIST, not of one outcome: a range with no `maxScore` ends wherever
   * the next one starts. The node carries it so the chip on the canvas cannot
   * re-derive it and disagree with the dialog — which is what it did while it
   * printed every range as `{minScore}+`, including the ones with a ceiling.
   */
  outcomeSpan?: OutcomeRange;
  /** True when the node sits in a parallel branch row rather than the spine. */
  branch: boolean;
  /** True when the author pinned it by dragging (a `logicLayout` override). */
  pinned: boolean;
}

export type EdgeKind = 'flow' | 'goto' | 'outcome';

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /**
   * Rendered on the edge — the answer values that take this jump. Absent on a
   * catch-all, which has no values to name.
   */
  label?: string;
  /**
   * The rule's `values` contain the literal `*`: "any answer at all". There is
   * no option to resolve, so this layout emits a FLAG rather than a label and
   * the renderer supplies the wording — it can read the source node's step type
   * and say "a booking" for a scheduler where "any answer" would be wrong.
   * Words do not belong here: this function is pure and locale-free.
   */
  catchAll?: true;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

/** The condition that decides whether a step appears, if any. */
function gate(step: FormStep): FormStep['showWhen'] | null {
  return step.showWhen ?? null;
}

/**
 * What a step's gate keys off — the running score, another step's answer, or
 * nothing. Two steps sharing a source are alternatives over the SAME question,
 * which is what earns them parallel rows.
 */
function gateSource(step: FormStep): string | null {
  const cond = gate(step);
  if (!cond) return null;
  return isScoreCondition(cond) ? '@score' : cond.field;
}

/**
 * Group the steps into COLUMNS. A run of two or more consecutive steps gated on
 * the same source becomes one column of parallel rows; everything else takes a
 * column of its own.
 *
 * Two is the threshold on purpose. A lone conditional step has nothing to be
 * parallel TO — drawing it off the spine would imply a fork that does not
 * exist — so it stays inline and carries a badge instead.
 */
export function groupIntoColumns(steps: FormStep[]): number[][] {
  const columns: number[][] = [];
  let i = 0;
  while (i < steps.length) {
    const source = gateSource(steps[i]!);
    if (source == null) {
      columns.push([i]);
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < steps.length && gateSource(steps[j]!) === source) j += 1;
    // A run of one is not a fork; keep it on the spine.
    if (j - i === 1) columns.push([i]);
    else columns.push(Array.from({ length: j - i }, (_, k) => i + k));
    i = j;
  }
  return columns;
}

/** Fan `count` rows symmetrically around the spine, tallest group centred. */
function rowOffsets(count: number): number[] {
  const span = NODE_H + ROW_GAP;
  const start = -((count - 1) * span) / 2;
  return Array.from({ length: count }, (_, i) => start + i * span);
}

export function computeLayout(config: FormConfig): Layout {
  const steps = config.steps;
  const overrides = config.logicLayout ?? {};
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  const startNode: LayoutNode = {
    id: '__start__',
    kind: 'start',
    x: 0,
    y: -NODE_H / 2,
    w: START_W,
    h: NODE_H,
    branch: false,
    pinned: false,
  };
  nodes.push(startNode);

  const columns = groupIntoColumns(steps);
  let x = START_W + COL_GAP;
  /** The node ids in the previous column — every one of them flows forward. */
  let previous: string[] = [startNode.id];
  const nodeByStepKey = new Map<string, LayoutNode>();

  for (const column of columns) {
    const offsets = rowOffsets(column.length);
    const current: string[] = [];
    column.forEach((stepIndex, row) => {
      const step = steps[stepIndex]!;
      const pin = overrides[step.key];
      const node: LayoutNode = {
        id: step.key,
        kind: 'step',
        x: pin?.x ?? x,
        y: pin?.y ?? offsets[row]! - NODE_H / 2,
        w: NODE_W,
        h: NODE_H,
        stepIndex,
        step,
        branch: column.length > 1,
        pinned: pin != null,
      };
      nodes.push(node);
      nodeByStepKey.set(step.key, node);
      current.push(node.id);
    });
    for (const from of previous) {
      for (const to of current) edges.push({ id: `${from}->${to}`, from, to, kind: 'flow' });
    }
    previous = current;
    x += NODE_W + COL_GAP;
  }

  // Forward jumps get REAL edges to the target node. The old map drew the
  // target twice — a chip under the source and a node in the column — with
  // nothing joining them, so a jump was something you read rather than traced.
  // A `target: null` rule means "skip to the end": those collect here and get
  // ONE shared terminal node after everything else, so the hardest branch to
  // reason about is visible instead of silently undrawn.
  const skips: Array<{ from: string; ri: number; label?: string; catchAll?: true }> = [];
  for (const step of steps) {
    const from = nodeByStepKey.get(step.key);
    if (!from) continue;
    // Only the rules that can actually run: a step recording no answer (a
    // message, a reveal) can never match a `goto`, so drawing one would
    // promise a jump the respondent never takes.
    for (const [ri, rule] of liveGotoRules(step).entries()) {
      // `*` matches ANY answer, so it is not an option value and resolving it
      // against `step.options` yields the raw asterisk — which is exactly what
      // the canvas used to print on the edge. Flag it instead; the renderer
      // words it.
      const catchAll = rule.values.includes('*');
      const label = catchAll
        ? undefined
        : rule.values
            .map((v) => (step.options ?? []).find((o) => o.value === v)?.label ?? v)
            .join(', ');
      if (rule.target == null) {
        skips.push({ from: from.id, ri, label, ...(catchAll ? { catchAll: true as const } : {}) });
        continue;
      }
      const to = nodeByStepKey.get(rule.target);
      if (!to) continue; // dangling target — normalizeConfig prunes these
      edges.push({
        id: `goto:${step.key}:${ri}`,
        from: from.id,
        to: to.id,
        kind: 'goto',
        label,
        ...(catchAll ? { catchAll: true as const } : {}),
      });
    }
  }

  // Outcomes are ALTERNATIVES, so they fan into parallel rows in one final
  // column. Rendering them in series was the map's most misleading habit: four
  // score buckets looked like four more steps.
  const outcomes = config.outcomes ?? [];
  if (outcomes.length) {
    const offsets = rowOffsets(outcomes.length);
    const spans = outcomeRanges(outcomes);
    outcomes.forEach((outcome, row) => {
      const id = `outcome:${outcome.id}`;
      const pin = overrides[id];
      nodes.push({
        id,
        kind: 'outcome',
        x: pin?.x ?? x,
        y: pin?.y ?? offsets[row]! - NODE_H / 2,
        w: NODE_W,
        h: NODE_H,
        outcome,
        outcomeSpan: spans[row],
        branch: outcomes.length > 1,
        pinned: pin != null,
      });
      for (const from of previous) {
        edges.push({ id: `outcome:${from}->${id}`, from, to: id, kind: 'outcome' });
      }
    });
    x += NODE_W + COL_GAP;
  }

  // The shared "skip to end" terminal. One node no matter how many rules point
  // at it, in its own final column — after the outcomes, because a skip
  // bypasses the remaining QUESTIONS, not the scoring: the respondent still
  // lands on whichever ending their score resolves to.
  if (skips.length) {
    const endNode: LayoutNode = {
      id: '__end__',
      kind: 'end',
      x,
      y: -NODE_H / 2,
      w: START_W,
      h: NODE_H,
      branch: false,
      pinned: false,
    };
    nodes.push(endNode);
    for (const s of skips) {
      edges.push({
        id: `goto-end:${s.from}:${s.ri}`,
        from: s.from,
        to: endNode.id,
        kind: 'goto',
        label: s.label,
        ...(s.catchAll ? { catchAll: true as const } : {}),
      });
    }
  }

  // The bounding box has to come from the PLACED nodes, not the column walk: a
  // pinned node can sit anywhere, and a canvas sized from the derived grid would
  // clip it out of reach with no way to scroll to it.
  const maxX = nodes.reduce((m, n) => Math.max(m, n.x + n.w), 0);
  const minY = nodes.reduce((m, n) => Math.min(m, n.y), 0);
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y + n.h), 0);

  return { nodes, edges, width: maxX, height: maxY - minY };
}

/** The node's centre-right anchor — where an outgoing edge leaves it. */
export const anchorOut = (n: LayoutNode) => ({ x: n.x + n.w, y: n.y + n.h / 2 });
/** The node's centre-left anchor — where an incoming edge arrives. */
export const anchorIn = (n: LayoutNode) => ({ x: n.x, y: n.y + n.h / 2 });

/**
 * A horizontal cubic between two anchors. Control points sit halfway along the
 * span so a fan of edges into one column stays readable instead of collapsing
 * into a single stroke.
 */
export function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = Math.max(24, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}
