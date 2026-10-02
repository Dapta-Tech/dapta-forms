import { describe, expect, it } from 'vitest';
import type { FormConfig } from '@quill/types';
import {
  parseAnswerFilters,
  parseScore,
  parseSort,
  parseSearch,
  parseSubmissionFilter,
} from './submission-filter';

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

describe('parseSearch', () => {
  const withName = {
    steps: [
      ...config.steps,
      { key: 'who', type: 'name', question: 'Name' },
      { key: 'mail', type: 'email', question: 'Email' },
    ],
  } as unknown as FormConfig;

  it("searches the form's written answers only, a name by its sub-fields", () => {
    const s = parseSearch('  ana  ', withName);
    expect(s?.query).toBe('ana');
    expect(s?.fields).toContain('notes');
    expect(s?.fields).toContain('mail');
    expect(s?.fields).toEqual(expect.arrayContaining(['firstname', 'lastname']));
    // Choice steps store option values, and have their own filter.
    expect(s?.fields).not.toContain('kind');
    expect(s?.fields).not.toContain('tools');
  });

  it('is no filter when blank, not a string, or the form asks nothing written', () => {
    expect(parseSearch('   ', withName)).toBeUndefined();
    expect(parseSearch(undefined, withName)).toBeUndefined();
    expect(parseSearch(['a'], withName)).toBeUndefined();
    const choicesOnly = { steps: config.steps.filter((st) => st.type !== 'text') } as FormConfig;
    expect(parseSearch('ana', choicesOnly)).toBeUndefined();
  });

  it('cuts a search past the limit instead of refusing it', () => {
    expect(parseSearch('x'.repeat(500), withName)?.query).toHaveLength(200);
    expect(parseSubmissionFilter({ search: 'ana' }, withName, 'UTC').search?.query).toBe('ana');
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

  it('rounds a score bound inward and holds it to int32, as the integer column compares it', () => {
    const read = (scoreMin: string, scoreMax: string) => {
      const f = parseSubmissionFilter({ scoreMin, scoreMax }, config, 'UTC');
      return [f.scoreMin, f.scoreMax];
    };
    expect(read('5.5', '5.5')).toEqual([6, 5]);
    expect(read('-2.5', '-2.5')).toEqual([-2, -3]);
    expect(read('1e20', '1e20')).toEqual([2_147_483_647, 2_147_483_647]);
    expect(read('-1e20', '-1e20')).toEqual([-2_147_483_648, -2_147_483_648]);
    expect(read('Infinity', 'NaN')).toEqual([null, null]);
    expect(parseScore('7', 'min')).toBe(7);
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
