import { describe, it, expect } from 'vitest';
import {
  COUNTRIES,
  countryFlag,
  countryName,
  formatPhoneDigits,
  isPhoneValueTooShort,
  longestDialPrefix,
  phoneNsnRange,
  phoneSubscriberDigits,
} from './countries';

describe('countries data', () => {
  it('exposes the ISO list with derived flags and dial codes', () => {
    expect(COUNTRIES.length).toBeGreaterThan(200);
    const us = COUNTRIES.find((c) => c.code === 'US')!;
    expect(us.dial).toBe('+1');
    expect(us.flag).toBe('🇺🇸');
    expect(COUNTRIES.find((c) => c.code === 'MX')!.dial).toBe('+52');
  });

  it('derives a flag from any alpha-2 code', () => {
    expect(countryFlag('CO')).toBe('🇨🇴');
  });

  it('localizes country names (falls back to the code)', () => {
    expect(countryName('MX', 'en')).toBe('Mexico');
    expect(countryName('MX', 'es')).toBe('México');
  });
});

describe('E.164 subscriber-digit helpers', () => {
  it('finds the longest (exact) dial prefix — codes are prefix-free', () => {
    expect(longestDialPrefix('+525512345678')).toBe('+52');
    expect(longestDialPrefix('+15106005675')).toBe('+1');
    expect(longestDialPrefix('5551234')).toBe(''); // no leading '+'
  });

  it('counts subscriber digits excluding the dial code', () => {
    expect(phoneSubscriberDigits('+525512345678')).toBe('5512345678'); // 10
    expect(phoneSubscriberDigits('+15106005675')).toBe('5106005675'); // 10
    expect(phoneSubscriberDigits('+57 300 123 4567')).toBe('3001234567'); // spaces ignored
    expect(phoneSubscriberDigits('')).toBe('');
  });

  it('flags a value that is shorter than the country issues', () => {
    expect(isPhoneValueTooShort('+52551234')).toBe(true); // MX needs 10
    expect(isPhoneValueTooShort('+525512345678')).toBe(false);
    expect(isPhoneValueTooShort('')).toBe(false); // empty is not "too short"
  });

  it('groups digits for display without changing the stored value', () => {
    expect(formatPhoneDigits('+1', '5106005675')).toBe('(510) 600-5675');
    expect(formatPhoneDigits('+52', '5512345678')).toBe('55 123 456 78');
    expect(phoneNsnRange('MX', '+52')).toEqual([10, 10]);
    expect(phoneNsnRange('US', '+1')).toEqual([10, 10]);
  });
});
