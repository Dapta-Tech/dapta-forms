import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostFetch = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  hostFetch: (...a: unknown[]) => hostFetch(...a),
}));

import { GET } from './route';

describe('GET /admin/integrations/calendly/event-types', () => {
  beforeEach(() => vi.clearAllMocks());

  it('proxies the API list with the session identity, uncached', async () => {
    const payload = { enabled: true, cached: false, connectedAs: 'rep@acme.io', eventTypes: [] };
    hostFetch.mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await GET();
    expect(hostFetch).toHaveBeenCalledWith('/v1/integrations/calendly/event-types');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual(payload);
  });

  it('passes an upstream failure through as is, so the panel can say so', async () => {
    hostFetch.mockResolvedValue(new Response('{"error":"FORBIDDEN"}', { status: 403 }));
    const res = await GET();
    expect(res.status).toBe(403);
  });
});
