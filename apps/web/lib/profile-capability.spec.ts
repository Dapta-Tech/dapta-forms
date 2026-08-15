/**
 * New web against a LITERAL old API — over real HTTP, not a mocked module.
 *
 * During a rolling deploy a new web pod can reach an API pod that predates the
 * compare-and-set contract. That API has no `/v2` route at all, so it answers a
 * framework 404, and its `/v1` writer is sitting right there, reachable and
 * unguarded. The rule this pins: the new web treats "no v2" as a capability
 * failure and blocks, and it NEVER quietly writes through `/v1` instead — that
 * fallback is exactly how an unguarded write would slip past the guard.
 *
 * The fake below is the old build's shape: `/v1` works and records every call,
 * `/v2` is unknown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('@/lib/auth-session', () => ({
  getSession: async () => ({ provider: 'local', email: 'alex@example.com' }),
  getWorkspace: async () => null,
  clearSession: async () => undefined,
  authProvider: () => 'local',
}));

/** Every path the web touched, in order. */
let touched: string[] = [];
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  touched = [];
  server = createServer((req, res) => {
    touched.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/v1/me/profile')) {
      // The old build's writer: alive, reachable, and revision-free.
      if (req.method === 'GET') {
        // An old build reports no revision and no capability at all.
        res.end(JSON.stringify({ handle: 'alex-rivera', profile: null }));
        return;
      }
      res.end(JSON.stringify({ ok: true, profile: null }));
      return;
    }
    // Nest's 404 for a route this build has never heard of.
    res.statusCode = 404;
    res.end(
      JSON.stringify({ statusCode: 404, message: `Cannot ${req.method} ${req.url}`, error: 'Not Found' }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubEnv('API_URL', baseUrl);
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('new web against an API with no /v2', () => {
  it('reports the capability as unavailable instead of writing', async () => {
    const { saveMyProfileV2 } = await import('./admin-api');

    const res = await saveMyProfileV2({ version: 1, enabled: true }, 0);

    expect(res).toEqual({ status: 'unsupported' });
  });

  it('never falls back to the /v1 writer that is sitting right there', async () => {
    const { saveMyProfileV2, fenceMyProfileV2 } = await import('./admin-api');

    await saveMyProfileV2({ version: 1, enabled: true }, 0);
    await fenceMyProfileV2(0);

    expect(touched).toEqual(['PUT /v2/me/profile', 'POST /v2/me/profile/fence']);
    expect(touched.some((t) => t.includes('/v1/'))).toBe(false);
  });

  it('cannot fence either, so an ambiguous save stays unsettled rather than guessed', async () => {
    const { fenceMyProfileV2 } = await import('./admin-api');

    expect(await fenceMyProfileV2(3)).toEqual({ status: 'unsupported' });
  });

  it('reads no revision from the old GET, which is what makes the screen block', async () => {
    const { adminApi } = await import('./admin-api');

    const read = await adminApi.myProfile();

    expect(read.revision).toBeUndefined();
    // The settings page maps a missing revision to `unsupported`, which blocks
    // editing — see `public-page.spec.tsx` for what that renders.
  });

  it('still recognises a genuine member 404 as different from a missing route', async () => {
    // A current API answers `{ error: 'NOT_FOUND' }` for a member who is gone.
    // That must not be read as "this build cannot guard writes".
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      touched.push(`${req.method} ${req.url}`);
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'NOT_FOUND', message: 'Not found.' }));
    });
    const { saveMyProfileV2 } = await import('./admin-api');

    expect(await saveMyProfileV2(null, 0)).toEqual({ status: 'not_found' });
  });
});


describe('an API that speaks v2 but has writes switched off', () => {
  it('reports the capability as unavailable rather than letting a write through', async () => {
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      touched.push(`${req.method} ${req.url}`);
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET') {
        res.end(JSON.stringify({ handle: 'alex-rivera', profile: null, revision: 3, writesEnabled: false }));
        return;
      }
      // The gate refuses before the row is touched.
      res.statusCode = 501;
      res.end(JSON.stringify({ error: 'V2_WRITES_DISABLED', message: 'not enabled' }));
    });
    const { saveMyProfileV2, fenceMyProfileV2, adminApi } = await import('./admin-api');

    expect(await saveMyProfileV2({ version: 1, enabled: true }, 3)).toEqual({ status: 'unsupported' });
    expect(await fenceMyProfileV2(3)).toEqual({ status: 'unsupported' });
    // The read still works and says why the screen must block.
    expect(await adminApi.myProfile()).toMatchObject({ revision: 3, writesEnabled: false });
    // And it never reaches for the deprecated writer.
    expect(touched.some((t) => t.includes('/v1/me/profile') && !t.startsWith('GET'))).toBe(false);
  });
});

describe('an API that cannot resolve a write', () => {
  it('is reported as unknown, so the screen stays blocked instead of adopting', async () => {
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      touched.push(`${req.method} ${req.url}`);
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'WRITE_UNRESOLVED', message: 'ask again' }));
    });
    const { saveMyProfileV2, fenceMyProfileV2 } = await import('./admin-api');

    expect(await saveMyProfileV2({ version: 1, enabled: true }, 3)).toEqual({ status: 'unknown' });
    expect(await fenceMyProfileV2(3)).toEqual({ status: 'unknown' });
  });
});
