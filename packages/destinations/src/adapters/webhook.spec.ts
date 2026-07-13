import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { WebhookDestination, signWebhookBody } from './webhook';
import type { DestinationContext } from '../destination.port';

function ctx(over: Partial<DestinationContext> = {}): DestinationContext {
  return {
    idempotencyKey: 'submission:sub-1:complete:webhook',
    submissionId: 'sub-1',
    formId: 'form-1',
    formName: 'Lead Qualifier',
    accountId: 'acc-1',
    sessionId: 'sess-1',
    score: 18,
    outcomeLabel: 'Qualified',
    phase: 'complete',
    submittedAt: 1_700_000_000_000,
    data: { email: 'lead@acme.io', role: 'founder' },
    utm: { utm_source: 'google' },
    ...over,
  };
}

describe('signWebhookBody', () => {
  it('produces a sha256-prefixed HMAC a receiver can recompute', () => {
    const sig = signWebhookBody('{"a":1}', 'secret');
    const expected = `sha256=${createHmac('sha256', 'secret').update('{"a":1}').digest('hex')}`;
    expect(sig).toBe(expected);
  });
});

describe('WebhookDestination', () => {
  it('POSTs the envelope and signs it with the configured secret + header', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const dest = new WebhookDestination(
      { url: 'https://acme.io/hook', secret: 'shh', signatureHeader: 'X-Sig' },
      fetchImpl,
    );
    const c = ctx();
    const res = await dest.deliver(c);
    expect(res.delivered).toBe(true);
    expect(res.driver).toBe('webhook');

    const { init } = calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-quill-delivery']).toBe(c.idempotencyKey);
    expect(headers['x-quill-event']).toBe('form.submission');
    // The signature validates against the exact body sent.
    const body = init.body as string;
    expect(headers['x-sig']).toBe(signWebhookBody(body, 'shh'));
    const parsed = JSON.parse(body);
    expect(parsed.submission.score).toBe(18);
    expect(parsed.submission.outcome).toBe('Qualified');
    expect(parsed.utm.utm_source).toBe('google');
    expect(parsed.phase).toBe('complete');
  });

  it('omits the signature header when no secret is set', async () => {
    let headers: Record<string, string> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await new WebhookDestination({ url: 'https://acme.io/hook' }, fetchImpl).deliver(ctx());
    expect(headers['x-quill-signature']).toBeUndefined();
  });

  it('THROWS on a non-2xx response so the outbox retries', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(
      new WebhookDestination({ url: 'https://acme.io/hook' }, fetchImpl).deliver(ctx()),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('refuses to follow a redirect (3xx is a failure, never a hop)', async () => {
    const fetchImpl = (async () =>
      new Response(null, { status: 302 })) as unknown as typeof fetch;
    await expect(
      new WebhookDestination({ url: 'https://acme.io/hook' }, fetchImpl).deliver(ctx()),
    ).rejects.toThrow(/redirect/i);
  });

  it('aborts on timeout and THROWS (retryable)', async () => {
    // A fetch that only rejects when the abort signal fires.
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    await expect(
      new WebhookDestination({ url: 'https://acme.io/hook', timeoutMs: 10 }, fetchImpl).deliver(ctx()),
    ).rejects.toThrow();
  });
});
