import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { WebhookDestination, signWebhookBody, DEFAULT_SIGNATURE_HEADER } from './webhook';
import { transcriptOfError, type DestinationContext } from '../destination.port';

/** A resolver that maps every host to a public IP — keeps tests off real DNS. */
const publicResolver = async () => ['93.184.216.34'];

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
      { url: 'https://acme.io/hook', secret: 'shh', signatureHeader: 'X-Sig', resolveDns: publicResolver },
      fetchImpl,
    );
    const c = ctx();
    const res = await dest.deliver(c);
    expect(res.delivered).toBe(true);
    expect(res.driver).toBe('webhook');

    const { init } = calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-forms-delivery']).toBe(c.idempotencyKey);
    expect(headers['x-forms-event']).toBe('form.submission');
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
    await new WebhookDestination(
      { url: 'https://acme.io/hook', resolveDns: publicResolver },
      fetchImpl,
    ).deliver(ctx());
    expect(headers['x-forms-signature']).toBeUndefined();
  });

  it('defaults the signature header to X-Forms-Signature', async () => {
    expect(DEFAULT_SIGNATURE_HEADER).toBe('X-Forms-Signature');
    let headers: Record<string, string> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await new WebhookDestination(
      { url: 'https://acme.io/hook', secret: 'shh', resolveDns: publicResolver },
      fetchImpl,
    ).deliver(ctx());
    expect(headers['x-forms-signature']).toBeDefined();
  });

  it('THROWS on a non-2xx response so the outbox retries', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(
      new WebhookDestination({ url: 'https://acme.io/hook', resolveDns: publicResolver }, fetchImpl).deliver(ctx()),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('refuses to follow a redirect (3xx is a failure, never a hop)', async () => {
    const fetchImpl = (async () =>
      new Response(null, { status: 302 })) as unknown as typeof fetch;
    await expect(
      new WebhookDestination({ url: 'https://acme.io/hook', resolveDns: publicResolver }, fetchImpl).deliver(ctx()),
    ).rejects.toThrow(/redirect/i);
  });

  it('aborts on timeout and THROWS (retryable)', async () => {
    // A fetch that only rejects when the abort signal fires.
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    await expect(
      new WebhookDestination(
        { url: 'https://acme.io/hook', timeoutMs: 10, resolveDns: publicResolver },
        fetchImpl,
      ).deliver(ctx()),
    ).rejects.toThrow();
  });

  // --- SSRF egress guard (H1) ------------------------------------------------

  it('blocks a private-range IP literal and never calls fetch', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      new WebhookDestination({ url: 'https://10.0.0.5/hook' }, fetchImpl).deliver(ctx()),
    ).rejects.toThrow(/private\/reserved|blocked/i);
    expect(called).toBe(false);
  });

  it('blocks the cloud metadata address (169.254.169.254)', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      new WebhookDestination({ url: 'https://169.254.169.254/latest/meta-data' }, fetchImpl).deliver(ctx()),
    ).rejects.toThrow(/blocked/i);
  });

  it('blocks a DNS name that resolves to a private address (rebind) and never calls fetch', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const resolveDns = async () => ['10.1.2.3'];
    await expect(
      new WebhookDestination({ url: 'https://evil.example.com/hook', resolveDns }, fetchImpl).deliver(ctx()),
    ).rejects.toThrow(/private\/reserved/i);
    expect(called).toBe(false);
  });

  it('blocks loopback when allowLocalhost is not set (production posture)', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      new WebhookDestination({ url: 'http://127.0.0.1:9000/hook' }, fetchImpl).deliver(ctx()),
    ).rejects.toThrow(/loopback|localhost|blocked/i);
  });

  it('permits localhost when allowLocalhost is set (non-prod dev catcher)', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const res = await new WebhookDestination(
      { url: 'http://localhost:9000/hook', allowLocalhost: true },
      fetchImpl,
    ).deliver(ctx());
    expect(res.delivered).toBe(true);
  });

  it('delivers to a public host that resolves publicly', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const res = await new WebhookDestination(
      { url: 'https://acme.io/hook', resolveDns: publicResolver },
      fetchImpl,
    ).deliver(ctx());
    expect(res.delivered).toBe(true);
  });
});

/**
 * The page the submission was answered on (#199): a top-level `visit` in the
 * envelope, the landing's HubSpot cookie included for receivers that sync
 * HubSpot through their own flows. The cookie is an online identifier, so the
 * body the dashboard shows back (the delivery transcript) never carries it.
 */
describe('WebhookDestination: the visit', () => {
  const HUTK = '0123456789abcdef0123456789abcdef';
  const VISIT = {
    pageUri: 'https://landing.example.com/offer?utm_source=fb',
    pageName: 'Home insurance',
    pageId: '12345',
    hutk: HUTK,
    hsPortalId: '4321',
    embedded: true,
  };

  function capture(status = 200) {
    const sent: Array<{ body: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent.push({ body: init.body as string, headers: init.headers as Record<string, string> });
      return new Response('{"accepted":true}', { status });
    }) as unknown as typeof fetch;
    const dest = new WebhookDestination({ url: 'https://acme.io/hook', secret: 'shh', resolveDns: publicResolver }, fetchImpl);
    return { sent, dest };
  }

  it('adds the page, whether it was embedded, and the cookie; the signature covers them', async () => {
    const { sent, dest } = capture();
    await dest.deliver(ctx({ visit: VISIT }));
    const { body, headers } = sent[0]!;
    expect(JSON.parse(body).visit).toEqual({
      pageUri: VISIT.pageUri,
      pageName: VISIT.pageName,
      embedded: true,
      hutk: HUTK,
    });
    expect(headers['x-forms-signature']).toBe(signWebhookBody(body, 'shh'));
  });

  it('keeps the shape stable when the page reported little: nulls, and no cookie key', async () => {
    const { sent, dest } = capture();
    await dest.deliver(ctx({ visit: { embedded: true } }));
    expect(JSON.parse(sent[0]!.body).visit).toEqual({ pageUri: null, pageName: null, embedded: true });
  });

  it('sends no visit key at all when none was reported', async () => {
    const { sent, dest } = capture();
    await dest.deliver(ctx());
    expect(JSON.parse(sent[0]!.body)).not.toHaveProperty('visit');
  });

  it('records a transcript that hides the cookie, delivered or refused', async () => {
    const ok = capture();
    const result = await ok.dest.deliver(ctx({ visit: VISIT }));
    expect(ok.sent[0]!.body).toContain(HUTK);
    expect(result.requestBody).not.toContain(HUTK);
    expect(JSON.parse(result.requestBody!).visit.hutk).toBe('[hidden]');

    const refused = capture(500);
    const err = await refused.dest.deliver(ctx({ visit: VISIT })).catch((e: unknown) => e);
    expect(transcriptOfError(err).requestBody).toBeDefined();
    expect(transcriptOfError(err).requestBody).not.toContain(HUTK);

    const offline = new WebhookDestination({ url: 'https://acme.io/hook', resolveDns: publicResolver }, (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch);
    const netErr = await offline.deliver(ctx({ visit: VISIT })).catch((e: unknown) => e);
    expect(transcriptOfError(netErr).requestBody).not.toContain(HUTK);
  });

  it('hides the cookie in what an echoing receiver answers, delivered or refused', async () => {
    // Request bins and workflow tools often answer with the request itself, and
    // the delivery history shows the receiver's answer verbatim.
    const echo = (status: number) =>
      (async (_url: string, init: RequestInit) => new Response(init.body as string, { status })) as unknown as typeof fetch;
    const small = ctx({ data: {}, utm: {}, visit: { hutk: HUTK, embedded: true } });
    const opts = { url: 'https://acme.io/hook', resolveDns: publicResolver };

    const delivered = await new WebhookDestination(opts, echo(200)).deliver(small);
    expect(delivered.responseBody).toContain('"hutk":"[hidden]"');
    expect(delivered.responseBody).not.toContain(HUTK);

    const refused = await new WebhookDestination(opts, echo(500)).deliver(small).catch((e: unknown) => e);
    expect(transcriptOfError(refused).responseBody).toContain('"hutk":"[hidden]"');
    expect(transcriptOfError(refused).responseBody).not.toContain(HUTK);
  });

  it('hides the cookie before cutting a long answer, so no piece of it survives the cut', async () => {
    // 390 characters, then the cookie: cut at 400 first, and its first 10 would stay.
    const fetchImpl = (async () => new Response(`${'x'.repeat(390)}${HUTK.toUpperCase()}`, { status: 200 })) as unknown as typeof fetch;
    const result = await new WebhookDestination({ url: 'https://acme.io/hook', resolveDns: publicResolver }, fetchImpl).deliver(
      ctx({ visit: VISIT }),
    );
    expect(result.responseBody?.toLowerCase()).not.toContain(HUTK.slice(0, 10));
  });

  it('records the body verbatim when there is no cookie to hide', async () => {
    const { sent, dest } = capture();
    const result = await dest.deliver(ctx({ visit: { pageUri: VISIT.pageUri, embedded: true } }));
    expect(result.requestBody).toBe(sent[0]!.body);
  });
});
