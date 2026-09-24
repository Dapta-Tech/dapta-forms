import { describe, expect, it } from 'vitest';
import {
  apiFilterQuery,
  dateWindow,
  EMPTY_FILTER,
  filterParams,
  isCustomized,
  isFiltered,
  parseViewFilter,
  withFilter,
} from './filters';

const scope = { choiceKeys: new Set(['kind', 'tools']), scoring: true };

describe('parseViewFilter', () => {
  it('reads an old ?status= link as the Status filter', () => {
    expect(parseViewFilter({ status: 'completed' }, scope).statuses).toEqual(['completed']);
    expect(parseViewFilter({ status: ['partial', 'completed'] }, scope).statuses).toEqual([
      'completed',
      'partial',
    ]);
    expect(parseViewFilter({ status: 'all' }, scope).statuses).toEqual([]);
  });

  it('keeps within the API limits, so a hand-made URL narrows less instead of failing', () => {
    const many = Array.from({ length: 150 }, (_, i) => `v${i}`);
    const f = parseViewFilter({ 'f.kind': [...many, 'x'.repeat(501)], 'f.tools': 'crm' }, scope);
    expect(f.answers.kind).toHaveLength(100);
    expect(f.answers.kind).not.toContain('x'.repeat(501));
    expect(f.answers.tools).toEqual(['crm']);
    // Long values that fit one by one can still overflow the API's JSON limit together.
    const long = Array.from({ length: 100 }, (_, i) => `${i}`.padEnd(500, 'y'));
    const big = parseViewFilter({ 'f.kind': long, 'f.tools': long }, scope);
    const json = apiFilterQuery(big, 'UTC').answers!;
    expect(json.length).toBeLessThanOrEqual(16_384);
    expect(big.answers.kind!.length).toBeGreaterThan(0);
    expect(big.answers.kind).toEqual(long.slice(0, big.answers.kind!.length));
  });

  it("keeps only the form's choice questions, trimmed and deduplicated", () => {
    const f = parseViewFilter(
      { 'f.kind': ['llc', ' llc ', ''], 'f.notes': 'x', 'f.ghost': 'y', 'f.tools': 'crm' },
      scope,
    );
    expect(f.answers).toEqual({ kind: ['llc'], tools: ['crm'] });
  });

  it('reads the same filter from URLSearchParams', () => {
    const q = new URLSearchParams('f.kind=a&f.kind=b&sort=oldest&range=7d&from=2026-01-01');
    expect(parseViewFilter(q, scope)).toMatchObject({
      answers: { kind: ['a', 'b'] },
      sort: 'oldest',
      preset: '7d',
      from: null,
    });
  });

  it('drops the score on a form that does not score, and puts a reversed pair right', () => {
    const plain = { ...scope, scoring: false };
    expect(parseViewFilter({ scoreMin: '3', sort: 'score_desc' }, plain)).toMatchObject({
      scoreMin: null,
      sort: 'newest',
    });
    expect(parseViewFilter({ scoreMin: '9', scoreMax: '2' }, scope)).toMatchObject({
      scoreMin: 2,
      scoreMax: 9,
    });
    expect(parseViewFilter({ scoreMin: 'x' }, scope).scoreMin).toBeNull();
    expect(parseViewFilter({ from: '2026-09-10', to: '2026-09-01' }, scope)).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-10',
    });
    expect(parseViewFilter({ from: 'yesterday' }, scope).from).toBeNull();
  });

  it('tells a filter from a sort alone', () => {
    expect(isFiltered(EMPTY_FILTER)).toBe(false);
    expect(isCustomized({ ...EMPTY_FILTER, sort: 'oldest' })).toBe(true);
    expect(isFiltered({ ...EMPTY_FILTER, sort: 'oldest' })).toBe(false);
    expect(isFiltered({ ...EMPTY_FILTER, scoreMax: 3 })).toBe(true);
  });
});

describe('the filter in the address bar', () => {
  it('round-trips through the URL', () => {
    const f = parseViewFilter(
      { status: 'partial', 'f.kind': ['b', 'a'], scoreMin: '4', sort: 'score_asc', range: '30d' },
      scope,
    );
    expect(parseViewFilter(filterParams(f), scope)).toEqual(f);
  });

  it('replaces the filter, keeps the sheet and the page size, and resets the page and the open response', () => {
    const next = withFilter('?view=sheet&size=50&offset=25&response=r1&status=completed&f.kind=a', {
      ...EMPTY_FILTER,
      answers: { tools: ['crm'] },
    });
    expect(next.toString()).toBe('view=sheet&size=50&f.tools=crm');
  });
});

describe('the filter the API reads', () => {
  // 2026-09-23 02:00 UTC is still Sep 22 in Bogota.
  const now = Date.UTC(2026, 8, 23, 2);

  it('counts a preset back from today in the workspace zone', () => {
    expect(dateWindow({ ...EMPTY_FILTER, preset: 'today' }, 'America/Bogota', now)).toEqual({
      from: '2026-09-22',
      to: '2026-09-22',
    });
    expect(dateWindow({ ...EMPTY_FILTER, preset: '7d' }, 'America/Bogota', now)).toEqual({
      from: '2026-09-16',
      to: '2026-09-22',
    });
    expect(dateWindow({ ...EMPTY_FILTER, preset: '30d' }, 'UTC', now)).toEqual({
      from: '2026-08-25',
      to: '2026-09-23',
    });
  });

  it('packs the answers into one JSON param, and sends a status only when one narrows', () => {
    const q = apiFilterQuery(
      {
        ...EMPTY_FILTER,
        statuses: ['completed'],
        answers: { kind: ['a"b'] },
        scoreMax: 5,
        sort: 'oldest',
      },
      'UTC',
      now,
    );
    expect(q).toEqual({
      status: 'completed',
      from: undefined,
      to: undefined,
      scoreMin: undefined,
      scoreMax: '5',
      answers: JSON.stringify({ kind: ['a"b'] }),
      sort: 'oldest',
    });
    expect(
      apiFilterQuery({ ...EMPTY_FILTER, statuses: ['completed', 'partial'] }, 'UTC').status,
    ).toBeUndefined();
  });
});
