/**
 * The public form's stable endpoint: what it accepts, and that anything other
 * than a verdict comes back as a non-200 the browser will not mistake for one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const relay = vi.hoisted(() => ({ relayPublicFormCall: vi.fn() }));
vi.mock('@/lib/public-form-relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/public-form-relay')>()),
  relayPublicFormCall: relay.relayPublicFormCall,
}));

import { POST } from './route';

const params = (op: string) => ({
  params: Promise.resolve({ accountCode: 'acme', slug: 'f', op }),
});

function request(
  body: string,
  headers: Record<string, string> = { 'content-type': 'application/json' },
) {
  return new Request('http://localhost/api/public/forms/acme/f/submissions', {
    method: 'POST',
    headers,
    body,
  });
}

beforeEach(() => {
  relay.relayPublicFormCall.mockReset();
});

describe('POST /api/public/forms/:accountCode/:slug/:op', () => {
  it('relays the parsed body and answers the verdict', async () => {
    relay.relayPublicFormCall.mockResolvedValueOnce({ status: 200, body: { ok: true, score: 3 } });
    const res = await POST(
      request(JSON.stringify({ sessionId: 's', data: { a: 1 } })),
      params('submissions'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true, score: 3 });
    expect(relay.relayPublicFormCall).toHaveBeenCalledWith('submissions', 'acme', 'f', {
      sessionId: 's',
      data: { a: 1 },
    });
  });

  it('answers 404 for an operation it does not know', async () => {
    const res = await POST(request('{}'), params('delete'));
    expect(res.status).toBe(404);
    expect(relay.relayPublicFormCall).not.toHaveBeenCalled();
  });

  it('requires a JSON body, which a cross-site form cannot send without a preflight', async () => {
    const res = await POST(request('{}', { 'content-type': 'text/plain' }), params('events'));
    expect(res.status).toBe(415);
    expect(relay.relayPublicFormCall).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a JSON object', async () => {
    expect((await POST(request('not json'), params('events'))).status).toBe(400);
    expect((await POST(request('[1,2]'), params('events'))).status).toBe(400);
    expect((await POST(request('null'), params('events'))).status).toBe(400);
    expect(relay.relayPublicFormCall).not.toHaveBeenCalled();
  });

  it('refuses a body over the ceiling', async () => {
    const big = JSON.stringify({ sessionId: 's', data: { blob: 'x'.repeat(1_000_001) } });
    expect((await POST(request(big), params('submissions'))).status).toBe(413);
    expect(relay.relayPublicFormCall).not.toHaveBeenCalled();
  });

  it('stops reading a streamed body with no length once it passes the ceiling', async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    const req = new Request('http://localhost/api/public/forms/acme/f/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: endless,
      duplex: 'half',
    } as RequestInit);
    expect((await POST(req, params('submissions'))).status).toBe(413);
    expect(pulled).toBeLessThan(40);
    expect(relay.relayPublicFormCall).not.toHaveBeenCalled();
  });

  it('refuses a declared length over the ceiling without reading the body', async () => {
    const res = await POST(
      request('{}', { 'content-type': 'application/json', 'content-length': '2000000' }),
      params('submissions'),
    );
    expect(res.status).toBe(413);
  });

  it('answers 502 when the API cannot be reached: no verdict, so the browser may retry', async () => {
    relay.relayPublicFormCall.mockRejectedValueOnce(new TypeError('fetch failed'));
    const res = await POST(
      request(JSON.stringify({ sessionId: 's', data: {} })),
      params('submissions'),
    );
    expect(res.status).toBe(502);
  });
});
