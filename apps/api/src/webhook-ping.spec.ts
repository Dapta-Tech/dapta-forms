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
import { createDb, migrate, seed, getAccountByCode, updateFormDestinations, type Db } from '@quill/db';
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
});
