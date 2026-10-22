import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readZip } from '@/lib/test/read-zip';
import { serverApiUrl } from '@/lib/api-url';

const getSession = vi.fn();
const hostHeaders = vi.fn();
const refreshUpstreamSession = vi.fn();
const setSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  getSession: (...a: unknown[]) => getSession(...a),
  hostHeaders: (...a: unknown[]) => hostHeaders(...a),
  refreshUpstreamSession: (...a: unknown[]) => refreshUpstreamSession(...a),
  setSession: (...a: unknown[]) => setSession(...a),
}));

import { GET } from './route';

const req = () => new NextRequest('https://0.0.0.0:3000/api/developers/skill');
const session = { provider: 'workos', accessToken: 'tok' };
const fetchMock = vi.fn();

describe('GET /api/developers/skill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PUBLIC_APP_URL', 'https://forms.example.com');
    vi.stubEnv('PUBLIC_API_URL', 'https://api.forms.example.com');
    vi.stubEnv('API_URL', 'http://api.internal.svc.cluster.local');
    vi.stubGlobal('fetch', fetchMock);
    hostHeaders.mockResolvedValue({ authorization: 'Bearer tok' });
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    refreshUpstreamSession.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('answers 401 without a session, and never asks the API', async () => {
    getSession.mockResolvedValue(null);

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('UNAUTHENTICATED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 401 when the API no longer accepts the session', async () => {
    getSession.mockResolvedValue(session);
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));

    const res = await GET(req());

    expect(res.status).toBe(401);
  });

  it('refreshes an expired access token once and serves the zip', async () => {
    getSession.mockResolvedValue({ ...session, refreshToken: 'r1' });
    const fresh = { provider: 'workos', accessToken: 'tok2', refreshToken: 'r2' };
    refreshUpstreamSession.mockResolvedValue(fresh);
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(setSession).toHaveBeenCalledWith(fresh);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('answers 401 when the refreshed token is refused too', async () => {
    getSession.mockResolvedValue({ ...session, refreshToken: 'r1' });
    refreshUpstreamSession.mockResolvedValue({ provider: 'workos', accessToken: 'tok2' });
    fetchMock.mockImplementation(async () => new Response('{}', { status: 401 }));

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('answers 403 when the API refuses the workspace, not a 502', async () => {
    getSession.mockResolvedValue(session);
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }));

    const res = await GET(req());

    expect(res.status).toBe(403);
  });

  it('confirms the session against the API with the member identity', async () => {
    getSession.mockResolvedValue(session);

    await GET(req());

    expect(fetchMock).toHaveBeenCalledWith(
      `${serverApiUrl}/v1/me`,
      expect.objectContaining({ headers: { authorization: 'Bearer tok' } }),
    );
  });

  it('returns the zip with every file and the environment URLs already in place', async () => {
    getSession.mockResolvedValue(session);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="dforms-api-skill.zip"');
    expect(res.headers.get('cache-control')).toBe('no-store');

    const files = readZip(new Uint8Array(await res.arrayBuffer()));
    expect([...files.keys()]).toEqual(
      expect.arrayContaining([
        'dforms-api/SKILL.md',
        'dforms-api/INSTALL.md',
        'dforms-api/reference/endpoints.md',
        'dforms-api/reference/errors.md',
        'dforms-api/reference/form-config.schema.json',
        'dforms-api/recipes/quiz-with-scoring.md',
      ]),
    );
    const skill = files.get('dforms-api/SKILL.md')!;
    // The public API address, never the cluster-internal one the server uses.
    expect(skill).toContain('https://api.forms.example.com');
    expect(skill).not.toContain('svc.cluster.local');
    // The dashboard address is the configured public origin, not the pod's URL.
    expect(skill).toContain('https://forms.example.com/admin/developers/connect');
    expect(skill).not.toContain('0.0.0.0');
    expect(() => JSON.parse(files.get('dforms-api/reference/form-config.schema.json')!)).not.toThrow();
  });

  it('refuses to ship a zip that points nowhere when no public API address is configured', async () => {
    getSession.mockResolvedValue(session);
    vi.stubEnv('PUBLIC_API_URL', '');

    const res = await GET(req());

    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('API_URL_NOT_CONFIGURED');
  });

  it('says the API is unreachable rather than pretending the member is signed out', async () => {
    getSession.mockResolvedValue(session);
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await GET(req());

    expect(res.status).toBe(502);
  });
});
