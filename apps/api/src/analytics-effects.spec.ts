/**
 * Product analytics, end to end on in-memory SQLite: an event is ENQUEUED as a
 * durable `analytics` outbox row (never inline HTTP) and the worker-side
 * handler POSTs it to the vendor — asserting the off-by-default contract that
 * keeps a bare fork silent, the `forms_` prefix that stops us colliding with
 * the rest of the Dapta estate in a shared project, the account grouping, and
 * retryable vs permanent failure semantics.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, migrate, listOutbox, type Db } from '@quill/db';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import { AnalyticsEffects } from './analytics-effects';
import { AnalyticsCapture } from './analytics-capture';
import { EmailEffects } from './email-effects';
import { DestinationEffects } from './destination-effects';
import { OutboxWorker } from './outbox.worker';

const KEY = 'phc_test_write_key';
const HOST = 'https://analytics.example.com';
const CAPTURE_URL = `${HOST}/capture/`;

let db: Db;

interface RecordedCall {
  url: string;
  body: Record<string, unknown>;
}

/** Env with analytics ON. Cast: the suite only touches the analytics fields. */
function envWith(key: string | undefined, host = HOST) {
  return { PRODUCT_ANALYTICS_KEY: key, PRODUCT_ANALYTICS_HOST: host } as never;
}

function newCapture(env: unknown, calls: RecordedCall[], status = 200): AnalyticsCapture {
  const capture = new AnalyticsCapture(env as never);
  capture.fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response('{"status":1}', { status });
  }) as unknown as typeof fetch;
  return capture;
}

function newWorker(analytics?: AnalyticsCapture) {
  const env = { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5000, NODE_ENV: 'test' } as never;
  const email = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
  return new OutboxWorker(db, env, email, new DestinationEffects(db), undefined, analytics);
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
});

afterEach(() => {
  db.close?.();
});

describe('AnalyticsEffects — enqueue', () => {
  it('enqueues NOTHING when no key is configured (a bare fork stays silent)', async () => {
    const effects = new AnalyticsEffects(db, envWith(undefined));
    expect(effects.enabled).toBe(false);

    await effects.capture('signup_completed', { distinctId: 'a@b.com', accountId: 'acc_1' });

    // Not "a row that fails later" — no row at all, so the queue never fills
    // with undeliverable work on a deployment that does not use analytics.
    expect(await listOutbox(db, { kind: 'analytics' })).toHaveLength(0);
  });

  it('enqueues a durable row and never sends inline', async () => {
    const effects = new AnalyticsEffects(db, envWith(KEY));
    await effects.capture(
      'form_published',
      { distinctId: 'a@b.com', accountId: 'acc_1', properties: { form_id: 'f_1' } },
      1_700_000_000_000,
    );

    const rows = await listOutbox(db, { kind: 'analytics' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
    expect(rows[0]!.accountId).toBe('acc_1');

    const payload = JSON.parse(String(rows[0]!.payload));
    expect(payload.event).toBe('forms_form_published');
    expect(payload.distinctId).toBe('a@b.com');
    expect(payload.properties).toEqual({ form_id: 'f_1' });
    // Enqueue time, so a row drained (or retried) minutes later still reports
    // when the thing actually happened.
    expect(payload.timestamp).toBe(1_700_000_000_000);
  });

  it('carries person properties in the durable row, apart from the event properties', async () => {
    const effects = new AnalyticsEffects(db, envWith(KEY));
    await effects.capture('referral_claimed', {
      distinctId: 'new@b.com',
      accountId: null,
      properties: { source: 'link' },
      personProperties: { referred_by: 'ref_abc', referral_count: 2 },
    });

    const payload = JSON.parse(String((await listOutbox(db, { kind: 'analytics' }))[0]!.payload));
    expect(payload.properties).toEqual({ source: 'link' });
    expect(payload.personProperties).toEqual({ referred_by: 'ref_abc', referral_count: 2 });
  });

  it('writes no person properties key for an event that sets none', async () => {
    const effects = new AnalyticsEffects(db, envWith(KEY));
    await effects.capture('form_created', { distinctId: 'a@b.com', accountId: 'acc_1' });

    const payload = JSON.parse(String((await listOutbox(db, { kind: 'analytics' }))[0]!.payload));
    expect('personProperties' in payload).toBe(false);
  });

  it('prefixes every event name centrally, not at the call site', async () => {
    const effects = new AnalyticsEffects(db, envWith(KEY));
    await effects.capture('activation', { distinctId: 'a@b.com', accountId: 'acc_1' });

    const row = (await listOutbox(db, { kind: 'analytics' }))[0]!;
    // Unprefixed, `activation` would merge with another Dapta product's event
    // of the same name in the shared project.
    expect(row.action).toBe('forms_activation');
  });

  it('never rejects when the enqueue itself fails', async () => {
    const effects = new AnalyticsEffects(db, envWith(KEY));
    db.close?.();

    // Telemetry is an observer of the product, never a participant: a broken
    // analytics write must not surface as a failed user action.
    await expect(
      effects.capture('signup_completed', { distinctId: 'a@b.com', accountId: 'acc_1' }),
    ).resolves.toBeUndefined();
  });
});

describe('AnalyticsCapture — delivery', () => {
  it('POSTs the event with the product tag and the account group', async () => {
    const calls: RecordedCall[] = [];
    await newCapture(envWith(KEY), calls).deliver(
      'forms_activation',
      JSON.stringify({
        event: 'forms_activation',
        distinctId: 'a@b.com',
        accountId: 'acc_1',
        properties: { form_id: 'f_1' },
        timestamp: 1_700_000_000_000,
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(CAPTURE_URL);
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.api_key).toBe(KEY);
    expect(body.event).toBe('forms_activation');
    expect(body.distinct_id).toBe('a@b.com');
    expect(body.timestamp).toBe('2023-11-14T22:13:20.000Z');

    const props = body.properties as Record<string, unknown>;
    expect(props.form_id).toBe('f_1');
    // Separates our telemetry from the rest of the estate in a shared project.
    expect(props.product).toBe('forms');
    // Activation is a property of a WORKSPACE, so it has to be groupable.
    expect(props.$groups).toEqual({ forms_account: 'acc_1' });
  });

  describe('environment', () => {
    async function deliveredProps(publicAppUrl: string | undefined, properties?: Record<string, unknown>) {
      const calls: RecordedCall[] = [];
      const env = { PRODUCT_ANALYTICS_KEY: KEY, PRODUCT_ANALYTICS_HOST: HOST, PUBLIC_APP_URL: publicAppUrl } as never;
      await newCapture(env, calls).deliver(
        'forms_playbook_viewed',
        JSON.stringify({ event: 'forms_playbook_viewed', distinctId: 'a@b.com', accountId: 'acc_1', properties, timestamp: 1 }),
      );
      return calls[0]!.body.properties as Record<string, unknown>;
    }

    it('tags a production host as prd, with the app host', async () => {
      const props = await deliveredProps('https://app.example.com');
      expect(props.environment).toBe('prd');
      expect(props.app_host).toBe('app.example.com');
    });

    it('tags a host with a dev label as dev', async () => {
      const props = await deliveredProps('https://app.dev.example.com');
      expect(props.environment).toBe('dev');
      expect(props.app_host).toBe('app.dev.example.com');
    });

    it('tags a bare clone (no PUBLIC_APP_URL) and localhost as local', async () => {
      const bare = await deliveredProps(undefined);
      expect(bare.environment).toBe('local');
      expect(bare.app_host).toBeUndefined();
      expect((await deliveredProps('')).environment).toBe('local');
      expect((await deliveredProps('http://localhost:3400')).environment).toBe('local');
    });

    it('cannot be overridden by the call site', async () => {
      const props = await deliveredProps('https://app.example.com', { environment: 'local', app_host: 'x' });
      expect(props.environment).toBe('prd');
      expect(props.app_host).toBe('app.example.com');
    });

    it('tags $mcp_* events too', async () => {
      const calls: RecordedCall[] = [];
      const env = { PRODUCT_ANALYTICS_KEY: KEY, PUBLIC_APP_URL: 'https://app.dev.example.com' } as never;
      await newCapture(env, calls).deliver(
        '$mcp_tool_call',
        JSON.stringify({ event: '$mcp_tool_call', distinctId: 'a@b.com', accountId: 'acc_1', timestamp: 1 }),
      );
      expect((calls[0]!.body.properties as Record<string, unknown>).environment).toBe('dev');
    });
  });

  it('sets the email on the person when the distinct id is an email', async () => {
    // MCP, API-key and tracker-blocked users never run the browser identify,
    // so the server event is the only place their person learns its email.
    const calls: RecordedCall[] = [];
    await newCapture(envWith(KEY), calls).deliver(
      'forms_form_created',
      JSON.stringify({ event: 'forms_form_created', distinctId: 'a@b.com', accountId: 'acc_1', timestamp: 1 }),
    );
    expect((calls[0]!.body.properties as Record<string, unknown>).$set).toEqual({ email: 'a@b.com' });
  });

  it('sets person properties on the person, next to the email the distinct id gives', async () => {
    const calls: RecordedCall[] = [];
    await newCapture(envWith(KEY), calls).deliver(
      'forms_referral_claimed',
      JSON.stringify({
        event: 'forms_referral_claimed',
        distinctId: 'new@b.com',
        accountId: null,
        properties: { source: 'link' },
        // A stray `email` here must not repoint the person at another address.
        personProperties: { referred_by: 'ref_abc', referral_count: 2, email: 'other@b.com' },
        timestamp: 1,
      }),
    );

    const props = calls[0]!.body.properties as Record<string, unknown>;
    expect(props.$set).toEqual({ referred_by: 'ref_abc', referral_count: 2, email: 'new@b.com' });
    // Person properties stay off the event itself.
    expect(props.referred_by).toBeUndefined();
    expect(props.source).toBe('link');
  });

  it('sets person properties for an account id, with no email', async () => {
    const calls: RecordedCall[] = [];
    await newCapture(envWith(KEY), calls).deliver(
      'forms_referral_claimed',
      JSON.stringify({
        event: 'forms_referral_claimed',
        distinctId: 'account:acc_1',
        accountId: 'acc_1',
        personProperties: { referral_code: 'ref_abc' },
        timestamp: 1,
      }),
    );
    expect((calls[0]!.body.properties as Record<string, unknown>).$set).toEqual({
      referral_code: 'ref_abc',
    });
  });

  it('sets no person properties on a profile-less event', async () => {
    // A profile-less event must not mint or touch a person.
    const calls: RecordedCall[] = [];
    await newCapture(envWith(KEY), calls).deliver(
      '$mcp_tool_call',
      JSON.stringify({
        event: '$mcp_tool_call',
        distinctId: 'a@b.com',
        accountId: 'acc_1',
        properties: { $process_person_profile: false },
        personProperties: { referral_code: 'ref_abc' },
        timestamp: 1,
      }),
    );
    expect((calls[0]!.body.properties as Record<string, unknown>).$set).toBeUndefined();
  });

  it('sets no email for account ids or profile-less events', async () => {
    const calls: RecordedCall[] = [];
    const capture = newCapture(envWith(KEY), calls);
    await capture.deliver(
      'forms_link_page_viewed',
      JSON.stringify({ event: 'forms_link_page_viewed', distinctId: 'account:acc_1', accountId: 'acc_1', timestamp: 1 }),
    );
    await capture.deliver(
      '$mcp_tool_call',
      JSON.stringify({
        event: '$mcp_tool_call',
        distinctId: 'a@b.com',
        accountId: 'acc_1',
        properties: { $process_person_profile: false },
        timestamp: 1,
      }),
    );
    for (const c of calls) {
      expect((c.body.properties as Record<string, unknown>).$set).toBeUndefined();
    }
  });

  it('omits the group when the event has no account', async () => {
    const calls: RecordedCall[] = [];
    await newCapture(envWith(KEY), calls).deliver(
      'forms_signup_completed',
      JSON.stringify({
        event: 'forms_signup_completed',
        distinctId: 'a@b.com',
        accountId: null,
        timestamp: 1_700_000_000_000,
      }),
    );

    expect((calls[0]!.body.properties as Record<string, unknown>).$groups).toBeUndefined();
  });

  it('SKIPS (never retries) when no key is configured', async () => {
    const calls: RecordedCall[] = [];
    const capture = newCapture(envWith(undefined), calls);

    await expect(
      capture.deliver('forms_activation', JSON.stringify({ event: 'forms_activation' })),
    ).rejects.toThrow(/not configured/);
    expect(calls).toHaveLength(0);
  });

  it('sends the event uuid when the payload carries one, so a retried row counts once', async () => {
    const calls: RecordedCall[] = [];
    const uuid = '0b9f5c1e-3a4d-4f6b-9c2d-8e7f6a5b4c3d';
    await newCapture(envWith(KEY), calls).deliver(
      'forms_response_completed',
      JSON.stringify({ event: 'forms_response_completed', distinctId: 'response:x', uuid, accountId: 'acc_1', timestamp: 1 }),
    );
    expect(calls[0]!.body.uuid).toBe(uuid);
  });

  it('sends no uuid when the payload has none (every other event)', async () => {
    const calls: RecordedCall[] = [];
    await newCapture(envWith(KEY), calls).deliver(
      'forms_activation',
      JSON.stringify({ event: 'forms_activation', distinctId: 'a@b.com', accountId: 'acc_1', timestamp: 1 }),
    );
    expect(calls[0]!.body).not.toHaveProperty('uuid');
  });

  it('SKIPS on a 4xx — the vendor will reject it identically forever', async () => {
    const calls: RecordedCall[] = [];
    const capture = newCapture(envWith(KEY), calls, 400);

    await expect(
      capture.deliver(
        'forms_activation',
        JSON.stringify({ event: 'forms_activation', distinctId: 'a@b.com', timestamp: 0 }),
      ),
    ).rejects.toThrow(/rejected/);
  });

  it('THROWS on a 5xx so the worker retries with backoff', async () => {
    const calls: RecordedCall[] = [];
    const capture = newCapture(envWith(KEY), calls, 503);

    await expect(
      capture.deliver(
        'forms_activation',
        JSON.stringify({ event: 'forms_activation', distinctId: 'a@b.com', timestamp: 0 }),
      ),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe('OutboxWorker — analytics rows', () => {
  it('drains an enqueued event through to the vendor', async () => {
    await new AnalyticsEffects(db, envWith(KEY)).capture('form_created', {
      distinctId: 'a@b.com',
      accountId: 'acc_1',
    });

    const calls: RecordedCall[] = [];
    await newWorker(newCapture(envWith(KEY), calls)).drainOnce();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.event).toBe('forms_form_created');
    const row = (await listOutbox(db, { kind: 'analytics' }))[0]!;
    expect(row.status).toBe('done');
  });

  it('skips analytics rows when no handler is wired, instead of failing them', async () => {
    await new AnalyticsEffects(db, envWith(KEY)).capture('form_created', {
      distinctId: 'a@b.com',
      accountId: 'acc_1',
    });

    // A deployment that does not do product analytics must not accumulate
    // permanent failures in a queue it shares with emails and CRM deliveries.
    await newWorker(undefined).drainOnce();

    const row = (await listOutbox(db, { kind: 'analytics' }))[0]!;
    expect(row.status).toBe('skipped');
    expect(row.lastError).toMatch(/not wired/);
  });
});
