import { describe, expect, it } from 'vitest';
import { copyNameFor } from './copy-name';

describe('copyNameFor', () => {
  it('adds the suffix to a short name', () => {
    expect(copyNameFor('{name} (copy)', 'Expo 2026')).toBe('Expo 2026 (copy)');
    expect(copyNameFor('{name} (copia)', ' Expo ')).toBe('Expo (copia)');
  });

  it('cuts a long name so the copy fits 80 characters, for every length up to the limit', () => {
    for (let n = 70; n <= 80; n += 1) {
      const out = copyNameFor('{name} (copy)', 'x'.repeat(n));
      expect(out.length, String(n)).toBeLessThanOrEqual(80);
      expect(out.endsWith(' (copy)')).toBe(true);
    }
    expect(copyNameFor('{name} (copy)', 'x'.repeat(80))).toBe(`${'x'.repeat(73)} (copy)`);
  });

  it('never ends the cut name on a space', () => {
    const name = `${'a'.repeat(72)} bcdefgh`;
    expect(copyNameFor('{name} (copy)', name)).toBe(`${'a'.repeat(72)} (copy)`);
  });
});
