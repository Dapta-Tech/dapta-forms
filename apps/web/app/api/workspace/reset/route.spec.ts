import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { WORKSPACE_COOKIE } from '@/lib/session';
import { GET } from './route';

/**
 * The regression this pins: behind the deployment's proxy the standalone
 * server sees no public Host, so `request.url` is `https://0.0.0.0:3000/...`.
 * The redirect used to be built from it, and every WORKSPACE_FORBIDDEN reset
 * sent the browser to https://0.0.0.0:3000/admin verbatim.
 */
describe('GET /api/workspace/reset', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('redirects to /admin on the configured public origin, not the pod-internal request URL', async () => {
    vi.stubEnv('PUBLIC_APP_URL', 'https://forms.example.com');

    const res = await GET(new NextRequest('https://0.0.0.0:3000/api/workspace/reset'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://forms.example.com/admin');
    // The dead workspace choice is dropped with the same response.
    expect(res.cookies.get(WORKSPACE_COOKIE)?.value).toBe('');
  });

  it('without PUBLIC_APP_URL (self-host clone) falls back to the forwarded host', async () => {
    vi.stubEnv('PUBLIC_APP_URL', '');

    const res = await GET(
      new NextRequest('https://0.0.0.0:3000/api/workspace/reset', {
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'clone.example.com' },
      }),
    );

    expect(res.headers.get('location')).toBe('https://clone.example.com/admin');
  });
});
