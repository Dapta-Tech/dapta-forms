/**
 * The root is where a landing's calls to action point: it is the page that
 * reads their campaign tags and hands them to the login route (lib/attribution.ts).
 * On a WorkOS build it is an app entry: a signed-in person goes to the
 * dashboard, anyone else to the hosted login, which a "create an account" call
 * to action opens on its sign-up screen with `?screen=sign-up`
 * (lib/login-screen.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.fn(() => 'workos');
const getSession = vi.fn<() => Promise<unknown>>(async () => null);
vi.mock('@/lib/auth-session', () => ({ authProvider: () => provider(), getSession: () => getSession() }));
const requestHeaders = { current: new Headers() };
vi.mock('next/headers', () => ({ headers: async () => requestHeaders.current }));
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));

import HomePage from './page';

const visit = (params: Record<string, string | string[] | undefined> = {}) =>
  HomePage({ searchParams: Promise.resolve(params) });
const PH_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('/ (the app root)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('PUBLIC_APP_URL', 'https://app.example.com');
    provider.mockReturnValue('workos');
    getSession.mockResolvedValue(null);
    requestHeaders.current = new Headers();
  });

  it('sends an anonymous visitor to the hosted login, as before', async () => {
    await expect(visit()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/api/auth/login');
  });

  it('passes a sign-up call to action on to the login route', async () => {
    await expect(visit({ screen: 'sign-up' })).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/api/auth/login?screen=sign-up');
  });

  it('carries the campaign tags as before, and the flag after them', async () => {
    const tagged = { utm_source: 'dforms', utm_campaign: 'nov', ph_id: PH_ID };
    const tags = `utm_source=dforms&utm_campaign=nov&ph_id=${PH_ID}`;

    await expect(visit(tagged)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenLastCalledWith(`/api/auth/login?${tags}`);

    await expect(visit({ ...tagged, screen: 'sign-up' })).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenLastCalledWith(`/api/auth/login?${tags}&screen=sign-up`);
  });

  it('carries the landing as the cross-origin referrer, with or without the flag', async () => {
    requestHeaders.current = new Headers({ referer: 'https://dforms.ai/' });
    const referrer = `referrer=${encodeURIComponent('https://dforms.ai/')}`;

    await expect(visit()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenLastCalledWith(`/api/auth/login?${referrer}`);

    await expect(visit({ screen: 'sign-up' })).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenLastCalledWith(`/api/auth/login?${referrer}&screen=sign-up`);
  });

  it.each<[string, Record<string, string | string[]>]>([
    ['another value', { screen: 'signup' }],
    ['a different case', { screen: 'Sign-Up' }],
    ['an empty value', { screen: '' }],
    ['a repeated parameter', { screen: ['sign-up', 'sign-up'] }],
    ['the identity service name', { screenHint: 'sign-up' }],
  ])('treats %s as a plain login', async (_label, params) => {
    await expect(visit(params)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/api/auth/login');
  });

  it('sends a signed-in person to the dashboard, call to action or not', async () => {
    getSession.mockResolvedValue({ accountId: 'acc_1' });

    await expect(visit({ screen: 'sign-up' })).rejects.toThrow('NEXT_REDIRECT /admin');
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/admin');
  });

  it('keeps the clone-and-run landing on a local build', async () => {
    provider.mockReturnValue('local');

    await expect(visit({ screen: 'sign-up' })).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });
});
