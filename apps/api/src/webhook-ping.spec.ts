/**
 * The webhook test delivery (`POST /v1/forms/:id/destinations/webhook/ping`),
 * end to end on in-memory SQLite through the real controller → AuthService → db.
 *
 * What this locks down, in order of how badly it would hurt to lose it:
 *
 *   1. **the SSRF guard runs.** An endpoint that makes the SERVER fetch a URL
 *      the USER supplied is the textbook internal-network probe. A stored URL
 *      pointing at a private/reserved address must be REFUSED, and no request
 *      may leave — asserted by the fetch spy never being called.
 *   2. **loopback is allowed only for a literal localhost host**, the same
 *      carve-out the URL validator makes for a developer with a local catcher.
 *      An https host that merely RESOLVES to loopback is the DNS-rebinding path
 *      and stays blocked.
 *   3. **account scoping**: another account's form is a 404, never a ping.
 *   4. the sample body carries the real payload shape, is signed when a secret
 *      is stored, and is marked as a test so a receiver cannot mistake it for a
 *      lead.
 *   5. a form with no webhook configured is a clear 400, not a silent success.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  createDb,
  migrate,
  seed,
  getAccountByCode,
  listFormDeliveries,
  updateFormDestinations,
  WEBHOOK_PING_ACTION,
  type Db,
} from '@quill/db';
import { FormDestinationsController } from './integrations.controller';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';

/** The local stub resolves the seeded owner with no header at all. */
const asOwner = (): ReqLike => ({ headers: {} });

describe('webhook ping', () => {
  let db: Db;
  let controller: FormDestinationsController;
  let calls: { url: string; init: RequestInit }[];
  let accountId: string;
  let formId: string;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    const account = await getAccountByCode(db, 'acme');
    accountId = account!.id;
    const provider = new LocalAuthProvider(db, {
      NODE_ENV: 'test',
      DEV_LOGIN_EMAIL: undefined,
      AUTH_LOCAL_STRICT: undefined,
      SEED_DEMO_FORM: false,
      ONBOARDING_WIZARD: false,
    });
    const auth = new AuthService(db, provider);
    controller = new FormDestinationsController(db, auth);
    calls = [];
    controller.fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(async () => {
    await db.close();
  });

  /** The seeded demo form for the `acme` account. */
  async function seededFormId(): Promise<string> {
    const { sql } = await import('@quill/db');
    const r = await db.get<{ id: string }>(
      sql`SELECT id FROM form WHERE account_id = ${accountId} LIMIT 1`,
    );
    return String(r!.id);
  }

  async function setWebhook(url: string, secret?: string): Promise<void> {
    formId = await seededFormId();
    const out = await updateFormDestinations(db, accountId, formId, [
      { type: 'webhook', enabled: true, settings: { url, ...(secret ? { secret } : {}) } },
    ]);
    expect(out.ok).toBe(true);
  }

  it('refuses a private address and never lets a request leave', async () => {
    await setWebhook('https://10.0.0.5/hook');
    const res = await controller.pingWebhook(asOwner(), formId);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/private|reserved|blocked/i);
    expect(calls).toHaveLength(0);
  });

  it('refuses the cloud metadata address', async () => {
    await setWebhook('https://169.254.169.254/latest/meta-data/');
    const res = await controller.pingWebhook(asOwner(), formId);
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('allows a literal localhost URL — the developer carve-out', async () => {
    await setWebhook('http://localhost:4999/hook');
    const res = await controller.pingWebhook(asOwner(), formId);
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('sends the real payload shape, signed, and marked as a test', async () => {
    await setWebhook('http://localhost:4999/hook', 'a-signing-secret');
    await controller.pingWebhook(asOwner(), formId);
    const sent = calls[0]!;
    const headers = sent.init.headers as Record<string, string>;
    expect(headers['x-forms-event']).toBe('form.submission');
    expect(headers['x-forms-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    const body = JSON.parse(String(sent.init.body)) as {
      id: string;
      form: { id: string };
      submission: { id: string };
      data: Record<string, unknown>;
    };
    expect(body.id).toMatch(/^ping:/);
    expect(body.form.id).toBe(formId);
    expect(body.submission.id).toBe('test-submission');
    expect(body.data.test).toBe(true);
  });

  it('reports a clear 400 when the form has no webhook configured', async () => {
    formId = await seededFormId();
    await updateFormDestinations(db, accountId, formId, []);
    await expect(controller.pingWebhook(asOwner(), formId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404s a form id that belongs to another account', async () => {
    await setWebhook('http://localhost:4999/hook');
    await expect(
      controller.pingWebhook(asOwner(), 'a-form-from-somewhere-else'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(calls).toHaveLength(0);
  });

  /**
   * The failure REASON, which is the whole point of a test button.
   *
   * "webhook delivery failed: HTTP 400" is true and useless — it sends the
   * author to check the wrong thing. Each status has to arrive as a reason the
   * UI has a sentence for, carrying the endpoint's own words.
   */
  describe('explains why a delivery failed', () => {
    /** Answer the ping with a chosen status + body, then read the result. */
    async function ping(status: number, body = ''): Promise<Awaited<ReturnType<typeof controller.pingWebhook>>> {
      await setWebhook('http://localhost:4999/hook');
      controller.fetchImpl = (async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(body, { status });
      }) as unknown as typeof fetch;
      return controller.pingWebhook(asOwner(), formId);
    }

    it('names a refused method only when the endpoint actually said so', async () => {
      const res = await ping(405);
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('method_not_allowed');
      expect(res.status).toBe(405);
    });

    it('does NOT claim the method was wrong on a 400 — the body was rejected', async () => {
      const res = await ping(400);
      expect(res.reason).toBe('rejected_body');
      expect(res.reason).not.toBe('method_not_allowed');
    });

    it("passes through the endpoint's own explanation", async () => {
      const res = await ping(400, '{"error":"missing field: email"}');
      expect(res.detail).toBe('{"error":"missing field: email"}');
    });

    it('truncates a huge error page instead of storing it whole', async () => {
      const res = await ping(500, 'x'.repeat(5000));
      expect(res.reason).toBe('server_error');
      expect(res.detail!.length).toBeLessThan(500);
      expect(res.detail!.endsWith('…')).toBe(true);
    });

    it.each([
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [404, 'not_found'],
      [415, 'unsupported_media_type'],
      [429, 'rate_limited'],
      [502, 'server_error'],
    ])('maps HTTP %i to %s', async (status, reason) => {
      const res = await ping(status);
      expect(res.reason).toBe(reason);
    });

    it('calls a refusal by the SSRF guard blocked, not unreachable', async () => {
      await setWebhook('https://10.0.0.5/hook');
      const res = await controller.pingWebhook(asOwner(), formId);
      expect(res.reason).toBe('blocked');
      expect(calls).toHaveLength(0);
    });

    it('reports a host that never answers as unreachable', async () => {
      await setWebhook('http://localhost:4999/hook');
      controller.fetchImpl = (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch;
      const res = await controller.pingWebhook(asOwner(), formId);
      expect(res.reason).toBe('unreachable');
    });

    it('leaves a success with no reason at all', async () => {
      await setWebhook('http://localhost:4999/hook');
      const res = await controller.pingWebhook(asOwner(), formId);
      expect(res).toEqual({ ok: true });
    });
  });

  /**
   * The test delivery is logged like a real one.
   *
   * It never passes through the outbox — the author clicks and waits — but it is
   * a real signed POST to the real endpoint, and when someone is wiring a
   * webhook up it is very often the ONLY delivery that has run. Leaving it out
   * kept the history empty during exactly the session it exists to help.
   */
  describe('what the history records', () => {
    const history = () =>
      listFormDeliveries(db, accountId, formId, {
        kinds: ['webhook'],
        statuses: ['done', 'pending', 'failed', 'skipped'],
      });

    it('records a successful test, with what was sent and what came back', async () => {
      await setWebhook('http://localhost:4999/hook');
      await controller.pingWebhook(asOwner(), formId);

      const [row] = await history();
      expect(row?.status).toBe('done');
      expect(row?.action).toBe(WEBHOOK_PING_ACTION);
      expect(row?.responseStatus).toBe(200);
      expect(row?.responseBody).toBe('{"ok":true}');
      // The transcript is the delivery's own body, not the enqueued snapshot.
      expect(JSON.parse(String(row?.requestBody)).data.test).toBe(true);
    });

    it('records a rejected test with the endpoint’s own answer', async () => {
      await setWebhook('http://localhost:4999/hook');
      controller.fetchImpl = (async () =>
        new Response('{"error":"missing field"}', { status: 400 })) as unknown as typeof fetch;
      await controller.pingWebhook(asOwner(), formId);

      const [row] = await history();
      expect(row?.status).toBe('failed');
      expect(row?.responseStatus).toBe(400);
      expect(row?.responseBody).toBe('{"error":"missing field"}');
      expect(row?.lastError).toBe('webhook delivery failed: HTTP 400');
    });

    it('records the body even when nothing ever answered', async () => {
      // "We sent THIS and the host never replied" is still the useful half.
      await setWebhook('http://localhost:4999/hook');
      controller.fetchImpl = (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch;
      await controller.pingWebhook(asOwner(), formId);

      const [row] = await history();
      expect(row?.status).toBe('failed');
      expect(row?.requestBody).toContain('"test":true');
      expect(row?.responseStatus).toBeNull();
    });

    it('records a refusal by the SSRF guard, with no transcript to show', async () => {
      // Nothing crossed the wire, so there is no request or response to keep —
      // but the author DID click Send test, and an empty history after a click
      // is the exact complaint this panel exists to answer. The reason the guard
      // gave is the whole record.
      await setWebhook('https://10.0.0.5/hook');
      await controller.pingWebhook(asOwner(), formId);

      const [row] = await history();
      expect(row?.status).toBe('failed');
      expect(row?.lastError).toMatch(/private|reserved|blocked/i);
      expect(row?.requestBody).toBeNull();
      expect(row?.responseStatus).toBeNull();
    });
  });
});
