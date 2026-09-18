/**
 * The long-text length pair is the one place in the panel where two fields can
 * contradict each other. `formStepSchema` refuses a floor above a ceiling, so
 * the editor must never WRITE that pair in the first place; otherwise a stray
 * keystroke fails the whole form's autosave.
 */
import { describe, expect, it } from 'vitest';
import { clampCharLimit } from './question-settings';

describe('clampCharLimit', () => {
  it('reads an empty box as no limit on that end', () => {
    expect(clampCharLimit('')).toBeUndefined();
    expect(clampCharLimit('0')).toBeUndefined();
    expect(clampCharLimit('-5')).toBeUndefined();
    expect(clampCharLimit('abc')).toBeUndefined();
  });

  it('squeezes each field against its sibling so min > max is unwritable', () => {
    // A minimum typed above the configured maximum settles at the maximum.
    expect(clampCharLimit('400', undefined, 50)).toBe(50);
    // A maximum typed below the configured minimum settles at the minimum.
    expect(clampCharLimit('10', 50, undefined)).toBe(50);
    // With nothing to contradict, the typed value stands.
    expect(clampCharLimit('400', undefined, undefined)).toBe(400);
    expect(clampCharLimit('400', undefined, 500)).toBe(400);
  });

  it('holds the schema ceiling and rounds a fraction', () => {
    expect(clampCharLimit('99999')).toBe(10_000);
    expect(clampCharLimit('12.4')).toBe(12);
  });
});
