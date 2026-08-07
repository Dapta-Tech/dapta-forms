import { describe, expect, it } from 'vitest';
import type { FormConfig, FormStep } from '@quill/engine';
import { computeLayout, groupIntoColumns, NODE_W } from './logic-layout';

const choice = (key: string, extra: Partial<FormStep> = {}): FormStep => ({
  key,
  type: 'multiple_choice',
  selectionMode: 'single',
  question: key,
  options: [
    { label: 'A', value: 'a', points: 1 },
    { label: 'B', value: 'b', points: 5 },
  ],
  ...extra,
});

const cfg = (steps: FormStep[], rest: Partial<FormConfig> = {}): FormConfig =>
  ({ version: 1, steps, ...rest }) as FormConfig;

describe('groupIntoColumns', () => {
  it('gives every plain step its own column', () => {
    const cols = groupIntoColumns([choice('a'), choice('b'), choice('c')]);
    expect(cols).toEqual([[0], [1], [2]]);
  });

  it('groups consecutive steps gated on the SAME source into one column', () => {
    // The real shape this exists for: three booking screens, each shown for a
    // different score band, exactly one of which any respondent ever sees.
    const gate = (min: number): Partial<FormStep> => ({
      showWhen: { field: '@score', op: 'gt', value: min, values: [] },
    });
    const cols = groupIntoColumns([
      choice('q1'),
      choice('book_lo', gate(0)),
      choice('book_mid', gate(5)),
      choice('book_hi', gate(10)),
    ]);
    expect(cols).toEqual([[0], [1, 2, 3]]);
  });

  it('keeps a LONE conditional step on the spine — one branch is not a fork', () => {
    const cols = groupIntoColumns([
      choice('q1'),
      choice('maybe', { showWhen: { field: 'q1', values: ['a'] } }),
      choice('q3'),
    ]);
    expect(cols).toEqual([[0], [1], [2]]);
  });

  it('does not merge runs gated on DIFFERENT sources', () => {
    const cols = groupIntoColumns([
      choice('x', { showWhen: { field: 'q1', values: ['a'] } }),
      choice('y', { showWhen: { field: 'q2', values: ['a'] } }),
    ]);
    expect(cols).toEqual([[0], [1]]);
  });
});

describe('computeLayout', () => {
  const gate = (min: number): Partial<FormStep> => ({
    showWhen: { field: '@score', op: 'gt', value: min, values: [] },
  });

  it('advances a column per sequential step and shares one for alternatives', () => {
    const { nodes } = computeLayout(
      cfg([choice('q1'), choice('lo', gate(0)), choice('hi', gate(5))]),
    );
    const at = (id: string) => nodes.find((n) => n.id === id)!;
    expect(at('lo').x).toBe(at('hi').x); // alternatives share a column…
    expect(at('lo').y).not.toBe(at('hi').y); // …on different rows
    expect(at('q1').x).toBeLessThan(at('lo').x); // sequence advances
    expect(at('lo').branch).toBe(true);
    expect(at('q1').branch).toBe(false);
  });

  it('fans outcomes into parallel rows, never a series', () => {
    // The old map rendered these with a connector between each, so four score
    // buckets read as four more steps in sequence.
    const { nodes } = computeLayout(
      cfg([choice('q1')], {
        outcomes: [
          { id: 'a', label: 'A', minScore: 0 },
          { id: 'b', label: 'B', minScore: 5 },
          { id: 'c', label: 'C', minScore: 9 },
        ],
      }),
    );
    const outs = nodes.filter((n) => n.kind === 'outcome');
    expect(outs).toHaveLength(3);
    expect(new Set(outs.map((o) => o.x)).size).toBe(1); // one column
    expect(new Set(outs.map((o) => o.y)).size).toBe(3); // three rows
  });

  it('draws a real edge to a goto target instead of duplicating it', () => {
    const { edges } = computeLayout(
      cfg([choice('q1', { goto: [{ values: ['a'], target: 'q3' }] }), choice('q2'), choice('q3')]),
    );
    const jump = edges.find((e) => e.kind === 'goto');
    expect(jump).toMatchObject({ from: 'q1', to: 'q3' });
    expect(jump?.label).toBe('A'); // the option LABEL, not the raw value
  });

  it('drops a goto edge whose target no longer exists', () => {
    const { edges } = computeLayout(
      cfg([choice('q1', { goto: [{ values: ['a'], target: 'deleted' }] })]),
    );
    expect(edges.filter((e) => e.kind === 'goto')).toHaveLength(0);
  });

  it('connects every row of a parallel column forward, not just the first', () => {
    const { edges } = computeLayout(
      cfg([choice('lo', gate(0)), choice('hi', gate(5)), choice('after')]),
    );
    const incoming = edges.filter((e) => e.kind === 'flow' && e.to === 'after');
    expect(new Set(incoming.map((e) => e.from))).toEqual(new Set(['lo', 'hi']));
  });

  it('honours a pinned position over the derived one', () => {
    const { nodes } = computeLayout(
      cfg([choice('q1'), choice('q2')], { logicLayout: { q2: { x: 999, y: -400 } } }),
    );
    const q2 = nodes.find((n) => n.id === 'q2')!;
    expect({ x: q2.x, y: q2.y }).toEqual({ x: 999, y: -400 });
    expect(q2.pinned).toBe(true);
  });

  it('sizes the canvas from PLACED nodes, so a pinned node is never clipped away', () => {
    const derived = computeLayout(cfg([choice('q1'), choice('q2')]));
    const pinned = computeLayout(
      cfg([choice('q1'), choice('q2')], { logicLayout: { q2: { x: 4000, y: 0 } } }),
    );
    expect(pinned.width).toBeGreaterThan(derived.width);
    expect(pinned.width).toBeGreaterThanOrEqual(4000 + NODE_W);
  });

  it('always emits a start node, even for an empty form', () => {
    const { nodes } = computeLayout(cfg([]));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.kind).toBe('start');
  });
});
