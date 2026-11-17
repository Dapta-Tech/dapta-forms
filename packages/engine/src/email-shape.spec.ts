import { describe, expect, it } from 'vitest';
import { hasEmailShapedTail, isEmailAddressShape } from './email-shape';

const STRICT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOOSE = /@[^@]+\.[^@]+$/;

/** Short random strings over the characters that matter to both patterns. */
function randomStrings(count: number, seed = 1): string[] {
  const alphabet = ['a', 'b', '.', '@', ' ', '\t', '!', '-'];
  let s = seed;
  const next = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s;
  };
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const len = next() % 12;
    let v = '';
    for (let j = 0; j < len; j++) v += alphabet[next() % alphabet.length];
    out.push(v);
  }
  return out;
}

const SAMPLES = [
  '',
  'sam@acme.io',
  'sam@mail.acme.io',
  "o'brien@acme.io",
  'not-an-email',
  'a@b',
  'a@.b',
  'a@b.',
  'a@b..c',
  'a@b.c.',
  '@b.c',
  'a@@b.c',
  'a @b.c',
  'contact me at sam@acme.io',
  'x@y@z.w',
];

describe('isEmailAddressShape', () => {
  it('accepts exactly what the old pattern accepted', () => {
    for (const v of [...SAMPLES, ...randomStrings(20_000)]) {
      expect(isEmailAddressShape(v), JSON.stringify(v)).toBe(STRICT.test(v));
    }
  });

  it('answers in linear time on the shape that made the old pattern quadratic', () => {
    const crafted = `!@!.${'!.'.repeat(200_000)}@`;
    const started = Date.now();
    expect(isEmailAddressShape(crafted)).toBe(false);
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('hasEmailShapedTail', () => {
  it('accepts exactly what the old pattern accepted', () => {
    for (const v of [...SAMPLES, ...randomStrings(20_000, 7)]) {
      expect(hasEmailShapedTail(v), JSON.stringify(v)).toBe(LOOSE.test(v));
    }
  });

  it('answers in linear time on a long dotted answer', () => {
    const crafted = `a@b.${'!.'.repeat(200_000)}@`;
    const started = Date.now();
    expect(hasEmailShapedTail(crafted)).toBe(false);
    expect(Date.now() - started).toBeLessThan(200);
  });
});
