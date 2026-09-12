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

/** The delivery a queued row names, as its payload records it. */
function keyOf(payload: string | null): string | null {
  if (!payload) return null;
  try {
    return (JSON.parse(payload) as { ctx?: { idempotencyKey?: string } }).ctx?.idempotencyKey ?? null;
  } catch {
    return null;
  }
}

/** Hand a row to a worker without racing a real claim for it. */
const holdRow = (id: string, by = 'W#held') =>
  db.run(sql`UPDATE outbox SET claimed_at = ${Date.now()}, claimed_by = ${by} WHERE id = ${id}`);

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
    // Both are queued, and both keep the same unchanged positional key.
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
    // ...and the newer answers are queued beside it. Both rows carry the SAME
    // positional key, unchanged by this branch, because the submission, the
    // phase, the type and the config index are all the same. What the far end
    // does when it sees that key twice is the receiver's business and outside
    // Dapta Forms; this test asserts only what the queue holds. What the queue
    // must not do is drop either row on our side, because the held one may
    // already have landed and the fresh one is the only copy of the latest
    // answers.
    const fresh = rows.find((r) => r.id !== claimed!.id)!;
    expect(fresh).toMatchObject({ status: 'pending', attempts: 0, claimedAt: null });
    expect(keyOf(fresh.payload)).toBe(keyOf(rows.find((r) => r.id === claimed!.id)!.payload));
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
    const unstarted = after.filter((r) => r.claimedAt === null);
    expect(unstarted).toHaveLength(2);
    // The two fresh rows are the two SIBLINGS, not one destination queued
    // twice: they carry different endpoints and different keys, so the pass
    // never let one of them stand in for the other.
    expect(unstarted.map((r) => JSON.parse(r.payload!).destination.settings.url).sort()).toEqual([
      'https://first.example/hook',
      'https://second.example/hook',
    ]);
    expect(new Set(unstarted.map((r) => keyOf(r.payload))).size).toBe(2);
  });

  it('replaces the row the previous SEQUENTIAL pass left, rather than stacking one per submit', async () => {
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
    // Each pass deletes the unstarted row the pass before it left, so a session
    // submitted over and over does not stack a row per submit: the held row,
    // plus the latest answers. This is a statement about passes that RUN ONE
    // AFTER ANOTHER, which is how a session submits. Two passes overlapping in
    // time can both get past the delete before either enqueues, and nothing
    // here bounds that: the queue is at-least-once, and the rows it produces
    // carry the same unchanged positional key. Whether anything is made of that
    // at the far end is outside Dapta Forms.
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
 * author switched off has nothing left in its own config to stop it retrying.
 * The pass settles the rows that are UNCLAIMED WHEN IT RUNS, and only those. A
 * row a worker is holding at that moment is left alone, and the pass cannot
 * bound what happens to it next: the attempt may succeed and finish `done`, may
 * fail and drop back into backoff unclaimed, or may lose its lease and stay
 * claimed for another worker. Because the row this pass queues is due
 * immediately and a backed-off retry is not, Dapta Forms can send the older
 * payload after the newer one and then mark that older row done; `max_attempts`
 * caps the retries that follow rather than un-sending the ones already made,
 * and no later pass is guaranteed to settle it, since a re-landed complete does
 * not re-enqueue. What a receiver makes of the pair is outside Dapta Forms. The
 * tests below assert the bounded half, and claim nothing about the rest.
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

  it('settles the unclaimed backoff row of a WITHDRAWN destination as skipped', async () => {
    const stale = await intoBackoff('sub-wd');

    // The author disables the webhook, then the session is submitted again.
    await destinations.enqueueSubmissionDeliveries(
      deliveryInput('complete', 'sub-wd', [{ ...WEBHOOK, enabled: false }]),
    );

    const rows = await rowsFor('sub-wd');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: stale, status: 'skipped', attempts: 2 });

    // The drain below is corroboration, not the oracle. `markOutboxRetry` put
    // this row's next attempt in the future, so a drain now would reach no
    // endpoint whether it had been settled or was merely not yet due; the
    // status assertion above is what distinguishes the two. What the drain does
    // add is that settling changed nothing else the worker looks at.
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
 * What the idempotency key is, and what a delivery is allowed to depend on.
 *
 * The key names a destination POSITIONALLY: the submission, the phase, the
 * destination type, and the destination's index in the form config. A webhook
 * delivery sends it as a header, the HubSpot adapter does not read it at all,
 * and nothing inside this system reads it back. What a receiver does with it is
 * that receiver's business and outside Dapta Forms; these tests pin only the
 * shape we emit. Both facts were briefly given up on this branch: the key was
 * made content-addressed, and `deliver` was made to re-read the queue to decide
 * whether the row it had been handed was still the current one. Both are out.
 *
 * Delivery is a function of the row it was given. A claimed row's fate cannot
 * turn on what some later pass did or did not enqueue, because a worker holding
 * a row may already have crossed the wire, and a second opinion formed after
 * the fact cannot unsend anything.
 */
describe('the delivery key, and what delivery may depend on', () => {
  const WEBHOOK = { type: 'webhook', enabled: true, settings: { url: 'https://acme.io/hook' } };

  function deliveryInput(submissionId: string, destinationsConfig: unknown[]): SubmissionDeliveryInput {
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
    };
  }

  it('is the submission, the phase, the type and the config index, exactly', async () => {
    await destinations.enqueueSubmissionDeliveries(deliveryInput('sub-key', [WEBHOOK]));

    const rows = await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-key' });
    expect(rows.map((r) => keyOf(r.payload))).toEqual(['submission:sub-key:complete:webhook:0']);
  });

  it('gives each same-type sibling its own key, one per config index', async () => {
    const two = [
      { ...WEBHOOK, settings: { url: 'https://first.example/hook' } },
      { ...WEBHOOK, settings: { url: 'https://second.example/hook' } },
    ];

    await destinations.enqueueSubmissionDeliveries(deliveryInput('sub-sibkey', two));

    const rows = await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-sibkey' });
    expect(rows.map((r) => keyOf(r.payload)).sort()).toEqual([
      'submission:sub-sibkey:complete:webhook:0',
      'submission:sub-sibkey:complete:webhook:1',
    ]);
  });

  it('keeps the index a destination had in the config, not its position after filtering', async () => {
    // The disabled entry still occupies index 0, so the one that fires is 1.
    const config = [
      { ...WEBHOOK, enabled: false },
      { ...WEBHOOK, settings: { url: 'https://second.example/hook' } },
    ];

    await destinations.enqueueSubmissionDeliveries(deliveryInput('sub-idx', config));

    const rows = await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-idx' });
    expect(rows.map((r) => keyOf(r.payload))).toEqual(['submission:sub-idx:complete:webhook:1']);
  });

  it('reads nothing from the database while delivering', async () => {
    await destinations.enqueueSubmissionDeliveries(deliveryInput('sub-noread', [WEBHOOK]));
    const [row] = await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-noread' });
    destinations.fetchImpl = (async () =>
      new Response('{}', { status: 200 })) as unknown as typeof fetch;

    const handle = db as unknown as Record<'run' | 'get' | 'all', (q: unknown) => unknown>;
    const real = { run: handle.run, get: handle.get, all: handle.all };
    let queries = 0;
    for (const name of ['run', 'get', 'all'] as const) {
      handle[name] = (q: unknown) => {
        queries += 1;
        return real[name].call(db, q);
      };
    }
    try {
      await destinations.deliver(row!.action, row!.payload!);
    } finally {
      Object.assign(handle, real);
    }

    expect(queries).toBe(0);
  });
});
