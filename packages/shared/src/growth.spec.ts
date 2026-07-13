import { describe, it, expect } from 'vitest';
import { buildSignupUrl, badgeHidden, UTM_SOURCE, UTM_CAMPAIGN } from './growth';

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
