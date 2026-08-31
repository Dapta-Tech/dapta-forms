import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieJar = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieJar) }));
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));

import { encodeSession, hostFetch, refreshUpstreamSession, type Session } from './auth-session';

const b64u = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const jwtWith = (claims: Record<string, unknown>) =>
  `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u(claims)}.sig`;

const workosSession: Session = {
  provider: 'workos',
  accessToken: 'tok',
  refreshToken: 'refresh-1',
  sessionId: 'session_OLD',
};

describe('refreshUpstreamSession', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('IAM_BASE_URL', 'https://iam.example.com/iam');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: jwtWith({ workos_session_id: 'session_NEW' }), refresh_token: 'refresh-2' }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('POSTs the refresh token with no Authorization header', async () => {
    await refreshUpstreamSession(workosSession);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://iam.example.com/iam/auth/refresh',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ refresh_token: 'refresh-1' }) }),
    );
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
  });

  it('returns the rotated pair with the WorkOS id re-read from the new JWT', async () => {
    await expect(refreshUpstreamSession(workosSession)).resolves.toEqual({
      provider: 'workos',
      accessToken: jwtWith({ workos_session_id: 'session_NEW' }),
      refreshToken: 'refresh-2',
      sessionId: 'session_NEW',
    });
  });

  it('keeps the old session id when the new JWT carries no claim', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: jwtWith({ sub: 'u' }), refresh_token: 'refresh-2' }),
    });

    await expect(refreshUpstreamSession(workosSession)).resolves.toMatchObject({ sessionId: 'session_OLD' });
  });

  it('keeps the old refresh token when the IAM omits a rotated one', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ access_token: jwtWith({}) }) });

    await expect(refreshUpstreamSession(workosSession)).resolves.toMatchObject({ refreshToken: 'refresh-1' });
  });

  it('resolves null on a 401 from the IAM: the refresh token is dead, sign in again', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });

    await expect(refreshUpstreamSession(workosSession)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves null on a rejected fetch instead of throwing', async () => {
    fetchMock.mockRejectedValue(new Error('iam down'));

    await expect(refreshUpstreamSession(workosSession)).resolves.toBeNull();
  });

  it('resolves null on a body with no access token', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

    await expect(refreshUpstreamSession(workosSession)).resolves.toBeNull();
  });

  it('skips the IAM entirely for a local session, a missing refresh token, or no IAM', async () => {
    await expect(refreshUpstreamSession({ provider: 'local', email: 'a@b.c' })).resolves.toBeNull();
    await expect(refreshUpstreamSession({ provider: 'workos', accessToken: 'tok' })).resolves.toBeNull();
    vi.stubEnv('IAM_BASE_URL', '');
    await expect(refreshUpstreamSession(workosSession)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('hostFetch 401 refresh path', () => {
  const fetchMock = vi.fn();
  const freshJwt = jwtWith({ workos_session_id: 'session_NEW' });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('IAM_BASE_URL', 'https://iam.example.com/iam');
    vi.stubEnv('AUTH_PROVIDER', 'workos');
    vi.stubEnv('WEB_SESSION_SECRET', 'spec-secret');
    cookieJar.get.mockImplementation((name: string) =>
      name === 'quill_session' ? { value: encodeSession(workosSession) } : undefined,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });


  it('refreshes once and retries the request with the new bearer', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 401 }) // original API call
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: freshJwt, refresh_token: 'refresh-2' }),
      }) // IAM refresh
      .mockResolvedValueOnce({ status: 200, ok: true }); // retried API call

    // After setSession the cookie jar must serve the refreshed session or the
    // retry re-sends the dead token.
    cookieJar.set.mockImplementation((name: string, value: string) => {
      cookieJar.get.mockImplementation((n: string) => (n === 'quill_session' ? { value } : undefined));
    });

    const res = await hostFetch('/v1/forms');

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://iam.example.com/iam/auth/refresh');
    const retryHeaders = (fetchMock.mock.calls[2]?.[1] as RequestInit).headers as Record<string, string>;
    expect(retryHeaders['authorization']).toBe(`Bearer ${freshJwt}`);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('falls back to the logout flow when the refresh itself fails', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 401 }) // original API call
      .mockResolvedValueOnce({ ok: false, status: 401 }) // IAM refresh: dead
      .mockResolvedValue({ ok: true, json: async () => ({}) }); // IAM revoke

    await expect(hostFetch('/v1/forms')).rejects.toThrow('NEXT_REDIRECT:/login?signedout=1');

    expect(cookieJar.delete).toHaveBeenCalled();
  });

  it('never refreshes twice: a 401 on the retried request goes straight to logout', async () => {
    cookieJar.set.mockImplementation((name: string, value: string) => {
      cookieJar.get.mockImplementation((n: string) => (n === 'quill_session' ? { value } : undefined));
    });
    fetchMock
      .mockResolvedValueOnce({ status: 401 }) // original API call
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: freshJwt, refresh_token: 'refresh-2' }),
      }) // IAM refresh succeeds
      .mockResolvedValueOnce({ status: 401 }) // retried API call STILL 401
      .mockResolvedValue({ ok: true, json: async () => ({}) }); // IAM revoke

    await expect(hostFetch('/v1/forms')).rejects.toThrow('NEXT_REDIRECT:/login?signedout=1');

    // original + one refresh + one retry + revoke; a second refresh would make 5 with two IAM refresh calls
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });
});
