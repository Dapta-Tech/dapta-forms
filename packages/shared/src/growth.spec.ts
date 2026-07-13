import { describe, it, expect } from 'vitest';
import { badgeHidden, buildSignupUrl } from './growth';

describe('buildSignupUrl', () => {
  it('tags a configured destination with the full UTM scheme', () => {
    const url = new URL(buildSignupUrl({ baseUrl: 'https://signup.example.com', medium: 'badge', accountCode: 'acme' })!);
    expect(url.origin).toBe('https://signup.example.com');
    expect(url.searchParams.get('utm_source')).toBe('dapta-calendars');
    expect(url.searchParams.get('utm_medium')).toBe('badge');
    expect(url.searchParams.get('utm_campaign')).toBe('made-with-dapta');
    expect(url.searchParams.get('utm_content')).toBe('acme');
  });

  it('varies only the medium between badge and confirmation', () => {
    const base = 'https://signup.example.com';
    const badge = new URL(buildSignupUrl({ baseUrl: base, medium: 'badge' })!);
    const conf = new URL(buildSignupUrl({ baseUrl: base, medium: 'confirmation' })!);
    expect(badge.searchParams.get('utm_medium')).toBe('badge');
    expect(conf.searchParams.get('utm_medium')).toBe('confirmation');
    expect(badge.searchParams.get('utm_source')).toBe(conf.searchParams.get('utm_source'));
    expect(badge.searchParams.get('utm_campaign')).toBe(conf.searchParams.get('utm_campaign'));
  });

  it('omits utm_content when there is no account code', () => {
    const url = new URL(buildSignupUrl({ baseUrl: 'https://signup.example.com', medium: 'badge' })!);
    expect(url.searchParams.has('utm_content')).toBe(false);
  });

  it('preserves an existing path and query on the destination', () => {
    const url = new URL(buildSignupUrl({ baseUrl: 'https://example.com/signup?ref=x', medium: 'confirmation' })!);
    expect(url.pathname).toBe('/signup');
    expect(url.searchParams.get('ref')).toBe('x');
    expect(url.searchParams.get('utm_medium')).toBe('confirmation');
  });

  it('returns null when no destination is configured (surface hides)', () => {
    expect(buildSignupUrl({ medium: 'badge' })).toBeNull();
    expect(buildSignupUrl({ baseUrl: '', medium: 'badge' })).toBeNull();
    expect(buildSignupUrl({ baseUrl: 'not a url', medium: 'badge' })).toBeNull();
    expect(buildSignupUrl({ baseUrl: 'ftp://x.example', medium: 'badge' })).toBeNull();
  });
});

describe('badgeHidden', () => {
  it('is shown by default (unset / empty / junk values)', () => {
    expect(badgeHidden(undefined)).toBe(false);
    expect(badgeHidden(null)).toBe(false);
    expect(badgeHidden('')).toBe(false);
    expect(badgeHidden('0')).toBe(false);
    expect(badgeHidden('off')).toBe(false);
  });

  it('hides on the documented truthy spellings', () => {
    expect(badgeHidden('1')).toBe(true);
    expect(badgeHidden('true')).toBe(true);
    expect(badgeHidden('TRUE')).toBe(true);
    expect(badgeHidden(' yes ')).toBe(true);
  });
});
