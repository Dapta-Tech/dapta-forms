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
import { DestinationEffects, type SubmissionDeliveryInput } from './destination-effects';
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
    expect(got.headers['x-forms-signature']).toBe(signWebhookBody(got.body, 'shh'));
    const payload = JSON.parse(got.body);
    expect(payload.submission.id).toBe((out as { id: string }).id);
    expect(payload.submission.score).toBe(18);
  });
});

describe('per-event trigger filter (enqueue-time)', () => {
  // The per-event decision lives in `enqueueSubmissionDeliveries`, so we drive it
  // directly for a given phase (mirrors the UTM test above) and assert which
  // outbox rows land. Distinct submissionIds keep each phase's rows isolated.
  function deliveryInput(
    phase: 'partial' | 'complete',
    submissionId: string,
    destinationsConfig: unknown[],
  ): SubmissionDeliveryInput {
    return {
      formId: 'form-1',
      formName: 'F',
      accountId: 'acc-1',
      submissionId,
      sessionId: `sess-${submissionId}`,
      score: 0,
      outcomeLabel: null,
      phase,
      submittedAt: Date.now(),
      data: { email: 'lead@acme.io' },
      config: { version: 1, steps: [], destinations: destinationsConfig },
    };
  }

  it("events:['complete'] enqueues on complete but NOT on partial", async () => {
    const dest = {
      type: 'webhook',
      enabled: true,
      events: ['complete'],
      settings: { url: 'https://acme.io/hook' },
    };

    await destinations.enqueueSubmissionDeliveries(deliveryInput('partial', 'sub-c-partial', [dest]));
    expect(await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-c-partial' })).toHaveLength(0);

    await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', 'sub-c-complete', [dest]));
    const rows = await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-c-complete' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('complete');
  });

  it("events:['partial'] enqueues on partial but NOT on complete", async () => {
    const dest = {
      type: 'webhook',
      enabled: true,
      events: ['partial'],
      settings: { url: 'https://acme.io/hook' },
    };

    await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', 'sub-p-complete', [dest]));
    expect(await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-p-complete' })).toHaveLength(0);

    await destinations.enqueueSubmissionDeliveries(deliveryInput('partial', 'sub-p-partial', [dest]));
    const rows = await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-p-partial' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('partial');
  });

  it('no events field enqueues on BOTH phases (back-compat)', async () => {
    const dest = { type: 'webhook', enabled: true, settings: { url: 'https://acme.io/hook' } };

    await destinations.enqueueSubmissionDeliveries(deliveryInput('partial', 'sub-both-partial', [dest]));
    expect(await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-both-partial' })).toHaveLength(1);

    await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', 'sub-both-complete', [dest]));
    expect(await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-both-complete' })).toHaveLength(1);
  });

  it('an EMPTY events array enqueues on BOTH phases (empty = unfiltered)', async () => {
    const dest = {
      type: 'webhook',
      enabled: true,
      events: [],
      settings: { url: 'https://acme.io/hook' },
    };

    await destinations.enqueueSubmissionDeliveries(deliveryInput('partial', 'sub-empty-partial', [dest]));
    expect(await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-empty-partial' })).toHaveLength(1);

    await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', 'sub-empty-complete', [dest]));
    expect(await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-empty-complete' })).toHaveLength(1);
  });

  it('a HubSpot destination (no events filter) is unaffected — enqueues on both phases', async () => {
    const dest = { type: 'hubspot', enabled: true };

    await destinations.enqueueSubmissionDeliveries(deliveryInput('partial', 'sub-hs-partial', [dest]));
    expect(await listOutbox(db, { kind: 'hubspot', subjectUid: 'sub-hs-partial' })).toHaveLength(1);

    await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', 'sub-hs-complete', [dest]));
    expect(await listOutbox(db, { kind: 'hubspot', subjectUid: 'sub-hs-complete' })).toHaveLength(1);
  });

  it('filters per-destination within one submission: a complete-only webhook is skipped on partial while HubSpot still fires', async () => {
    const config = [
      { type: 'webhook', enabled: true, events: ['complete'], settings: { url: 'https://acme.io/hook' } },
      { type: 'hubspot', enabled: true },
    ];

    await destinations.enqueueSubmissionDeliveries(deliveryInput('partial', 'sub-mix', config));
    expect(await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-mix' })).toHaveLength(0);
    expect(await listOutbox(db, { kind: 'hubspot', subjectUid: 'sub-mix' })).toHaveLength(1);
  });
});

/**
 * The page a submission was answered on (#199) rides the outbox snapshot, so
 * every attempt of one delivery sends the same visit, and a row enqueued before
 * the visit existed still delivers exactly what it always did.
 */
describe('the visit in the outbox', () => {
  const VISIT = {
    pageUri: 'https://landing.example.com/offer?utm_source=fb',
    pageName: 'Home insurance',
    hutk: '0123456789abcdef0123456789abcdef',
    embedded: true,
  };

  function input(submissionId: string, visit?: typeof VISIT): SubmissionDeliveryInput {
    return {
      formId: 'form-1',
      formName: 'F',
      accountId: 'acc-1',
      submissionId,
      sessionId: `sess-${submissionId}`,
      score: 0,
      outcomeLabel: null,
      phase: 'complete',
      submittedAt: 1_800_000_000_000,
      data: { email: 'lead@acme.io' },
      config: { version: 1, steps: [], destinations: [{ type: 'webhook', enabled: true, settings: { url: 'https://acme.io/hook' } }] },
      ...(visit ? { visit } : {}),
    };
  }

  function drainingWorker(statuses: number[]) {
    const bodies: string[] = [];
    destinations.fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(init.body as string);
      return new Response('{}', { status: statuses.shift() ?? 200 });
    }) as unknown as typeof fetch;
    const env = { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5000, NODE_ENV: 'test' } as never;
    const email = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
    return { bodies, worker: new OutboxWorker(db, env, email, destinations) };
  }

  it('snapshots the visit, so a retried delivery sends the very same body', async () => {
    await destinations.enqueueSubmissionDeliveries(input('sub-visit', VISIT));
    const [row] = await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-visit' });
    expect((JSON.parse(row!.payload!) as { ctx: { visit: unknown } }).ctx.visit).toEqual(VISIT);

    const { bodies, worker } = drainingWorker([503, 200]);
    await worker.drainOnce();
    // The backoff put the retry in the future; bring it forward.
    await db.run(sql`UPDATE outbox SET next_attempt_at = 0 WHERE subject_uid = ${'sub-visit'}`);
    await worker.drainOnce();

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[0]!).visit).toEqual({
      pageUri: VISIT.pageUri,
      pageName: VISIT.pageName,
      embedded: true,
      hutk: VISIT.hutk,
    });
    expect((await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-visit' }))[0]!.status).toBe('done');
  });

  it('snapshots the cookie only for a destination that uses it', async () => {
    const base = input('sub-min', VISIT);
    await destinations.enqueueSubmissionDeliveries({
      ...base,
      config: {
        version: 1,
        steps: [],
        destinations: [
          { type: 'webhook', enabled: true, settings: { url: 'https://acme.io/hook' } },
          { type: 'hubspot', enabled: true, settings: {} },
        ],
      },
    });
    const ctxOf = async (kind: 'webhook' | 'hubspot') =>
      (JSON.parse((await listOutbox(db, { kind, subjectUid: 'sub-min' }))[0]!.payload!) as { ctx: { visit: unknown } })
        .ctx.visit;
    expect(await ctxOf('webhook')).toEqual(VISIT);
    // HubSpot without its form submission never sends the cookie: it keeps the page only.
    const { hutk: _cookie, ...pageOnly } = VISIT;
    expect(await ctxOf('hubspot')).toEqual(pageOnly);

    await destinations.enqueueSubmissionDeliveries({
      ...input('sub-mirror', VISIT),
      config: {
        version: 1,
        steps: [],
        destinations: [{ type: 'hubspot', enabled: true, settings: { formActivity: true, formGuid: 'guid-1' } }],
      },
    });
    const [mirrorRow] = await listOutbox(db, { kind: 'hubspot', subjectUid: 'sub-mirror' });
    expect((JSON.parse(mirrorRow!.payload!) as { ctx: { visit: unknown } }).ctx.visit).toEqual(VISIT);
  });

  it('snapshots the cookie only for the phase a destination sends it in', async () => {
    const { hutk: _cookie, ...pageOnly } = VISIT;
    const config = {
      version: 1,
      steps: [],
      destinations: [
        { type: 'webhook', enabled: true, settings: { url: 'https://acme.io/hook' } },
        { type: 'hubspot', enabled: true, settings: { formActivity: true, formGuid: 'guid-1' } },
      ],
    };
    const visitOf = async (kind: 'webhook' | 'hubspot', subjectUid: string) =>
      (JSON.parse((await listOutbox(db, { kind, subjectUid }))[0]!.payload!) as { ctx: { visit: unknown } }).ctx.visit;

    // A partial never posts the form submission, the one HubSpot call that
    // takes the cookie, so HubSpot's partial snapshot keeps the page alone.
    await destinations.enqueueSubmissionDeliveries({ ...input('sub-phase-partial', VISIT), phase: 'partial', config });
    expect(await visitOf('hubspot', 'sub-phase-partial')).toEqual(pageOnly);
    // A webhook sends the visit in every phase it fires for.
    expect(await visitOf('webhook', 'sub-phase-partial')).toEqual(VISIT);

    await destinations.enqueueSubmissionDeliveries({ ...input('sub-phase-complete', VISIT), config });
    expect(await visitOf('hubspot', 'sub-phase-complete')).toEqual(VISIT);
    expect(await visitOf('webhook', 'sub-phase-complete')).toEqual(VISIT);
  });

  it('delivers a row enqueued before the visit existed exactly as before: no visit key at all', async () => {
    await destinations.enqueueSubmissionDeliveries(input('sub-legacy'));
    const [row] = await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-legacy' });
    expect(JSON.parse(row!.payload!).ctx).not.toHaveProperty('visit');

    const { bodies, worker } = drainingWorker([200]);
    await worker.drainOnce();
    expect(Object.keys(JSON.parse(bodies[0]!))).toEqual(['id', 'type', 'phase', 'submittedAt', 'form', 'submission', 'data', 'utm']);
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
