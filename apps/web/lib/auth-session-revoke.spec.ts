import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { idpLogoutTarget, revokeUpstreamSession, type Session } from './auth-session';

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

  it('returns the IdP logout URL from logoutUrl', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ logoutUrl: 'https://api.workos.com/logout?x=1' }) });

    await expect(revokeUpstreamSession(workosSession)).resolves.toBe('https://api.workos.com/logout?x=1');
  });

  it('returns the IdP logout URL from the logoutURL spelling too', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ logoutURL: 'https://api.workos.com/logout?x=2' }) });

    await expect(revokeUpstreamSession(workosSession)).resolves.toBe('https://api.workos.com/logout?x=2');
  });

  it('still POSTs an empty body when the workos session has no session id', async () => {
    await revokeUpstreamSession({ provider: 'workos', accessToken: 'tok' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://iam.example.com/iam/auth/logout?redirect=false',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({}) }),
    );
  });

  it('resolves null on a rejected fetch — local cleanup must never be hostage to the IAM', async () => {
    fetchMock.mockRejectedValue(new Error('iam down'));

    await expect(revokeUpstreamSession(workosSession)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves null on a non-ok IAM answer without retrying', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });

    await expect(revokeUpstreamSession(workosSession)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips the IAM for a local session', async () => {
    await expect(revokeUpstreamSession({ provider: 'local', email: 'a@b.c' })).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips the IAM when IAM_BASE_URL is not configured', async () => {
    vi.stubEnv('IAM_BASE_URL', '');

    await expect(revokeUpstreamSession(workosSession)).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('idpLogoutTarget', () => {
  it('appends return_to pointing at the local signed-out landing', () => {
    const target = idpLogoutTarget(
      'https://api.workos.com/user_management/sessions/logout?session_id=sess_123',
      'https://forms.example.com',
    );

    const url = new URL(target!);
    expect(url.origin + url.pathname).toBe('https://api.workos.com/user_management/sessions/logout');
    expect(url.searchParams.get('session_id')).toBe('sess_123');
    expect(url.searchParams.get('return_to')).toBe('https://forms.example.com/login?signedout=1');
  });

  it('overwrites a preexisting return_to', () => {
    const target = idpLogoutTarget(
      'https://api.workos.com/logout?return_to=https%3A%2F%2Felsewhere.example',
      'https://forms.example.com',
    );

    expect(new URL(target!).searchParams.get('return_to')).toBe('https://forms.example.com/login?signedout=1');
  });

  it('returns null for an absent or unparseable logout URL', () => {
    expect(idpLogoutTarget(null, 'https://forms.example.com')).toBeNull();
    expect(idpLogoutTarget('/relative-not-a-url', 'https://forms.example.com')).toBeNull();
  });

  // The value is the IAM's `logoutUrl` field verbatim and the browser is sent to
  // it. Parseable is not the same as navigable.
  it.each([
    'javascript:alert(document.cookie)',
    'data:text/html,<script>fetch("//evil.example")</script>',
    'http://evil.example/user_management/sessions/logout',
    'file:///etc/passwd',
  ])('returns null for %s', (logoutUrl) => {
    expect(idpLogoutTarget(logoutUrl, 'https://forms.example.com')).toBeNull();
  });

  // The offline harness points at a stub IAM on localhost, so http there has to
  // keep working.
  it('allows http on localhost for the offline harness', () => {
    const target = idpLogoutTarget('http://localhost:4400/auth/logout', 'http://localhost:3400');
    expect(new URL(target!).searchParams.get('return_to')).toBe(
      'http://localhost:3400/login?signedout=1',
    );
  });
});
