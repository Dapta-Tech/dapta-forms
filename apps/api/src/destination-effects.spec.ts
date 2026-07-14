/**
 * Destinations end-to-end on in-memory SQLite: a submission to a form with an
 * enabled webhook destination enqueues an outbox row (persist-first, never
 * blocking submit), and the outbox worker drains it pending→done, POSTing the
 * signed payload. Also asserts the public form NEVER leaks destination config.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createDb,
  migrate,
  seed,
  listOutbox,
  updateForm,
  getAccountByCode,
  listForms,
  sql,
  type Db,
} from '@quill/db';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import { signWebhookBody } from '@quill/destinations';
import { SubmissionService } from './submission.service';
import { EmailEffects } from './email-effects';
import { DestinationEffects } from './destination-effects';
import { OutboxWorker } from './outbox.worker';

let db: Db;
let svc: SubmissionService;
let destinations: DestinationEffects;

async function addWebhookDestination(secret?: string) {
  const account = await getAccountByCode(db, 'acme');
  const forms = await listForms(db, account!.id);
  const form = forms.find((f) => f.slug === 'lead-qualifier')!;
  const full = await db.get<{ config: string }>(sql`SELECT config FROM form WHERE id = ${form.id}`);
  const config = JSON.parse(full!.config);
  config.destinations = [
    {
      type: 'webhook',
      enabled: true,
      settings: { url: 'https://acme.io/hook', secret },
    },
  ];
  await updateForm(db, account!.id, form.id, { config });
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  const email = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
  destinations = new DestinationEffects(db);
  // Keep the webhook SSRF guard off real DNS: map every host to a public IP.
  destinations.resolveDns = async () => ['93.184.216.34'];
  svc = new SubmissionService(db, email, destinations);
});

afterEach(async () => {
  await db.close();
});

describe('destination enqueue on submission', () => {
  it('enqueues a pending webhook outbox row on a completed submission', async () => {
    await addWebhookDestination('shh');
    const out = await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-1',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    expect('error' in out).toBe(false);

    const rows = await listOutbox(db, { kind: 'webhook' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
    expect(rows[0]!.action).toBe('complete');
    expect(rows[0]!.subjectUid).toBe((out as { id: string }).id);
  });

  it('TWO destinations of the SAME type both enqueue and both deliver (per-destination identity)', async () => {
    const account = await getAccountByCode(db, 'acme');
    const forms = await listForms(db, account!.id);
    const form = forms.find((f) => f.slug === 'lead-qualifier')!;
    const full = await db.get<{ config: string }>(sql`SELECT config FROM form WHERE id = ${form.id}`);
    const config = JSON.parse(full!.config);
    config.destinations = [
      { type: 'webhook', enabled: true, settings: { url: 'https://first.example/hook' } },
      { type: 'webhook', enabled: true, settings: { url: 'https://second.example/hook' } },
    ];
    await updateForm(db, account!.id, form.id, { config });

    const out = await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-two',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    expect('error' in out).toBe(false);

    // Both rows survive enqueue (the per-loop delete used to cancel the first).
    const rows = await listOutbox(db, { kind: 'webhook' });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
    // Distinct per-destination idempotency keys (type alone is not an identity).
    const keys = rows.map(
      (r) => (JSON.parse(r.payload!) as { ctx: { idempotencyKey: string } }).ctx.idempotencyKey,
    );
    expect(new Set(keys).size).toBe(2);

    // Drain: BOTH endpoints receive their delivery.
    const urls: string[] = [];
    destinations.fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const env = { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5000, NODE_ENV: 'test' } as never;
    const email = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
    const worker = new OutboxWorker(db, env, email, destinations);
    await worker.drainOnce();

    expect(urls.sort()).toEqual(['https://first.example/hook', 'https://second.example/hook']);
    const after = await listOutbox(db, { kind: 'webhook' });
    expect(after.every((r) => r.status === 'done')).toBe(true);
  });

  it('extracts UTM from the NESTED data.utm object (renderer convention, PR #4), flat utm_* only as fallback', async () => {
    // Exercised at the effects level: the renderer POSTs `data.utm` as an object;
    // the widened submission union ships with the renderer track.
    await destinations.enqueueSubmissionDeliveries({
      formId: 'form-1',
      formName: 'F',
      accountId: 'acc-1',
      submissionId: 'sub-utm',
      sessionId: 's-utm',
      score: 0,
      outcomeLabel: null,
      phase: 'complete',
      submittedAt: Date.now(),
      data: {
        email: 'a@b.io',
        // Nested convention (primary) …
        utm: { utm_source: 'google', utm_medium: 'cpc' },
        // … flat fallback: fills a gap, but NEVER overrides a nested value.
        utm_source: 'flat-should-lose',
        utm_campaign: 'q1-flat',
      },
      config: {
        version: 1,
        steps: [],
        destinations: [{ type: 'webhook', enabled: true, settings: { url: 'https://x.io/h' } }],
      },
    });
    const rows = await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-utm' });
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0]!.payload!) as { ctx: { utm: Record<string, string> } };
    expect(payload.ctx.utm).toEqual({
      utm_source: 'google', // nested wins over the flat clash
      utm_medium: 'cpc',
      utm_campaign: 'q1-flat', // flat fills the gap
    });
  });

  it('does not enqueue a disabled destination', async () => {
    const account = await getAccountByCode(db, 'acme');
    const forms = await listForms(db, account!.id);
    const form = forms.find((f) => f.slug === 'lead-qualifier')!;
    const full = await db.get<{ config: string }>(sql`SELECT config FROM form WHERE id = ${form.id}`);
    const config = JSON.parse(full!.config);
    config.destinations = [{ type: 'webhook', enabled: false, settings: { url: 'https://x.io/h' } }];
    await updateForm(db, account!.id, form.id, { config });

    await svc.submit('acme', 'lead-qualifier', { sessionId: 's', data: { email: 'a@b.io' } });
    expect(await listOutbox(db, { kind: 'webhook' })).toHaveLength(0);
  });

  it('drains the webhook row pending→done and POSTs a validly-signed payload', async () => {
    await addWebhookDestination('shh');
    const out = await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-2',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });

    let received: { url: string; headers: Record<string, string>; body: string } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      received = {
        url,
        headers: init.headers as Record<string, string>,
        body: init.body as string,
      };
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    destinations.fetchImpl = fetchImpl;
    const env = { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5000, NODE_ENV: 'test' } as never;
    const email = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
    const worker = new OutboxWorker(db, env, email, destinations);

    const processed = await worker.drainOnce();
    expect(processed).toBeGreaterThanOrEqual(1);

    const rows = await listOutbox(db, { kind: 'webhook' });
    expect(rows[0]!.status).toBe('done');

    expect(received).not.toBeNull();
    const got = received!;
    expect(got.url).toBe('https://acme.io/hook');
    // The signature validates against the exact body delivered.
    expect(got.headers['x-quill-signature']).toBe(signWebhookBody(got.body, 'shh'));
    const payload = JSON.parse(got.body);
    expect(payload.submission.id).toBe((out as { id: string }).id);
    expect(payload.submission.score).toBe(18);
  });
});

describe('public form config', () => {
  it('never leaks destination config to the public renderer', async () => {
    await addWebhookDestination('shh');
    const publicForm = await svc.publicForm('acme', 'lead-qualifier');
    expect(publicForm).not.toBeNull();
    expect((publicForm!.config as Record<string, unknown>).destinations).toBeUndefined();
    // But the steps the renderer needs are still there.
    expect(publicForm!.config.steps.length).toBeGreaterThan(0);
  });
});
