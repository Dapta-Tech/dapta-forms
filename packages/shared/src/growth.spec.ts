import { describe, it, expect } from 'vitest';
import { buildSignupUrl, badgeHidden, growthTarget, UTM_SOURCE, UTM_CAMPAIGN } from './growth';

describe('growth attribution', () => {
  it('tags signup URLs with the forms UTM source', () => {
    const built = buildSignupUrl({ baseUrl: 'https://app.example.com', medium: 'badge', accountCode: 'acme' });
    expect(built).not.toBeNull();
    const url = new URL(built!);
    expect(url.searchParams.get('utm_source')).toBe('dapta-forms');
    expect(url.searchParams.get('utm_source')).toBe(UTM_SOURCE);
    expect(url.searchParams.get('utm_medium')).toBe('badge');
    expect(url.searchParams.get('utm_campaign')).toBe(UTM_CAMPAIGN);
    expect(url.searchParams.get('utm_content')).toBe('acme');
  });

  it('returns null for a missing/non-http base (fork carries no dead link)', () => {
    expect(buildSignupUrl({ baseUrl: null, medium: 'badge' })).toBeNull();
    expect(buildSignupUrl({ baseUrl: 'ftp://x', medium: 'badge' })).toBeNull();
  });

  it('badgeHidden only honors explicit truthy flags', () => {
    expect(badgeHidden('1')).toBe(true);
    expect(badgeHidden('true')).toBe(true);
    expect(badgeHidden('0')).toBe(false);
    expect(badgeHidden(undefined)).toBe(false);
  });
});

describe('growthTarget — the loop is gated on signup, but points at the landing', () => {
  it('prefers the landing when both are configured', () => {
    expect(growthTarget({ signupUrl: 'https://app.example.com', landingUrl: 'https://www.example.ai' }))
      .toBe('https://www.example.ai');
  });

  it('falls back to the signup URL when no landing is configured', () => {
    expect(growthTarget({ signupUrl: 'https://app.example.com', landingUrl: '' })).toBe('https://app.example.com');
    expect(growthTarget({ signupUrl: 'https://app.example.com' })).toBe('https://app.example.com');
  });

  it('a landing alone turns NOTHING on — signup is the opt-in', () => {
    // The open-core contract: a fork that configures no signup destination
    // renders no badge and no CTA, whatever else is set. The landing default
    // ships in the image, so this is the case that keeps a fork clean.
    expect(growthTarget({ signupUrl: null, landingUrl: 'https://www.example.ai' })).toBeNull();
    expect(growthTarget({ signupUrl: '', landingUrl: 'https://www.example.ai' })).toBeNull();
    expect(growthTarget({})).toBeNull();
  });

  it('ignores a non-http(s) value on either side', () => {
    expect(growthTarget({ signupUrl: 'ftp://x', landingUrl: 'https://www.example.ai' })).toBeNull();
    expect(growthTarget({ signupUrl: 'https://app.example.com', landingUrl: 'javascript:alert(1)' }))
      .toBe('https://app.example.com');
  });

  it('the built URL still carries every UTM tag', () => {
    const built = buildSignupUrl({
      baseUrl: growthTarget({ signupUrl: 'https://app.example.com', landingUrl: 'https://www.example.ai' }),
      medium: 'badge',
      accountCode: 'acme',
    });
    const url = new URL(built!);
    expect(url.origin).toBe('https://www.example.ai');
    expect(url.searchParams.get('utm_source')).toBe(UTM_SOURCE);
    expect(url.searchParams.get('utm_content')).toBe('acme');
  });
});
