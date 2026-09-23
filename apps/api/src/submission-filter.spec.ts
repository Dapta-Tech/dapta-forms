import { describe, expect, it } from 'vitest';
import type { FormConfig } from '@quill/types';
import { parseAnswerFilters, parseSort, parseSubmissionFilter } from './submission-filter';

const config = {
  steps: [
    { key: 'kind', type: 'dropdown', question: 'Kind', options: [] },
    { key: 'tools', type: 'multiple_choice', question: 'Tools', options: [] },
    { key: 'notes', type: 'text', question: 'Notes' },
  ],
} as unknown as FormConfig;

describe('parseAnswerFilters', () => {
  it("keeps only the form's choice steps, trimmed and deduplicated", () => {
    const raw = JSON.stringify({
      kind: [' llc ', 'llc', ''],
      tools: [],
      notes: ['x'],
      ghost: ['y'],
    });
    expect(parseAnswerFilters(raw, config)).toEqual({ kind: ['llc'] });
    expect(parseAnswerFilters(undefined, config)).toBeUndefined();
    expect(parseAnswerFilters('', config)).toBeUndefined();
    expect(parseAnswerFilters(JSON.stringify({ ghost: ['y'] }), config)).toBeUndefined();
  });

  it('refuses anything that is not an object of string lists', () => {
    for (const bad of [
      '{',
      '[]',
      'null',
      '"x"',
      JSON.stringify({ kind: 'llc' }),
      JSON.stringify({ kind: [1] }),
    ]) {
      expect(() => parseAnswerFilters(bad, config)).toThrow();
    }
    expect(() => parseAnswerFilters(['a', 'b'], config)).toThrow();
    expect(() =>
      parseAnswerFilters(JSON.stringify({ kind: Array(101).fill('a') }), config),
    ).toThrow();
    expect(() => parseAnswerFilters('x'.repeat(20_000), config)).toThrow();
  });
});

describe('parseSubmissionFilter', () => {
  it('reads status, a day window in the zone, and score bounds', () => {
    const f = parseSubmissionFilter(
      { status: 'partial', from: '2026-09-03', to: '2026-09-03', scoreMin: '4', scoreMax: 'x' },
      config,
      'America/Bogota',
    );
    expect(f.status).toBe('partial');
    expect(f.from).toBe(Date.UTC(2026, 8, 3, 5));
    expect(f.to).toBe(Date.UTC(2026, 8, 4, 5) - 1);
    expect(f.scoreMin).toBe(4);
    expect(f.scoreMax).toBeNull();
  });

  it('ignores score bounds and score sorts on a form that does not score', () => {
    const plain = { ...config, scoring: { enabled: false } } as FormConfig;
    expect(parseSubmissionFilter({ scoreMin: '4' }, plain, 'UTC').scoreMin).toBeNull();
    expect(parseSort('score_desc', plain)).toBe('newest');
    expect(parseSort('score_desc', config)).toBe('score_desc');
    expect(parseSort('oldest', config)).toBe('oldest');
    expect(parseSort('random', config)).toBe('newest');
    expect(parseSort(['oldest'], config)).toBe('newest');
  });

  it('reads an old `?status=` link the same as before', () => {
    expect(parseSubmissionFilter({ status: 'completed' }, config, 'UTC')).toMatchObject({
      status: 'completed',
      answers: undefined,
    });
  });
});
