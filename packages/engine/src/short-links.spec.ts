/**
 * Short-link shape rules. Pure functions, so these are the cheapest place to
 * pin them, and `validateFormSlug` in particular is published API: the builder
 * imports it into a browser bundle to refuse a bad slug before spending a round
 * trip, and the data layer calls it again before writing. Those two must agree,
 * or the dialog says yes and the server says no.
 */
import { describe, expect, it } from 'vitest';
import {
  FORM_SLUG_MAX_LENGTH,
  isReservedPublicSlug,
  validateFormSlug,
  validateVanitySlug,
} from './short-links';

describe('validateFormSlug', () => {
  it('accepts lowercase words joined by single hyphens', () => {
    for (const good of ['contact', 'talk-to-sales', 'q4-2026-survey', 'a', '2026']) {
      expect(validateFormSlug(good), good).toBeNull();
    }
  });

  it('normalizes case and surrounding whitespace before judging', () => {
    // The caller stores `trim().toLowerCase()`, so validating the raw string
    // would refuse values that are about to be stored perfectly well.
    expect(validateFormSlug('Talk-To-Sales')).toBeNull();
    expect(validateFormSlug('  contact  ')).toBeNull();
  });

  it('rejects the shapes that would not survive a URL', () => {
    for (const bad of [
      '',
      ' ',
      'talk to sales',
      'talk--to-sales',
      '-leading',
      'trailing-',
      'has_underscore',
      'acentuación',
      'slash/inside',
      'percent%20',
    ]) {
      expect(validateFormSlug(bad), bad).toBe('invalid');
    }
  });

  it('separates too-long from malformed so the UI can say which', () => {
    expect(validateFormSlug('a'.repeat(FORM_SLUG_MAX_LENGTH))).toBeNull();
    expect(validateFormSlug('a'.repeat(FORM_SLUG_MAX_LENGTH + 1))).toBe('too-long');
    // Length is checked first on purpose: a value that is both over-length and
    // malformed is most usefully reported as the one the reader can see.
    expect(validateFormSlug(`${'a'.repeat(FORM_SLUG_MAX_LENGTH)}  BAD`)).toBe('too-long');
  });

  it('does NOT apply the reserved-word blocklist', () => {
    // A form slug is the third path segment, so it cannot shadow a top-level
    // route the way a vanity account slug can. Rejecting these would be theatre,
    // and would refuse a perfectly reasonable form called "Pricing".
    for (const word of ['admin', 'settings', 'login', 'pricing', 'api']) {
      expect(isReservedPublicSlug(word), word).toBe(true);
      expect(validateFormSlug(word), word).toBeNull();
      expect(validateVanitySlug(word), word).toBe('reserved');
    }
  });

  it('allows a form slug longer than a vanity slug', () => {
    // 80 vs 30. A form slug is generated from a form NAME, which is allowed 200.
    const long = 'a'.repeat(50);
    expect(validateFormSlug(long)).toBeNull();
    expect(validateVanitySlug(long)).toBe('invalid');
  });
});
