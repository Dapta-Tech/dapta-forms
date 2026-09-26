import { describe, expect, it } from 'vitest';
import { HIDDEN_HUTK, scrubHutk } from './hutk';

const HUTK = '0123456789abcdef0123456789abcdef';

describe('scrubHutk', () => {
  it('hides every occurrence of the cookie, whatever its case', () => {
    expect(scrubHutk(`a ${HUTK} b ${HUTK.toUpperCase()}`, HUTK)).toBe(`a ${HIDDEN_HUTK} b ${HIDDEN_HUTK}`);
  });

  it('leaves the text alone without a cookie, or with anything that is not one', () => {
    expect(scrubHutk(`a ${HUTK}`, undefined)).toBe(`a ${HUTK}`);
    // Never trusted into a pattern: this would otherwise match everything.
    expect(scrubHutk('a.*b', '.*')).toBe('a.*b');
    expect(scrubHutk('abc', 'abc')).toBe('abc');
  });
});
