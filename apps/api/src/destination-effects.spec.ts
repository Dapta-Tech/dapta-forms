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
  claimDueOutbox,
  claimIdentityOf,
  enqueueOutbox,
  listOutbox,
  markOutboxRetry,
  updateForm,
  getAccountByCode,
  listForms,
  sql,
  type Db,
} from '@quill/db';
import { destinationType } from '@quill/types';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import { signWebhookBody } from '@quill/destinations';
import { SubmissionService } from './submission.service';
import { EmailEffects, OutboxSkipError } from './email-effects';
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

/** The delivery a queued row names, as its payload records it. */
function keyOf(payload: string | null): string | null {
  if (!payload) return null;
  try {
    return (JSON.parse(payload) as { ctx?: { idempotencyKey?: string } }).ctx?.idempotencyKey ?? null;
  } catch {
    return null;
  }
}

/**
 * Pin a row's position in the queue's own ordering.
 *
 * Two passes of one session routinely land in the same millisecond, and the
 * newest-row rule falls back to the row id on a tie, which is a random UUID.
 * Stamping `created_at` is what makes a test about ORDER assert the order it
 * means rather than whichever id sorted higher.
 */
const stampCreatedAt = (id: string, at: number) =>
  db.run(sql`UPDATE outbox SET created_at = ${at} WHERE id = ${id}`);

/** Hand a row to a worker without racing a real claim for it. */
const holdRow = (id: string, by = 'W#held') =>
  db.run(sql`UPDATE outbox SET claimed_at = ${Date.now()}, claimed_by = ${by} WHERE id = ${id}`);

/** Hold a row on a lease old enough for a drain to reclaim it (a crashed worker). */
const holdStale = (id: string) =>
  db.run(
    sql`UPDATE outbox SET claimed_at = ${Date.now() - 10 * 60_000}, claimed_by = 'W#crashed'
        WHERE id = ${id}`,
  );

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

/**
 * Re-enqueue reconsideration: which of the previous pass's rows a re-submit of
 * the same session and phase is allowed to take back.
 *
 * The cancellation pass used to be driven by the destinations that fire on THIS
 * pass, which is the one set that cannot describe what the PREVIOUS pass left
 * behind. Turn a webhook off, delete it, or narrow its `events` between two
 * submits of the same session and its kind vanishes from the pass, so the row
 * enqueued under the old config is never reconsidered and delivers on a
 * configuration nobody has any more. The set has to come from the destination
 * contract itself, not from whatever happens to be enabled today.
 */
describe('re-enqueue reconsideration across a config change', () => {
  const WEBHOOK = { type: 'webhook', enabled: true, settings: { url: 'https://acme.io/hook' } };

  function deliveryInput(
    phase: 'partial' | 'complete',
    submissionId: string,
    destinationsConfig: unknown[],
    data: Record<string, unknown> = { email: 'lead@acme.io' },
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
      data,
      config: { version: 1, steps: [], destinations: destinationsConfig },
    };
  }

  const rowsFor = (subjectUid: string, kind: 'webhook' | 'hubspot' = 'webhook') =>
    listOutbox(db, { kind, subjectUid });

  it('cancels an unstarted delivery whose destination has since been DISABLED', async () => {
    await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', 'sub-dis', [WEBHOOK]));
    expect(await rowsFor('sub-dis')).toHaveLength(1);

    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('complete', 'sub-dis', [{ ...WEBHOOK, enabled: false }]),
    );

    expect(await rowsFor('sub-dis')).toHaveLength(0);
  });

  it('cancels an unstarted delivery whose destination has since been REMOVED', async () => {
    await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', 'sub-rm', [WEBHOOK]));
    expect(await rowsFor('sub-rm')).toHaveLength(1);

    await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', 'sub-rm', []));

    expect(await rowsFor('sub-rm')).toHaveLength(0);
  });

  it('cancels an unstarted delivery whose destination no longer fires for this PHASE', async () => {
    await destinations.enqueueSubmissionDeliveries(deliveryInput('partial', 'sub-phase', [WEBHOOK]));
    expect(await rowsFor('sub-phase')).toHaveLength(1);

    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('partial', 'sub-phase', [{ ...WEBHOOK, events: ['complete'] }]),
    );

    expect(await rowsFor('sub-phase')).toHaveLength(0);
  });

  it('cancels a disabled HUBSPOT delivery too, not just webhooks', async () => {
    const hubspot = { type: 'hubspot', enabled: true };
    await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', 'sub-hs', [hubspot]));
    expect(await rowsFor('sub-hs', 'hubspot')).toHaveLength(1);

    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('complete', 'sub-hs', [{ ...hubspot, enabled: false }]),
    );

    expect(await rowsFor('sub-hs', 'hubspot')).toHaveLength(0);
  });

  // Derived from the destination contract, so a new destination kind is
  // reconsidered the moment it is added there rather than whenever somebody
  // remembers to widen a list in this app.
  it.each([...destinationType])(
    'reconsiders %s, every kind the destination contract names, with nothing configured at all',
    async (kind) => {
      const subjectUid = `sub-all-${kind}`;
      await enqueueOutbox(db, {
        kind,
        action: 'complete',
        subjectUid,
        accountId: 'acc-1',
        payload: '{}',
      });
      expect(await rowsFor(subjectUid, kind)).toHaveLength(1);

      await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', subjectUid, []));

      expect(await rowsFor(subjectUid, kind)).toHaveLength(0);
    },
  );

  it('leaves a CLAIMED delivery to the retry lifecycle, even once the destination is disabled', async () => {
    // Settings win over a queue entry only until the entry has been handed off.
    // After that the row may already have crossed the wire, and it is the only
    // record that it did.
    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('complete', 'sub-owned', [WEBHOOK]),
    );
    const [queued] = await rowsFor('sub-owned');
    const claimed = (await claimDueOutbox(db, Date.now(), { workerId: 'W' })).find(
      (r) => r.id === queued!.id,
    );
    expect(claimed).toBeDefined();

    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('complete', 'sub-owned', [{ ...WEBHOOK, enabled: false }]),
    );

    const after = await rowsFor('sub-owned');
    expect(after).toHaveLength(1);
    expect(after[0]!.claimedBy).toBe(claimed!.claimedBy);
  });

  it('queues the newer delivery BESIDE the one a worker is already making', async () => {
    // The in-flight row cannot be cancelled, and the answers this pass carries
    // are the ones the respondent actually left, so neither may be dropped.
    // Both are queued; which of them is still worth sending is decided at
    // delivery time, when the row is about to cross the wire.
    await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', 'sub-dup', [WEBHOOK]));
    const [queued] = await rowsFor('sub-dup');
    const claimed = (await claimDueOutbox(db, Date.now(), { workerId: 'W' })).find(
      (r) => r.id === queued!.id,
    );
    expect(claimed).toBeDefined();

    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('complete', 'sub-dup', [WEBHOOK], { email: 'moved@acme.io' }),
    );

    const rows = await rowsFor('sub-dup');
    expect(rows).toHaveLength(2);
    // The handed-off row is untouched down to its claim...
    expect(rows.find((r) => r.id === claimed!.id)).toMatchObject({
      status: 'pending',
      claimedAt: claimed!.claimedAt,
      claimedBy: claimed!.claimedBy,
    });
    // ...and the newer answers are queued under their own key.
    const fresh = rows.find((r) => r.id !== claimed!.id)!;
    expect(fresh).toMatchObject({ status: 'pending', attempts: 0, claimedAt: null });
    expect(keyOf(fresh.payload)).not.toBe(keyOf(rows.find((r) => r.id === claimed!.id)!.payload));
    // Named by payload, not counted: the surviving unstarted row is the one
    // carrying THIS pass's answers, and the held row still carries the first's.
    expect(JSON.parse(fresh.payload!).ctx.data).toEqual({ email: 'moved@acme.io' });
    expect(JSON.parse(rows.find((r) => r.id === claimed!.id)!.payload!).ctx.data).toEqual({
      email: 'lead@acme.io',
    });
  });

  it('never lets one destination displace a same-kind sibling', async () => {
    // Two webhooks on one form are two different deliveries. The pass treats
    // them independently: neither one being queued, held or replaced has any
    // bearing on the other.
    const two = [
      { ...WEBHOOK, settings: { url: 'https://first.example/hook' } },
      { ...WEBHOOK, settings: { url: 'https://second.example/hook' } },
    ];
    await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', 'sub-sib', two));
    const before = await rowsFor('sub-sib');
    expect(before).toHaveLength(2);
    // Exactly ONE of the two is in a worker's hands.
    const held = before[0]!;
    await holdRow(held.id);

    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('complete', 'sub-sib', two, { email: 'moved@acme.io' }),
    );

    const after = await rowsFor('sub-sib');
    // The held row survived, the unstarted sibling was replaced, and both
    // destinations are queued again under the new answers.
    expect(after).toHaveLength(3);
    expect(after.find((r) => r.id === held.id)).toMatchObject({ claimedBy: 'W#held' });
    expect(after.filter((r) => r.claimedAt === null)).toHaveLength(2);
    expect(new Set(after.map((r) => keyOf(r.payload))).size).toBe(3);
  });

  it('leaves at most one in-flight row and one unstarted row however often the session re-submits', async () => {
    await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', 'sub-rep', [WEBHOOK]));
    const [first] = await rowsFor('sub-rep');
    await claimDueOutbox(db, Date.now(), { workerId: 'W' });

    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('complete', 'sub-rep', [WEBHOOK], { email: 'second@acme.io' }),
    );
    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('complete', 'sub-rep', [WEBHOOK], { email: 'third@acme.io' }),
    );

    const rows = await rowsFor('sub-rep');
    // Every pass after the first deletes the unstarted row the one before it
    // left, so re-submitting cannot grow the queue without bound: the held row,
    // plus the latest answers, and nothing else.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toContain(first!.id);
    const live = rows.filter((r) => r.claimedAt === null);
    expect(live).toHaveLength(1);
    // And the row still queued carries the LATEST answers, not the first pass's.
    expect(JSON.parse(live[0]!.payload!).ctx.data).toEqual({ email: 'third@acme.io' });
  });

  it('still replaces an unstarted row rather than doubling it when the destination stays enabled', async () => {
    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('complete', 'sub-again', [WEBHOOK]),
    );
    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('complete', 'sub-again', [WEBHOOK]),
    );
    expect(await rowsFor('sub-again')).toHaveLength(1);
  });
});

/**
 * Superseding work that was already attempted.
 *
 * A row in retry backoff carries a frozen snapshot of the config and answers it
 * was built from. Once the same session and phase come round again that
 * snapshot is stale, so every retry still on its schedule is a scheduled
 * delivery of content the form has already replaced, and a destination the
 * author switched off keeps retrying until it burns through `max_attempts`.
 * The pass settles those rows instead of leaving them due.
 */
describe('superseding a delivery that is waiting out its retry backoff', () => {
  const WEBHOOK = { type: 'webhook', enabled: true, settings: { url: 'https://acme.io/hook' } };

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

  const rowsFor = (subjectUid: string) => listOutbox(db, { kind: 'webhook', subjectUid });

  /** Enqueue one webhook delivery and drive it into retry backoff. */
  async function intoBackoff(subjectUid: string): Promise<string> {
    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('complete', subjectUid, [WEBHOOK]),
    );
    const [row] = await rowsFor(subjectUid);
    const claimed = (await claimDueOutbox(db, Date.now(), { workerId: 'W' })).find(
      (r) => r.id === row!.id,
    );
    expect(
      await markOutboxRetry(
        db,
        row!.id,
        {
          attempts: 2,
          error: 'HTTP 502 from https://acme.io/hook',
          transcript: { requestBody: '{"a":1}', responseStatus: 502, responseBody: 'bad gateway' },
        },
        claimIdentityOf(claimed!),
      ),
    ).toBe(true);
    return row!.id;
  }

  it('settles the stale attempt and queues the replacement beside it', async () => {
    const stale = await intoBackoff('sub-bo');

    await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', 'sub-bo', [WEBHOOK]));

    const rows = await rowsFor('sub-bo');
    expect(rows).toHaveLength(2);
    // The superseded attempt keeps everything it learned, and stops being due.
    expect(rows.find((r) => r.id === stale)).toMatchObject({
      status: 'skipped',
      attempts: 2,
      responseStatus: 502,
      responseBody: 'bad gateway',
    });
    // Only the status moves. The row still reads back as the failure it was,
    // which is what an admin opening the delivery log is looking for; the
    // supersession is not an event of its own and does not overwrite one.
    expect(rows.find((r) => r.id === stale)!.lastError).toBe('HTTP 502 from https://acme.io/hook');
    // The replacement is a fresh, never-handed-off row.
    expect(rows.find((r) => r.id !== stale)).toMatchObject({
      status: 'pending',
      attempts: 0,
      claimedAt: null,
    });
  });

  it('stops a WITHDRAWN destination from retrying, and the worker never calls it again', async () => {
    const stale = await intoBackoff('sub-wd');

    // The author disables the webhook, then the session is submitted again.
    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('complete', 'sub-wd', [{ ...WEBHOOK, enabled: false }]),
    );

    const rows = await rowsFor('sub-wd');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: stale, status: 'skipped', attempts: 2 });

    // Nothing is due any more, so a drain long after the backoff has elapsed
    // reaches no endpoint at all.
    let called = 0;
    destinations.fetchImpl = (async () => {
      called += 1;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const env = { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5000, NODE_ENV: 'test' } as never;
    const email = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
    await new OutboxWorker(db, env, email, destinations).drainOnce();

    expect(called).toBe(0);
    expect((await rowsFor('sub-wd'))[0]!.status).toBe('skipped');
  });

  it('leaves a claimed row out of the settlement: it is not waiting, it is running', async () => {
    await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', 'sub-run', [WEBHOOK]));
    const [row] = await rowsFor('sub-run');
    const claimed = (await claimDueOutbox(db, Date.now(), { workerId: 'W' })).find(
      (r) => r.id === row!.id,
    );
    // Give it attempts from an earlier generation so only the claim marker can
    // keep the settlement off it.
    await db.run(sql`UPDATE outbox SET attempts = 2 WHERE id = ${row!.id}`);

    await destinations.enqueueSubmissionDeliveries(deliveryInput('complete', 'sub-run', [WEBHOOK]));

    const rows = await rowsFor('sub-run');
    // The running row is untouched, and the replacement is queued beside it
    // rather than withheld: whether the running one is still worth sending is
    // settled when it is sent, not here.
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === row!.id)).toMatchObject({
      status: 'pending',
      attempts: 2,
      claimedBy: claimed!.claimedBy,
    });
  });
});

/**
 * What the idempotency key is derived from.
 *
 * The key used to be the destination's INDEX in the config array, which is not
 * an identity: delete the first of two webhooks and the second inherits the
 * first's key, so a queued delivery to one endpoint and a queued delivery to a
 * different endpoint became indistinguishable. It also could not tell two sends
 * apart when the answers had changed underneath them, which is the one question
 * a re-submit has to be able to ask.
 *
 * So the key is CONTENT-ADDRESSED: what is being delivered to (an explicit
 * allowlist of the destination's persisted, non-secret semantics) and what is
 * being delivered (the whole delivery context bar the key itself and the
 * submission's clock reading), each as a full SHA-256 over canonical JSON.
 * Equal keys mean equal deliveries, which is exactly what a receiver deduping
 * on the header we send it is entitled to assume.
 */
describe('the content-addressed delivery key', () => {
  const WEBHOOK = { type: 'webhook', enabled: true, settings: { url: 'https://acme.io/hook' } };
  const KEY_SHAPE = /^submission:[^:]+:(partial|complete):(webhook|hubspot):[0-9a-f]{64}:[0-9a-f]{64}$/;

  function deliveryInput(
    submissionId: string,
    destinationsConfig: unknown[],
    over: Partial<SubmissionDeliveryInput> = {},
  ): SubmissionDeliveryInput {
    return {
      formId: 'form-1',
      formName: 'F',
      accountId: 'acc-1',
      submissionId,
      sessionId: `sess-${submissionId}`,
      score: 0,
      outcomeLabel: null,
      phase: 'complete',
      submittedAt: 1_700_000_000_000,
      data: { email: 'lead@acme.io' },
      config: { version: 1, steps: [], destinations: destinationsConfig },
      ...over,
    };
  }

  const keysFor = async (subjectUid: string, kind: 'webhook' | 'hubspot' = 'webhook') =>
    (await listOutbox(db, { kind, subjectUid })).map((r) => keyOf(r.payload)!);

  /** The two halves of a key: what it delivers TO, and WHAT it delivers. */
  const digests = (key: string) => {
    const parts = key.split(':');
    return { destination: parts[4]!, content: parts[5]! };
  };

  /** Queue one destination on its own and report the digest of its identity. */
  const identityOf = async (
    subjectUid: string,
    destination: unknown,
    kind: 'webhook' | 'hubspot' = 'webhook',
  ) => {
    await destinations.enqueueSubmissionDeliveries(deliveryInput(subjectUid, [destination]));
    const [key] = await keysFor(subjectUid, kind);
    return digests(key!).destination;
  };

  it('names the submission, the phase and the kind in the clear and digests the rest', async () => {
    await destinations.enqueueSubmissionDeliveries(deliveryInput('sub-k', [WEBHOOK]));

    const [key] = await keysFor('sub-k');
    expect(key).toMatch(KEY_SHAPE);
    expect(key!.startsWith('submission:sub-k:complete:webhook:')).toBe(true);
  });

  it('re-keys a delivery whose ANSWERS changed, and only its content half', async () => {
    await destinations.enqueueSubmissionDeliveries(deliveryInput('sub-kc', [WEBHOOK]));
    const [before] = await keysFor('sub-kc');

    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('sub-kc', [WEBHOOK], { data: { email: 'moved@acme.io' } }),
    );
    const [after] = await keysFor('sub-kc');

    expect(after).not.toBe(before);
    expect(digests(after!).content).not.toBe(digests(before!).content);
    expect(digests(after!).destination).toBe(digests(before!).destination);
  });

  it('gives a re-submit that changed nothing the identical key', async () => {
    await destinations.enqueueSubmissionDeliveries(deliveryInput('sub-ks', [WEBHOOK]));
    const [before] = await keysFor('sub-ks');

    // A later clock reading is not a different delivery: the same answers to the
    // same form are the same thing to send, so a retry keeps its key.
    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('sub-ks', [WEBHOOK], { submittedAt: 1_700_000_999_999 }),
    );

    expect((await keysFor('sub-ks'))[0]).toBe(before);
  });

  it('does not depend on where a destination sits in the config array', async () => {
    const a = { ...WEBHOOK, settings: { url: 'https://a.example/hook' } };
    const b = { ...WEBHOOK, settings: { url: 'https://b.example/hook' } };
    await destinations.enqueueSubmissionDeliveries(deliveryInput('sub-ko', [a, b]));
    const inOrder = (await keysFor('sub-ko')).sort();

    await destinations.enqueueSubmissionDeliveries(deliveryInput('sub-ko', [b, a]));

    expect((await keysFor('sub-ko')).sort()).toEqual(inOrder);
  });

  it("never hands a removed destination's key to its neighbour", async () => {
    const a = { ...WEBHOOK, settings: { url: 'https://a.example/hook' } };
    const b = { ...WEBHOOK, settings: { url: 'https://b.example/hook' } };
    await destinations.enqueueSubmissionDeliveries(deliveryInput('sub-kr', [a]));
    const [keyA] = await keysFor('sub-kr');

    // `a` is deleted, so `b` moves into index 0. Under a positional key it would
    // now be indistinguishable from the delivery `a` had queued.
    await destinations.enqueueSubmissionDeliveries(deliveryInput('sub-kr', [b]));

    expect((await keysFor('sub-kr'))[0]).not.toBe(keyA);
  });

  it('is blind to the signing secret, so rotating it does not re-key the delivery', async () => {
    // The key is forwarded to the receiver as a header. Anything digested into
    // it is published, so the secret cannot be part of what identifies the
    // destination, and rotating a secret is not a new delivery either way.
    const withSecret = { ...WEBHOOK, settings: { ...WEBHOOK.settings, secret: 'shh-one' } };
    const rotated = { ...WEBHOOK, settings: { ...WEBHOOK.settings, secret: 'shh-two' } };

    expect(await identityOf('sub-kx1', withSecret)).toBe(await identityOf('sub-kx2', rotated));
    expect(await identityOf('sub-kx3', WEBHOOK)).toBe(await identityOf('sub-kx1', withSecret));
  });

  it('re-keys when the URL of a destination with no id changes', async () => {
    // A legacy webhook carries no id, so the endpoint is the only stable thing
    // left to identify it by.
    const moved = { ...WEBHOOK, settings: { url: 'https://elsewhere.example/hook' } };
    expect(await identityOf('sub-ku1', WEBHOOK)).not.toBe(await identityOf('sub-ku2', moved));
  });

  it('re-keys when the id, the events or the signature header change', async () => {
    const base = { ...WEBHOOK, id: 'wh-1' };
    const plain = await identityOf('sub-ki0', base);

    expect(await identityOf('sub-ki1', { ...base, id: 'wh-2' })).not.toBe(plain);
    expect(await identityOf('sub-ki2', { ...base, events: ['complete'] })).not.toBe(plain);
    expect(
      await identityOf('sub-ki3', {
        ...base,
        settings: { ...base.settings, signatureHeader: 'X-Acme-Signature' },
      }),
    ).not.toBe(plain);
  });

  it('digests the same answers to the same key whatever order they arrive in', async () => {
    // The answers and the CRM mappings are records built from user input, so
    // their key order is an accident of how the form was filled in or edited.
    // Two spellings of one object are one object, or the digest is not an
    // identity and every re-submit re-keys itself.
    const mapped = (fieldMappings: Record<string, string>) => ({
      type: 'hubspot',
      enabled: true,
      fieldMappings,
    });
    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('sub-kn', [mapped({ email: 'email', role: 'jobtitle' })], {
        data: { email: 'lead@acme.io', role: 'ops' },
      }),
    );
    const [before] = await keysFor('sub-kn', 'hubspot');

    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('sub-kn', [mapped({ role: 'jobtitle', email: 'email' })], {
        data: { role: 'ops', email: 'lead@acme.io' },
      }),
    );

    expect((await keysFor('sub-kn', 'hubspot'))[0]).toBe(before);
  });

  it('keeps two id-bearing webhooks pointed at ONE url apart', async () => {
    const two = [
      { ...WEBHOOK, id: 'wh-left' },
      { ...WEBHOOK, id: 'wh-right' },
    ];
    await destinations.enqueueSubmissionDeliveries(deliveryInput('sub-k2', two));

    const keys = await keysFor('sub-k2');
    expect(keys).toHaveLength(2);
    expect(new Set(keys.map((k) => digests(k).destination)).size).toBe(2);
  });

  it('keeps two HubSpot destinations with different mappings apart', async () => {
    // HubSpot holds no secret in its config, so its identity is everything the
    // form persists about it. Two entries differing only in what they write are
    // two different deliveries.
    const two = [
      { type: 'hubspot', enabled: true, fieldMappings: { email: 'email' } },
      { type: 'hubspot', enabled: true, fieldMappings: { email: 'work_email' } },
    ];
    await destinations.enqueueSubmissionDeliveries(deliveryInput('sub-k3', two));

    const keys = await keysFor('sub-k3', 'hubspot');
    expect(keys).toHaveLength(2);
    expect(new Set(keys.map((k) => digests(k).destination)).size).toBe(2);
  });
});

/**
 * Which queued row is still worth sending, decided when it is about to be sent.
 *
 * The enqueue pass cannot answer this. It can delete what was never started and
 * settle what is waiting to retry, but a row a worker is holding is beyond its
 * reach, and declining to queue the newer answers instead would lose them: the
 * in-flight row carries a snapshot the respondent has since replaced.
 *
 * So both rows are queued, and the decision moves to the last possible moment.
 * A row about to cross the wire looks at what else is queued for the same
 * subject, kind and action, keeps only the rows delivering to the SAME
 * destination, and stands down if it is not the newest of them. Nothing is
 * lost: the row that stands down is the one another row supersedes.
 */
describe('retiring a superseded delivery at the moment it crosses the wire', () => {
  const WEBHOOK = { type: 'webhook', enabled: true, settings: { url: 'https://acme.io/hook' } };
  let called = 0;
  let sent: string[] = [];

  beforeEach(() => {
    called = 0;
    sent = [];
    destinations.fetchImpl = (async (_url: unknown, init?: { body?: unknown }) => {
      called += 1;
      sent.push(String(init?.body ?? ''));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
  });

  function deliveryInput(
    submissionId: string,
    destinationsConfig: unknown[],
    data: Record<string, unknown> = { email: 'lead@acme.io' },
  ): SubmissionDeliveryInput {
    return {
      formId: 'form-1',
      formName: 'F',
      accountId: 'acc-1',
      submissionId,
      sessionId: `sess-${submissionId}`,
      score: 0,
      outcomeLabel: null,
      phase: 'complete',
      submittedAt: 1_700_000_000_000,
      data,
      config: { version: 1, steps: [], destinations: destinationsConfig },
    };
  }

  const rowsFor = (subjectUid: string) => listOutbox(db, { kind: 'webhook', subjectUid });

  /**
   * Queue a pass and pin the rows it added to one moment in the ordering, so
   * "newest" means what the test says rather than whichever UUID sorted higher.
   */
  async function pass(
    subjectUid: string,
    destinationsConfig: unknown[],
    data: Record<string, unknown>,
    at: number,
  ) {
    const before = new Set((await rowsFor(subjectUid)).map((r) => r.id));
    await destinations.enqueueSubmissionDeliveries(
      deliveryInput(subjectUid, destinationsConfig, data),
    );
    const added = (await rowsFor(subjectUid)).filter((r) => !before.has(r.id));
    for (const row of added) await stampCreatedAt(row.id, at);
    return added;
  }

  const deliverRow = (row: { action: string; payload: string | null }) =>
    destinations.deliver(row.action, row.payload!);

  it('stands the older row down once newer answers are queued for the same destination', async () => {
    const [first] = await pass('sub-g1', [WEBHOOK], { email: 'first@acme.io' }, 1_000);
    await holdRow(first!.id);
    const [second] = await pass('sub-g1', [WEBHOOK], { email: 'second@acme.io' }, 2_000);

    await expect(deliverRow(first!)).rejects.toBeInstanceOf(OutboxSkipError);
    expect(called).toBe(0);

    // The row that stood down is the OLDER one, by id, and the delivery that
    // goes out is the one carrying the answers the respondent actually left.
    // Counting rows would not distinguish that from the opposite mistake.
    await expect(deliverRow(second!)).resolves.toBeDefined();
    expect(second!.id).not.toBe(first!.id);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!).data).toEqual({ email: 'second@acme.io' });
    const survivors = await rowsFor('sub-g1');
    expect(survivors.map((r) => r.id).sort()).toEqual([first!.id, second!.id].sort());
  });

  it('retires neither of two rows queued in the SAME instant, and delivers both', async () => {
    // Two passes of one session can land on a single millisecond. The row id is
    // a random UUID, so ordering by it would pick a winner at random and drop
    // the other delivery for good. Equal timestamps are no evidence of which
    // came later, so neither row may retire the other: both go out, under
    // distinct keys, and the receiver deduping on the header sees two events
    // because there genuinely were two.
    const [first] = await pass('sub-gt', [WEBHOOK], { email: 'first@acme.io' }, 5_000);
    await holdRow(first!.id, 'W#one');
    const [second] = await pass('sub-gt', [WEBHOOK], { email: 'second@acme.io' }, 5_000);
    await holdRow(second!.id, 'W#two');
    expect(keyOf(second!.payload)).not.toBe(keyOf(first!.payload));

    await expect(deliverRow(first!)).resolves.toBeDefined();
    await expect(deliverRow(second!)).resolves.toBeDefined();

    expect(sent).toHaveLength(2);
    expect(sent.map((b) => JSON.parse(b).data.email).sort()).toEqual([
      'first@acme.io',
      'second@acme.io',
    ]);
  });

  it('delivers the newest row, which can never retire itself', async () => {
    const [first] = await pass('sub-g2', [WEBHOOK], { email: 'first@acme.io' }, 1_000);
    await holdRow(first!.id);
    const [second] = await pass('sub-g2', [WEBHOOK], { email: 'second@acme.io' }, 2_000);

    await expect(deliverRow(second!)).resolves.toBeDefined();
    expect(called).toBe(1);
  });

  it('delivers an identical re-submit: the same key supersedes nothing', async () => {
    const [first] = await pass('sub-g3', [WEBHOOK], { email: 'same@acme.io' }, 1_000);
    await holdRow(first!.id);
    const [second] = await pass('sub-g3', [WEBHOOK], { email: 'same@acme.io' }, 2_000);
    expect(keyOf(second!.payload)).toBe(keyOf(first!.payload));

    await expect(deliverRow(first!)).resolves.toBeDefined();
    expect(called).toBe(1);
  });

  it('never lets one destination retire a same-kind sibling', async () => {
    const a = { ...WEBHOOK, settings: { url: 'https://a.example/hook' } };
    const b = { ...WEBHOOK, settings: { url: 'https://b.example/hook' } };
    const firstPass = await pass('sub-g4', [a, b], { email: 'first@acme.io' }, 1_000);
    for (const row of firstPass) await holdRow(row.id);
    // Only `a` is re-queued, with new answers. Nothing newer exists for `b`.
    await pass('sub-g4', [a], { email: 'second@acme.io' }, 2_000);

    const held = await rowsFor('sub-g4');
    const oldB = firstPass.find(
      (r) => JSON.parse(r.payload!).destination.settings.url === 'https://b.example/hook',
    )!;
    const oldA = firstPass.find((r) => r.id !== oldB.id)!;
    expect(held).toHaveLength(3);

    await expect(deliverRow(oldB)).resolves.toBeDefined();
    await expect(deliverRow(oldA)).rejects.toBeInstanceOf(OutboxSkipError);
    expect(called).toBe(1);
  });

  it('ignores a queued row whose payload cannot be read', async () => {
    const [first] = await pass('sub-g5', [WEBHOOK], { email: 'first@acme.io' }, 1_000);
    await holdRow(first!.id);
    const id = await enqueueOutbox(db, {
      kind: 'webhook',
      action: 'complete',
      subjectUid: 'sub-g5',
      accountId: 'acc-1',
      payload: 'not json',
    });
    await stampCreatedAt(id, 9_000);

    // A row that names no delivery vouches for none, so it can supersede none.
    await expect(deliverRow(first!)).resolves.toBeDefined();
    expect(called).toBe(1);
  });

  it('ignores a queued row carrying a legacy positional key', async () => {
    const [first] = await pass('sub-g6', [WEBHOOK], { email: 'first@acme.io' }, 1_000);
    await holdRow(first!.id);
    const id = await enqueueOutbox(db, {
      kind: 'webhook',
      action: 'complete',
      subjectUid: 'sub-g6',
      accountId: 'acc-1',
      payload: JSON.stringify({ ctx: { idempotencyKey: 'submission:sub-g6:complete:webhook:0' } }),
    });
    await stampCreatedAt(id, 9_000);

    // The old shape names no destination this rule can compare against, so it
    // cannot stand in for one and retire unrelated work.
    await expect(deliverRow(first!)).resolves.toBeDefined();
    expect(called).toBe(1);
  });

  it('ignores a key that only LOOKS like one of ours', async () => {
    // The fingerprint filter cannot be the only check, because a string can
    // carry this row's own destination digest and still not be a key this
    // scheme ever minted. An extra segment is the cheapest way to be neither.
    const [first] = await pass('sub-ga', [WEBHOOK], { email: 'first@acme.io' }, 1_000);
    await holdRow(first!.id);
    const mine = keyOf(first!.payload)!;
    const id = await enqueueOutbox(db, {
      kind: 'webhook',
      action: 'complete',
      subjectUid: 'sub-ga',
      accountId: 'acc-1',
      payload: JSON.stringify({ ctx: { idempotencyKey: `${mine}:extra` } }),
    });
    await stampCreatedAt(id, 9_000);

    await expect(deliverRow(first!)).resolves.toBeDefined();
    expect(called).toBe(1);
  });

  it('ignores a key of the right shape whose digests are not digests', async () => {
    // Same segment count, same destination half, and a content half that no
    // SHA-256 could have produced. Reading it as a delivery would let a
    // hand-written string retire a real one.
    const [first] = await pass('sub-gb', [WEBHOOK], { email: 'first@acme.io' }, 1_000);
    await holdRow(first!.id);
    const mine = keyOf(first!.payload)!;
    const id = await enqueueOutbox(db, {
      kind: 'webhook',
      action: 'complete',
      subjectUid: 'sub-gb',
      accountId: 'acc-1',
      payload: JSON.stringify({
        ctx: { idempotencyKey: [...mine.split(':').slice(0, 5), 'deadbeef'].join(':') },
      }),
    });
    await stampCreatedAt(id, 9_000);

    await expect(deliverRow(first!)).resolves.toBeDefined();
    expect(called).toBe(1);
  });

  it('delivers a row whose OWN key is legacy rather than guessing what supersedes it', async () => {
    const legacy = await enqueueOutbox(db, {
      kind: 'webhook',
      action: 'complete',
      subjectUid: 'sub-g7',
      accountId: 'acc-1',
      payload: JSON.stringify({
        destination: WEBHOOK,
        ctx: {
          idempotencyKey: 'submission:sub-g7:complete:webhook:0',
          submissionId: 'sub-g7',
          formId: 'form-1',
          formName: 'F',
          accountId: 'acc-1',
          sessionId: 'sess-g7',
          score: 0,
          outcomeLabel: null,
          phase: 'complete',
          submittedAt: 1_700_000_000_000,
          data: { email: 'legacy@acme.io' },
          utm: {},
        },
      }),
    });
    await stampCreatedAt(legacy, 1_000);
    await holdRow(legacy);
    await pass('sub-g7', [WEBHOOK], { email: 'second@acme.io' }, 2_000);

    const row = (await rowsFor('sub-g7')).find((r) => r.id === legacy)!;
    await expect(deliverRow(row)).resolves.toBeDefined();
    expect(called).toBe(1);
  });

  it('settles the retired row as skipped through the worker, and calls the endpoint once', async () => {
    const [first] = await pass('sub-g8', [WEBHOOK], { email: 'first@acme.io' }, 1_000);
    // Held by a worker that then died: the second pass cannot delete it (it is
    // not unstarted) and the drain below can reclaim it (the lease is stale).
    await holdStale(first!.id);
    await pass('sub-g8', [WEBHOOK], { email: 'second@acme.io' }, 2_000);
    expect(await rowsFor('sub-g8')).toHaveLength(2);

    const env = { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5000, NODE_ENV: 'test' } as never;
    const email = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
    await new OutboxWorker(db, env, email, destinations).drainOnce();

    expect(called).toBe(1);
    const rows = await rowsFor('sub-g8');
    expect(rows.map((r) => r.status).sort()).toEqual(['done', 'skipped']);
    // The worker's ordinary skip path records why, with no digest or key in it.
    const retired = rows.find((r) => r.status === 'skipped')!;
    expect(retired.id).toBe(first!.id);
    expect(retired.lastError).toBe(
      'superseded by a later submission of the same session and phase',
    );
  });

  it('lets exactly one of two rows racing to deliver reach the endpoint', async () => {
    const [first] = await pass('sub-g9', [WEBHOOK], { email: 'first@acme.io' }, 1_000);
    await holdRow(first!.id, 'W#one');
    const [second] = await pass('sub-g9', [WEBHOOK], { email: 'second@acme.io' }, 2_000);
    await holdRow(second!.id, 'W#two');

    const outcomes = await Promise.allSettled([deliverRow(first!), deliverRow(second!)]);

    expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
    expect(called).toBe(1);
  });
});
