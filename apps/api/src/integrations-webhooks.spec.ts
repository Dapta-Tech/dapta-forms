/**
 * `GET /v1/integrations/webhooks` — the account's webhook inventory, end to end
 * on in-memory SQLite through the real controller → AuthService → db.
 *
 * What it locks:
 *   1. one entry per webhook, scoped to the caller's account and no other;
 *   2. the back-compat trigger rule is RESOLVED here, so the client never has to
 *      know that absent `events` means both phases;
 *   3. failed deliveries are joined onto the form that owns them, and are null
 *      rather than a claim of health when there are none;
 *   4. no signing secret — and no mask sentinel — can appear in the response.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createDb,
  migrate,
  seed,
  enqueueOutbox,
  markOutboxFailed,
  getAccountByCode,
  insertAccountWithShortCode,
  createForm,
  updateFormDestinations,
  sql,
  type Db,
} from '@quill/db';
import { WEBHOOK_SECRET_MASK, type FormDestination } from '@quill/types';
import type { ServerEnv } from '@quill/config/env';
import {
  CalendlyEventTypesService,
  HubspotPropertiesService,
  IntegrationsController,
} from './integrations.controller';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';

/** No identity → the local provider resolves the first seeded account + owner. */
const asOwner = (): ReqLike => ({ headers: {} });
const asEmail = (email: string): ReqLike => ({ headers: { 'x-quill-email': email } });

const noopFetch = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;

const webhook = (settings: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ type: 'webhook', enabled: true, settings, ...extra }) as unknown as FormDestination;

let db: Db;
let controller: IntegrationsController;

function build(): void {
  const env = { NODE_ENV: 'test' } as unknown as ServerEnv;
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  const auth = new AuthService(db, provider);
  controller = new IntegrationsController(
    auth,
    new HubspotPropertiesService(env, db, noopFetch),
    new CalendlyEventTypesService(env, db, noopFetch),
    db,
    env,
  );
}

async function acmeId(): Promise<string> {
  const account = await getAccountByCode(db, 'acme');
  return account!.id;
}

/** A form carrying the given destinations, in `acme` unless told otherwise. */
async function seedForm(
  name: string,
  destinations: FormDestination[],
  account?: string,
): Promise<string> {
  const accountId = account ?? (await acmeId());
  const created = await createForm(db, accountId, { name, config: { version: 1, steps: [] } });
  if (!created.ok) throw new Error(`could not seed form ${name}`);
  await updateFormDestinations(db, accountId, created.value.id, destinations);
  return created.value.id;
}

/** A second tenant, for the isolation assertions. */
async function otherAccount(): Promise<string> {
  await insertAccountWithShortCode(db, { name: 'Other', externalId: 'ext:other' });
  const row = await db.get<{ id: string }>(
    sql`SELECT id FROM account WHERE external_id = ${'ext:other'} LIMIT 1`,
  );
  return String(row!.id);
}

/** A webhook delivery that ended without landing, for `formId`. */
async function seedFailure(
  accountId: string,
  formId: string,
  lastError: string,
  updatedAt = 5_000,
): Promise<void> {
  const id = await enqueueOutbox(db, {
    kind: 'webhook',
    action: 'complete',
    accountId,
    payload: JSON.stringify({ destination: { type: 'webhook' }, ctx: { formId, accountId } }),
    now: 1_000,
  });
  await markOutboxFailed(db, id, { attempts: 5, error: lastError, now: updatedAt });
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db); // account "acme" + owner alex@example.com
  build();
});

afterEach(async () => {
  await db.close();
});

describe('GET /v1/integrations/webhooks', () => {
  it('lists one entry per webhook with the form that owns it', async () => {
    const formId = await seedForm('Lead qualifier', [
      webhook({ url: 'https://acme.io/hook' }, { id: 'w1' }),
    ]);

    const res = await controller.webhooks(asOwner());
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      formId,
      formName: 'Lead qualifier',
      webhookId: 'w1',
      url: 'https://acme.io/hook',
      enabled: true,
      hasSecret: false,
      failures: null,
    });
  });

  it('resolves absent triggers to BOTH phases, and an explicit one to itself', async () => {
    await seedForm('Both', [webhook({ url: 'https://a.test/both' })]);
    await seedForm('Complete only', [
      webhook({ url: 'https://a.test/complete' }, { events: ['complete'] }),
    ]);
    await seedForm('Partial only', [
      webhook({ url: 'https://a.test/partial' }, { events: ['partial'] }),
    ]);

    const byUrl = new Map((await controller.webhooks(asOwner())).items.map((i) => [i.url, i]));
    expect(byUrl.get('https://a.test/both')).toMatchObject({
      firesPartial: true,
      firesComplete: true,
    });
    expect(byUrl.get('https://a.test/complete')).toMatchObject({
      firesPartial: false,
      firesComplete: true,
    });
    expect(byUrl.get('https://a.test/partial')).toMatchObject({
      firesPartial: true,
      firesComplete: false,
    });
  });

  it('joins failed deliveries onto the right form, and reports none as null', async () => {
    const account = await acmeId();
    const broken = await seedForm('Broken', [webhook({ url: 'https://a.test/broken' })]);
    await seedForm('Fine', [webhook({ url: 'https://a.test/fine' })]);
    await seedFailure(account, broken, 'HTTP 502 from https://a.test/broken', 5_000);
    await seedFailure(account, broken, 'older reason', 1_500);

    const byUrl = new Map((await controller.webhooks(asOwner())).items.map((i) => [i.url, i]));
    expect(byUrl.get('https://a.test/broken')?.failures).toEqual({
      count: 2,
      lastError: 'HTTP 502 from https://a.test/broken',
      lastAt: 5_000,
    });
    // Never a "healthy" claim: successful deliveries are not queried at all.
    expect(byUrl.get('https://a.test/fine')?.failures).toBeNull();
  });

  it('reports the same figure on both webhooks of one form', async () => {
    // Attribution is per FORM because that is all the queue records — the payload
    // carries `ctx.formId`, never the destination's id.
    const account = await acmeId();
    const formId = await seedForm('Two hooks', [
      webhook({ url: 'https://a.test/one' }, { id: 'w1' }),
      webhook({ url: 'https://a.test/two' }, { id: 'w2' }),
    ]);
    await seedFailure(account, formId, 'HTTP 500');

    const items = (await controller.webhooks(asOwner())).items;
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.failures?.count === 1)).toBe(true);
  });

  it('never returns another account’s webhooks', async () => {
    await seedForm('Ours', [webhook({ url: 'https://ours.test/hook' })]);
    await seedForm('Theirs', [webhook({ url: 'https://theirs.test/hook' })], await otherAccount());

    const urls = (await controller.webhooks(asOwner())).items.map((i) => i.url);
    expect(urls).toEqual(['https://ours.test/hook']);
  });

  it('is readable by a plain member, like the connections list beside it', async () => {
    await seedForm('Ours', [webhook({ url: 'https://ours.test/hook' })]);
    // Not admin-gated on purpose: a member can already open a form's Connect tab
    // and read the same URL, so gating the inventory would hide nothing.
    const res = await controller.webhooks(asEmail('alex@example.com'));
    expect(res.items).toHaveLength(1);
  });

  it('reports that a secret is set without carrying it, or its mask', async () => {
    const secret = 'super-secret-signing-key';
    await seedForm('Signed', [webhook({ url: 'https://a.test/signed', secret })]);

    const res = await controller.webhooks(asOwner());
    expect(res.items[0]?.hasSecret).toBe(true);
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(WEBHOOK_SECRET_MASK);
  });
});
