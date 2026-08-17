import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { revokeUpstreamSession, type Session } from './auth-session';

const workosSession: Session = { provider: 'workos', accessToken: 'tok', sessionId: 'sess_123' };

describe('revokeUpstreamSession', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('IAM_BASE_URL', 'https://iam.example.com/iam');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('POSTs redirect=false with both ids and no Authorization header', async () => {
    await revokeUpstreamSession(workosSession);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://iam.example.com/iam/auth/logout?redirect=false',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workos_session_id: 'sess_123', session_id: 'sess_123' }),
      }),
    );
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
  });

  it('still POSTs an empty body when the workos session has no session id', async () => {
    await revokeUpstreamSession({ provider: 'workos', accessToken: 'tok' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://iam.example.com/iam/auth/logout?redirect=false',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({}) }),
    );
  });

  it('swallows a rejected fetch — local cleanup must never be hostage to the IAM', async () => {
    fetchMock.mockRejectedValue(new Error('iam down'));

    await expect(revokeUpstreamSession(workosSession)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips the IAM for a local session', async () => {
    await revokeUpstreamSession({ provider: 'local', email: 'a@b.c' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips the IAM when IAM_BASE_URL is not configured', async () => {
    vi.stubEnv('IAM_BASE_URL', '');

    await revokeUpstreamSession(workosSession);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
