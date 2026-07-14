import { createHash, createHmac } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import {
  HttpEmailProvider,
  TRANSACTIONAL_EMAIL_PATH,
  signTransactionalRequest,
  interpretTransactionalResponse,
} from './http';

const ENDPOINT = `https://email.internal.example.com${TRANSACTIONAL_EMAIL_PATH}`;
const CLIENT_ID = 'forms';
const SECRET = 'a'.repeat(48); // >= 32 chars, like a real signing secret

/** A fetch stub that records the single request and returns a canned 2xx JSON. */
function stubFetch(status = 200, body: unknown = { status: 'accepted', messageId: 'msg-1' }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('signTransactionalRequest', () => {
  it('signs the canonical v1 payload with the logical path (not the request URL)', () => {
    const body = JSON.stringify({ hello: 'world' });
    const ts = '1700000000';
    const idem = 'submission:s1:received';
    const bodyHash = createHash('sha256').update(body).digest('hex');
    const canonical = ['v1', 'POST', TRANSACTIONAL_EMAIL_PATH, ts, idem, bodyHash].join('\n');
    const expected = createHmac('sha256', SECRET).update(canonical).digest('hex');
    expect(signTransactionalRequest(body, ts, idem, SECRET)).toBe(expected);
    expect(signTransactionalRequest(body, ts, idem, SECRET)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('HttpEmailProvider — transactional-v1', () => {
  it('POSTs a correctly-signed transactional payload the server can verify', async () => {
    const { impl, calls } = stubFetch();
    const provider = new HttpEmailProvider(
      {
        endpoint: ENDPOINT,
        profile: 'transactional-v1',
        clientId: CLIENT_ID,
        signingSecret: SECRET,
        fromEmail: 'form@notifications-dapta.ai',
        fromName: 'Dapta Forms',
      },
      impl,
    );

    const result = await provider.send({
      accountId: 'acc-1',
      to: 'owner@acme.io',
      subject: 'New submission — Lead Qualifier',
      text: 'You have a new submission.',
      html: '<p>You have a new submission.</p>',
      idempotencyKey: 'submission:s1:received',
    });

    expect(result).toEqual({ delivered: true, messageId: 'msg-1', driver: 'http' });
    expect(calls).toHaveLength(1);
    const { init } = calls[0]!;
    const headers = init.headers as Record<string, string>;

    // Auth headers present, signature is a 64-hex HMAC.
    expect(headers['x-dapta-client-id']).toBe(CLIENT_ID);
    expect(headers['x-dapta-timestamp']).toMatch(/^\d+$/);
    expect(headers['x-dapta-signature']).toMatch(/^[a-f0-9]{64}$/);
    // No legacy bearer when the HMAC pair is configured.
    expect(headers.authorization).toBeUndefined();

    // Body carries ONLY the managed fields — never from/fromName/headers.
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({
      mode: 'html',
      to: ['owner@acme.io'],
      subject: 'New submission — Lead Qualifier',
      category: 'lifecycle',
      idempotencyKey: 'submission:s1:received',
      businessContext: { accountId: 'acc-1' },
    });
    expect(sent.from).toBeUndefined();
    expect(sent.fromName).toBeUndefined();
    expect(sent.headers).toBeUndefined();

    // The server rebuilds the SAME signature from the raw body + headers — prove it verifies.
    const recomputed = signTransactionalRequest(
      init.body as string,
      headers['x-dapta-timestamp']!,
      sent.idempotencyKey,
      SECRET,
    );
    expect(headers['x-dapta-signature']).toBe(recomputed);
  });

  it('requires a tenant account context on the signed wire', async () => {
    const { impl } = stubFetch();
    const provider = new HttpEmailProvider(
      { endpoint: ENDPOINT, profile: 'transactional-v1', clientId: CLIENT_ID, signingSecret: SECRET, fromEmail: 'form@notifications-dapta.ai' },
      impl,
    );
    expect(provider.requiresAccountContext).toBe(true);
    await expect(provider.send({ to: 'x@y.com', subject: 's' })).rejects.toThrow(/account context/i);
  });

  it('throws on a non-2xx so the outbox retries (never a silent drop)', async () => {
    const { impl } = stubFetch(500, {});
    const provider = new HttpEmailProvider(
      { endpoint: ENDPOINT, profile: 'transactional-v1', clientId: CLIENT_ID, signingSecret: SECRET, fromEmail: 'form@notifications-dapta.ai' },
      impl,
    );
    await expect(
      provider.send({ accountId: 'acc-1', to: 'x@y.com', subject: 's', idempotencyKey: 'k' }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe('interpretTransactionalResponse', () => {
  it('accepts accepted/delivered (incl. idempotent duplicates)', () => {
    expect(interpretTransactionalResponse(200, { status: 'accepted', messageId: 'm' })).toEqual({
      delivered: true,
      messageId: 'm',
      driver: 'http',
    });
    expect(interpretTransactionalResponse(200, { status: 'delivered', id: 'd', duplicate: true })).toEqual({
      delivered: true,
      messageId: 'd',
      driver: 'http',
    });
  });

  it('throws for non-2xx regardless of body', () => {
    expect(() => interpretTransactionalResponse(422, { status: 'accepted' })).toThrow(/HTTP 422/);
  });

  it('throws for blocked_by_policy and for a malformed 2xx', () => {
    expect(() => interpretTransactionalResponse(200, { status: 'blocked_by_policy', blockedReason: 'x' })).toThrow(
      /blocked by policy/i,
    );
    expect(() => interpretTransactionalResponse(200, {})).toThrow(/malformed/i);
    expect(() => interpretTransactionalResponse(200, { status: 'weird' })).toThrow(/unexpected status/i);
  });
});
