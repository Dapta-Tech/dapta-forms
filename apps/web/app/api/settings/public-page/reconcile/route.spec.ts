/**
 * The reconciliation Route Handler — the only thing that can settle a public
 * page save whose answer never arrived.
 *
 * It exists off the Server Action queue, so its guarantees are its own: POST
 * only, same-origin only, revision required, and every refusal is JSON with a
 * matching status code. A background caller must never receive login HTML with
 * a 200, and a GET must never be able to advance a revision.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fenceMyProfileV2 = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/lib/admin-api', () => ({
  fenceMyProfileV2: (...a: unknown[]) => fenceMyProfileV2(...a),
}));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import * as route from './route';

/** A request as it arrives behind a proxy: public Origin, internal Host. */
const proxied = (headers: Record<string, string>): Request =>
  new Request('https://forms.example.com/api/settings/public-page/reconcile', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ expectedRevision: 4 }),
  });

const post = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request('https://forms.example.com/api/settings/public-page/reconcile', {
    method: 'POST',
    headers: { origin: 'https://forms.example.com', host: 'forms.example.com', ...headers },
    body: JSON.stringify(body),
  });

describe('POST /api/settings/public-page/reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is the only verb: nothing else can mutate a revision', () => {
    expect(typeof route.POST).toBe('function');
    for (const verb of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE'] as const) {
      expect(route[verb as keyof typeof route]).toBeUndefined();
    }
  });

  it('fences with the revision it was given and returns the settled state', async () => {
    fenceMyProfileV2.mockResolvedValue({ status: 'ok', profile: null, revision: 7 });

    const res = await route.POST(post({ expectedRevision: 6 }));

    expect(fenceMyProfileV2).toHaveBeenCalledWith(6);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', profile: null, revision: 7 });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings');
  });

  it('passes a conflict back with the authoritative state', async () => {
    fenceMyProfileV2.mockResolvedValue({ status: 'conflict', profile: null, revision: 9 });

    const res = await route.POST(post({ expectedRevision: 6 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'conflict', revision: 9 });
  });

  it('refuses a cross-site POST', async () => {
    const res = await route.POST(post({ expectedRevision: 6 }, { origin: 'https://evil.example' }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: 'forbidden' });
    expect(fenceMyProfileV2).not.toHaveBeenCalled();
  });

  it('refuses a POST with no Origin at all', async () => {
    const req = new Request('https://forms.example.com/api/settings/public-page/reconcile', {
      method: 'POST',
      headers: { host: 'forms.example.com' },
      body: JSON.stringify({ expectedRevision: 1 }),
    });

    expect((await route.POST(req)).status).toBe(403);
    expect(fenceMyProfileV2).not.toHaveBeenCalled();
  });

  it('accepts only a non-negative integer revision on the wire', async () => {
    for (const bad of [undefined, null, '6', 6.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
      const res = await route.POST(post({ expectedRevision: bad }));
      expect(res.status, `expectedRevision=${String(bad)}`).toBe(400);
    }
    expect(fenceMyProfileV2).not.toHaveBeenCalled();
  });

  it('ignores anything else on the wire — no profile, no member id', async () => {
    fenceMyProfileV2.mockResolvedValue({ status: 'ok', profile: null, revision: 2 });

    await route.POST(post({ expectedRevision: 1, memberId: 'someone-else', profile: { enabled: true } }));

    expect(fenceMyProfileV2).toHaveBeenCalledWith(1);
    expect(fenceMyProfileV2).toHaveBeenCalledTimes(1);
  });

  it('accepts a proxied call whose forwarded host matches the public origin', async () => {
    // The internal Host is a service name; the browser only ever sees the public
    // origin. Comparing the raw Host would reject every real call behind a
    // proxy, and "Check again" could never leave the unresolved state.
    fenceMyProfileV2.mockResolvedValue({ status: 'ok', profile: null, revision: 5 });

    const res = await route.POST(
      proxied({
        origin: 'https://forms.example.com',
        host: 'web.internal.svc:3000',
        'x-forwarded-host': 'forms.example.com',
      }),
    );

    expect(res.status).toBe(200);
    expect(fenceMyProfileV2).toHaveBeenCalledWith(4);
  });

  it('takes the first hop of a chained forwarded host', async () => {
    fenceMyProfileV2.mockResolvedValue({ status: 'ok', profile: null, revision: 5 });

    const res = await route.POST(
      proxied({
        origin: 'https://forms.example.com',
        host: 'web.internal.svc:3000',
        'x-forwarded-host': 'forms.example.com, inner.mesh',
      }),
    );

    expect(res.status).toBe(200);
  });

  it('still rejects a foreign origin behind that same proxy shape', async () => {
    const res = await route.POST(
      proxied({
        origin: 'https://evil.example',
        host: 'web.internal.svc:3000',
        'x-forwarded-host': 'forms.example.com',
      }),
    );

    expect(res.status).toBe(403);
    expect(fenceMyProfileV2).not.toHaveBeenCalled();
  });

  it('rejects a forwarded host that does not match the claimed origin', async () => {
    const res = await route.POST(
      proxied({
        origin: 'https://forms.example.com',
        host: 'forms.example.com',
        'x-forwarded-host': 'attacker.example',
      }),
    );

    expect(res.status).toBe(403);
    expect(fenceMyProfileV2).not.toHaveBeenCalled();
  });

  it('answers an expired session with JSON 401, never login HTML at 200', async () => {
    fenceMyProfileV2.mockResolvedValue({ status: 'unauthorized' });

    const res = await route.POST(post({ expectedRevision: 3 }));

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ status: 'unauthorized' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('keeps an undecided fence undecided (503), so the screen stays blocked', async () => {
    fenceMyProfileV2.mockResolvedValue({ status: 'unknown' });

    const res = await route.POST(post({ expectedRevision: 3 }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'unknown' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('reports an API that cannot fence rather than pretending it settled', async () => {
    fenceMyProfileV2.mockResolvedValue({ status: 'unsupported' });

    expect((await route.POST(post({ expectedRevision: 3 }))).status).toBe(409);
  });
});
