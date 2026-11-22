/**
 * The sign-up flag's shared pieces (lib/login-screen.ts): the one allowlisted
 * value, and the login route path the root builds with it beside the campaign
 * tags `attributionHandoffQuery` already emitted.
 */
import { describe, expect, it } from 'vitest';
import { attributionHandoffQuery } from './attribution';
import { loginHandoffPath, wantsSignUp } from './login-screen';

describe('wantsSignUp', () => {
  it('accepts exactly sign-up', () => {
    expect(wantsSignUp('sign-up')).toBe(true);
  });

  it.each<[string, unknown]>([
    ['another value', 'signup'],
    ['a different case', 'Sign-Up'],
    ['sign-in', 'sign-in'],
    ['an empty value', ''],
    ['a padded value', ' sign-up'],
    ['a repeated parameter', ['sign-up', 'sign-up']],
    ['nothing', undefined],
  ])('refuses %s', (_label, raw) => {
    expect(wantsSignUp(raw)).toBe(false);
  });
});

describe('loginHandoffPath', () => {
  const TAGS = attributionHandoffQuery(
    { utm_source: 'dforms', utm_campaign: 'nov', ph_id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' },
    null,
    null,
  );

  it('without the flag: byte for byte the path the root always built', () => {
    expect(loginHandoffPath('', false)).toBe('/api/auth/login');
    expect(loginHandoffPath(TAGS, false)).toBe(`/api/auth/login?${TAGS}`);
  });

  it('with the flag alone: the login route with the sign-up screen', () => {
    expect(loginHandoffPath('', true)).toBe('/api/auth/login?screen=sign-up');
  });

  it('with the flag and campaign tags: the tags untouched, the flag after them', () => {
    const path = loginHandoffPath(TAGS, true);

    expect(path).toBe(`/api/auth/login?${TAGS}&screen=sign-up`);
    const sp = new URL(path, 'https://forms.example.com').searchParams;
    expect(sp.get('utm_source')).toBe('dforms');
    expect(sp.get('utm_campaign')).toBe('nov');
    expect(sp.get('ph_id')).toBe('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b');
    expect(sp.getAll('screen')).toEqual(['sign-up']);
  });

  it('the hand-off query never carries the flag itself, so it cannot appear twice', () => {
    expect(attributionHandoffQuery({ screen: 'sign-up', utm_source: 'dforms' }, null, null)).toBe('utm_source=dforms');
    expect(attributionHandoffQuery({ screen: 'sign-up' }, null, null)).toBe('');
  });
});
