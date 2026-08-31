import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const cookieJar = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieJar) }));
vi.mock('@/lib/auth-session', () => ({ authProvider: () => 'workos' }));

import { GET } from './route';

const AUTHORIZE =
  'https://api.workos.com/user_management/authorize?client_id=client_1&provider=authkit&state=abc';

const req = (path: string) => new NextRequest(`https://forms.example.com${path}`);

describe('GET /api/auth/login prompt handling', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('PUBLIC_APP_URL', '');
    vi.stubEnv('IAM_BASE_URL', 'https://iam.example.com/iam');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ loginUrl: AUTHORIZE }) });
    cookieJar.get.mockReturnValue(undefined);
  });

  it('patches prompt=login onto the authorize URL when asked (the IAM drops the param)', async () => {
    const res = await GET(req('/api/auth/login?prompt=login'));

    const target = new URL(res.headers.get('location')!);
    expect(target.origin + target.pathname).toBe('https://api.workos.com/user_management/authorize');
    expect(target.searchParams.get('prompt')).toBe('login');
    // Forwarded to the IAM too, so nothing changes here the day it propagates it.
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('prompt=login');
  });

  it('sends no prompt on the bare auto-redirect (silent SSO stays)', async () => {
    const res = await GET(req('/api/auth/login'));

    expect(new URL(res.headers.get('location')!).searchParams.get('prompt')).toBeNull();
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('prompt');
  });

  it('ignores any prompt value that is not exactly login', async () => {
    const res = await GET(req('/api/auth/login?prompt=evil%20login'));

    expect(new URL(res.headers.get('location')!).searchParams.get('prompt')).toBeNull();
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('prompt');
  });
});
