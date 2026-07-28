import { describe, it, expect } from 'vitest';
import { parseOptionsPaste, buildImportedOptions, OPTIONS_IMPORT_CAP } from './options-import';

describe('parseOptionsPaste — delimiter detection', () => {
  it('parses a Sheets copy (TSV) with two columns', () => {
    const r = parseOptionsPaste('SaaS B2B\t10\nE-commerce\t8');
    expect(r.delimiter).toBe('\t');
    expect(r.rows).toEqual([
      { line: 1, label: 'SaaS B2B', points: 10, status: 'ok', rounded: false },
      { line: 2, label: 'E-commerce', points: 8, status: 'ok', rounded: false },
    ]);
  });

  it('parses CSV and semicolon exports', () => {
    expect(parseOptionsPaste('A,1\nB,2').delimiter).toBe(',');
    expect(parseOptionsPaste('A;1\nB;2').delimiter).toBe(';');
  });

  it('treats a plain list (no delimiter) as label-only rows', () => {
    const r = parseOptionsPaste('One\nTwo\nThree');
    expect(r.delimiter).toBeNull();
    expect(r.rows.map((x) => x.points)).toEqual([null, null, null]);
  });

  it('a stray comma inside ONE label does not turn the paste two-column', () => {
    // 1 of 3 lines has a comma → below the 80% consistency bar.
    const r = parseOptionsPaste('Health, wellness\nFinance\nEducation');
    expect(r.delimiter).toBeNull();
    expect(r.rows[0]!.label).toBe('Health, wellness');
  });
});

describe('parseOptionsPaste — header detection', () => {
  it('skips an EN header row', () => {
    const r = parseOptionsPaste('Option\tScore\nSaaS\t10');
    expect(r.skippedHeader).toBe(true);
    expect(r.rows).toHaveLength(1);
  });

  it('skips an ES header row', () => {
    const r = parseOptionsPaste('Opción\tPuntos\nSalud\t7');
    expect(r.skippedHeader).toBe(true);
    expect(r.rows[0]!.label).toBe('Salud');
  });

  it('skips an unknown header when the score column is numeric below', () => {
    const r = parseOptionsPaste('Industria\tCalificación\nSaaS\t10');
    expect(r.skippedHeader).toBe(true);
  });

  it('keeps row 1 when nothing marks it as a header', () => {
    const r = parseOptionsPaste('SaaS\t10\nSalud\t7');
    expect(r.skippedHeader).toBe(false);
    expect(r.rows).toHaveLength(2);
  });

  it('never treats a single-line paste as a header', () => {
    const r = parseOptionsPaste('Option\t5');
    expect(r.skippedHeader).toBe(false);
    expect(r.rows).toHaveLength(1);
  });
});

describe('parseOptionsPaste — per-row tolerance', () => {
  it('marks a non-numeric score as invalidPoints without failing the rest', () => {
    const r = parseOptionsPaste('A\t1\nB\tN/A\nC\t3');
    expect(r.rows.map((x) => x.status)).toEqual(['ok', 'invalidPoints', 'ok']);
    expect(r.importable.map((x) => x.label)).toEqual(['A', 'C']);
  });

  it('rounds decimal scores and flags them', () => {
    const r = parseOptionsPaste('A\t7.4\nB\t7,6');
    expect(r.rows[0]).toMatchObject({ points: 7, rounded: true });
    expect(r.rows[1]).toMatchObject({ points: 8, rounded: true });
  });

  it('de-dupes by normalized label — first wins, case-insensitive', () => {
    const r = parseOptionsPaste('SaaS\t10\nsaas\t9\n SaaS \t8');
    expect(r.rows.map((x) => x.status)).toEqual(['ok', 'duplicate', 'duplicate']);
  });

  it('de-dupes against existing options (append mode)', () => {
    const r = parseOptionsPaste('Kept\t1\nNew\t2', { existingLabels: ['kept'] });
    expect(r.rows.map((x) => x.status)).toEqual(['duplicate', 'ok']);
  });

  it('ignores empty lines and empty labels, keeps source line numbers', () => {
    const r = parseOptionsPaste('A\t1\n\n\t9\nB\t2');
    expect(r.rows.map((x) => [x.line, x.label])).toEqual([
      [1, 'A'],
      [4, 'B'],
    ]);
  });

  it('flags extra columns and ignores them', () => {
    const r = parseOptionsPaste('A,1,note\nB,2,note');
    expect(r.extraColumns).toBe(true);
    expect(r.rows[0]).toMatchObject({ label: 'A', points: 1 });
  });

  it('truncates at the cap, counting existing options against it', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Opt ${i}`).join('\n');
    const r = parseOptionsPaste(lines, { cap: 25, existingLabels: ['x', 'y'] });
    expect(r.importable).toHaveLength(23);
    expect(r.truncated).toBe(true);
    expect(OPTIONS_IMPORT_CAP).toBe(200);
  });
});

describe('buildImportedOptions', () => {
  const rows = parseOptionsPaste('SaaS B2B\t10\nE-commerce\t8\nSin score').importable;

  it('replace: clean slate, slugged values, points only where present', () => {
    const out = buildImportedOptions(rows, [{ label: 'Old', value: 'old', icon: '⭐' }], 'replace');
    expect(out).toEqual([
      { label: 'SaaS B2B', value: 'saas_b2b', points: 10 },
      { label: 'E-commerce', value: 'e_commerce', points: 8 },
      { label: 'Sin score', value: 'sin_score' },
    ]);
  });

  it('append: keeps existing options (icons included) and de-collides values', () => {
    const existing = [{ label: 'SaaS old', value: 'saas_b2b', icon: '⭐' }];
    const out = buildImportedOptions(rows, existing, 'append');
    expect(out[0]).toEqual(existing[0]); // untouched, icon survives
    expect(out[1]!.value).toBe('saas_b2b-2'); // collision suffixed
  });

  it('never emits a comma inside a value (variant-key separator)', () => {
    const r = parseOptionsPaste('Salud; bienestar y más\t5\nOtra\t1');
    const out = buildImportedOptions(r.importable, [], 'replace');
    for (const o of out) expect(o.value.includes(',')).toBe(false);
  });
});
