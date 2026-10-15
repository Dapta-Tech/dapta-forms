/**
 * The public form's transport: a plain request to an address that is the same
 * in every build, a verdict only when the route gave one, and nothing on the
 * public side that depends on a Server Action id (those change with every
 * deploy, which is how a form opened before one could never be finished).
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callAction, callActionWithRetry, isTransportError } from '@/lib/call-action';
import {
  presignUpload,
  publicFormEndpoint,
  recordBooking,
  recordEvent,
  recordEvents,
  submitForm,
} from './transport';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the request', () => {
  it('goes to the stable same-origin route, as JSON, with no action id', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, score: 1, outcome: null }));
    await submitForm('ac me', 'f/x', { sessionId: 's', data: { a: 1 } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/public/forms/ac%20me/f%2Fx/submissions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ sessionId: 's', data: { a: 1 } });
    expect(JSON.stringify(init.headers).toLowerCase()).not.toContain('next-action');
  });

  it('names each call by its operation', async () => {
    fetchMock.mockImplementation(async () => json(200, { ok: true }));
    await recordEvent('acme', 'f', { sessionId: 's', type: 'view' });
    await recordEvents('acme', 'f', { sessionId: 's', events: [{ type: 'step_view' }] });
    await recordBooking('acme', 'f', { sessionId: 's', provider: 'calendly' });
    await presignUpload('acme', 'f', {
      sessionId: 's',
      stepKey: 'cv',
      name: 'a.pdf',
      size: 1,
      mime: 'application/pdf',
    });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      publicFormEndpoint('acme', 'f', 'events'),
      publicFormEndpoint('acme', 'f', 'events'),
      publicFormEndpoint('acme', 'f', 'booking'),
      publicFormEndpoint('acme', 'f', 'uploads'),
    ]);
  });
});

describe('the answer', () => {
  it('a refusal is a verdict, handed back as is', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { ok: false, error: 'CAPTCHA_FAILED', message: 'x' }),
    );
    expect(await submitForm('acme', 'f', { sessionId: 's', data: {} })).toEqual({
      ok: false,
      error: 'CAPTCHA_FAILED',
      message: 'x',
    });
  });

  it.each([
    ['a gateway error while pods roll', () => new Response('<html>504</html>', { status: 504 })],
    ['a server without this route', () => new Response('Not Found', { status: 404 })],
    ['the API out of reach', () => json(502, { ok: false, error: 'UPSTREAM_UNAVAILABLE' })],
    [
      'a 200 that is not the route (a proxy page)',
      () => new Response('<html>maintenance</html>', { status: 200 }),
    ],
    ['a 200 without a verdict', () => json(200, { hello: 'world' })],
  ])('%s is no verdict: the call rejects', async (_, response) => {
    fetchMock.mockResolvedValueOnce(response());
    await expect(submitForm('acme', 'f', { sessionId: 's', data: {} })).rejects.toThrow();
  });

  it('a dropped connection rejects too', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(recordEvent('acme', 'f', { sessionId: 's', type: 'view' })).rejects.toThrow();
  });
});

describe('the guarantees the renderers build on', () => {
  it('the submit, retried, lands after a deploy gateway error', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 504 }))
      .mockResolvedValueOnce(json(200, { ok: true, score: 0, outcome: null }));
    const res = await callActionWithRetry(
      () => submitForm('acme', 'f', { sessionId: 's', data: {} }),
      { baseDelayMs: 1 },
    );
    expect(res).toEqual({ ok: true, score: 0, outcome: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a booking record goes exactly once, even when it gets no verdict', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 504 }));
    const res = await callAction(() =>
      recordBooking('acme', 'f', { sessionId: 's', provider: 'calendly' }),
    );
    expect(isTransportError(res)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/* ── Static guarantees over the public tree ─────────────────────────────── */

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../../../..');
const RENDERERS = ['form-renderer.tsx', 'vertical-form-renderer.tsx'].map((f) => join(here, f));

/** Every module a file imports, resolved inside the web app (`@/` or relative). */
function localImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specs = [...src.matchAll(/(?:import|export)[^'"]*?from\s+'([^']+)'/g)].map((m) => m[1]!);
  const out: string[] = [];
  for (const spec of specs) {
    const base = spec.startsWith('@/')
      ? join(webRoot, spec.slice(2))
      : spec.startsWith('.')
        ? resolve(dirname(file), spec)
        : null;
    if (!base) continue;
    const hit = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
      .map((ext) => base + ext)
      .find((p) => existsSync(p) && !p.endsWith('/'));
    if (hit && /\.tsx?$/.test(hit)) out.push(hit);
  }
  return out;
}

describe('the public renderers', () => {
  it('reach no Server Action, directly or through anything they import', () => {
    const seen = new Set<string>();
    const queue = [...RENDERERS];
    const actions: string[] = [];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      if (/^\s*['"]use server['"]/.test(readFileSync(file, 'utf8'))) actions.push(file);
      queue.push(...localImports(file));
    }
    expect(seen.size).toBeGreaterThan(5);
    expect(actions).toEqual([]);
  });

  it('never retry a booking record (it is not idempotent)', () => {
    for (const file of RENDERERS) {
      const src = readFileSync(file, 'utf8');
      const calls = src.match(/recordBooking\(/g) ?? [];
      expect(calls.length).toBeGreaterThan(0);
      expect(src.match(/callAction\(\(\) =>\s*recordBooking\(/g)?.length).toBe(calls.length);
      expect(src).not.toMatch(/callActionWithRetry\([^)]*\)\s*=>\s*recordBooking/);
    }
  });
});
