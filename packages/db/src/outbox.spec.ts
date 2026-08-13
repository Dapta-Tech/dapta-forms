/**
 * Outbox claim/lease (H2) — the guard that stops multiple API replicas
 * delivering the same row twice. Runs on both dialects (CI re-runs against
 * Postgres via DATABASE_URL, exercising FOR UPDATE SKIP LOCKED).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import {
  enqueueOutbox,
  claimDueOutbox,
  markOutboxRetry,
  markOutboxDone,
  markOutboxFailed,
  listFailedDeliveries,
  listFormDeliveries,
  listOutbox,
  recordSettledDelivery,
  summarizeFailedDeliveriesByForm,
  WEBHOOK_PING_ACTION,
  type OutboxKind,
  type OutboxStatus,
} from './outbox';

let db: Db;

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  await db.run(sql`DELETE FROM outbox`);
});

afterEach(async () => {
  await db.run(sql`DELETE FROM outbox`);
  await db.close();
});

describe('claimDueOutbox', () => {
  it('claims due rows and does not hand the same row to a second claim', async () => {
    const now = 1_000_000;
    await enqueueOutbox(db, { kind: 'email', action: 'a', now });
    await enqueueOutbox(db, { kind: 'email', action: 'b', now });

    const first = await claimDueOutbox(db, now, { workerId: 'A' });
    expect(first).toHaveLength(2);
    expect(first.every((r) => r.claimedAt === now && r.claimedBy === 'A')).toBe(true);

    // A concurrent worker draining immediately must get NOTHING — the rows are
    // claimed and the claims are not yet stale.
    const second = await claimDueOutbox(db, now + 1, { workerId: 'B' });
    expect(second).toHaveLength(0);
  });

  it('splits rows between two workers claiming with a limit (no overlap)', async () => {
    const now = 2_000_000;
    for (let i = 0; i < 4; i++) await enqueueOutbox(db, { kind: 'email', action: `x${i}`, now });

    const a = await claimDueOutbox(db, now, { workerId: 'A', limit: 2 });
    const b = await claimDueOutbox(db, now, { workerId: 'B', limit: 2 });
    const ids = new Set([...a, ...b].map((r) => r.id));
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(ids.size).toBe(4); // disjoint sets — no row claimed twice
  });

  it('reclaims a STALE claim (a crashed worker leaves rows recoverable)', async () => {
    const now = 3_000_000;
    await enqueueOutbox(db, { kind: 'email', action: 'a', now });
    const claimed = await claimDueOutbox(db, now, { workerId: 'A' });
    expect(claimed).toHaveLength(1);

    // Not yet stale → not reclaimable.
    expect(await claimDueOutbox(db, now + 1000, { workerId: 'B', staleClaimMs: 60_000 })).toHaveLength(0);
    // Past the stale threshold → reclaimable.
    const reclaimed = await claimDueOutbox(db, now + 120_000, { workerId: 'B', staleClaimMs: 60_000 });
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]!.claimedBy).toBe('B');
  });

  it('a retry clears the claim so the row is reclaimable after backoff', async () => {
    const now = 4_000_000;
    const id = await enqueueOutbox(db, { kind: 'email', action: 'a', now });
    const claimed = await claimDueOutbox(db, now, { workerId: 'A' });
    expect(claimed).toHaveLength(1);

    await markOutboxRetry(db, id, { attempts: 1, error: 'boom', now });
    // Backoff pushed next_attempt_at forward; claim was cleared. It becomes
    // claimable again once the backoff elapses.
    const afterBackoff = now + 10_000;
    const again = await claimDueOutbox(db, afterBackoff, { workerId: 'B' });
    expect(again).toHaveLength(1);
    expect(again[0]!.claimedBy).toBe('B');
    expect(again[0]!.attempts).toBe(1);
  });

  it('does not reclaim a row already marked done', async () => {
    const now = 5_000_000;
    const id = await enqueueOutbox(db, { kind: 'email', action: 'a', now });
    await claimDueOutbox(db, now, { workerId: 'A' });
    await markOutboxDone(db, id, now);
    expect(await claimDueOutbox(db, now + 1_000_000, { workerId: 'B', staleClaimMs: 0 })).toHaveLength(0);
  });
});


/**
 * The admin's failure log. Account scoping is the invariant under test: these
 * rows carry delivery reasons for one tenant and must never be readable from
 * another, which is why the filter is in SQL and not applied afterwards.
 */
describe('listFailedDeliveries', () => {
  const ACC = 'acc-1';
  const OTHER = 'acc-2';
  const FORM = 'form-1';

  async function seedRow(
    accountId: string,
    formId: string,
    status: 'failed' | 'skipped' | 'done',
    lastError: string | null,
  ) {
    const id = await enqueueOutbox(db, {
      kind: 'booking_sync',
      action: 'crm_update',
      accountId,
      payload: JSON.stringify({ formId, sessionId: 's' }),
      now: 1_000,
    });
    await db.run(
      sql`UPDATE outbox SET status = ${status}, last_error = ${lastError}, updated_at = 2000 WHERE id = ${id}`,
    );
    return id;
  }

  it('returns only this account and this form, and only what did not land', async () => {
    const wanted = await seedRow(ACC, FORM, 'failed', 'hubspot 500');
    const skipped = await seedRow(ACC, FORM, 'skipped', 'no respondent email resolvable');
    await seedRow(ACC, FORM, 'done', null); // landed — not a failure
    await seedRow(ACC, 'form-2', 'failed', 'other form');
    await seedRow(OTHER, FORM, 'failed', 'another tenant');

    const rows = await listFailedDeliveries(db, ACC, FORM);
    expect(rows.map((r) => r.id).sort()).toEqual([skipped, wanted].sort());
    expect(rows.map((r) => r.lastError).sort()).toEqual(
      ['hubspot 500', 'no respondent email resolvable'].sort(),
    );
  });

  it('caps the list and ignores rows whose payload cannot be read', async () => {
    for (let i = 0; i < 3; i++) await seedRow(ACC, FORM, 'failed', `e${i}`);
    const bad = await enqueueOutbox(db, {
      kind: 'booking_sync',
      action: 'crm_update',
      accountId: ACC,
      payload: 'not json',
      now: 1_000,
    });
    await db.run(sql`UPDATE outbox SET status = 'failed' WHERE id = ${bad}`);

    expect(await listFailedDeliveries(db, ACC, FORM)).toHaveLength(3);
    expect(await listFailedDeliveries(db, ACC, FORM, 2)).toHaveLength(2);
  });

  /**
   * Destination rows nest the form one level down, in `ctx`, because a retry
   * needs the destination and the captured context together. Matching only the
   * TOP level meant no webhook or HubSpot failure had ever reached the admin —
   * including the per-form panel built to show them. `booking_sync` was the only
   * kind that matched, which is why every test above passed over the hole.
   */
  describe('destination rows, whose form lives at ctx.formId', () => {
    async function seedDestinationRow(
      accountId: string,
      formId: string,
      kind: 'webhook' | 'hubspot',
      lastError: string,
      updatedAt = 2_000,
    ) {
      const id = await enqueueOutbox(db, {
        kind,
        action: 'complete',
        accountId,
        payload: JSON.stringify({
          destination: { type: kind, enabled: true, settings: { url: 'https://x.test/hook' } },
          ctx: { formId, submissionId: 'sub-1', accountId },
        }),
        now: 1_000,
      });
      await db.run(
        sql`UPDATE outbox SET status = 'failed', last_error = ${lastError}, updated_at = ${updatedAt} WHERE id = ${id}`,
      );
      return id;
    }

    it('surfaces a webhook failure for its form', async () => {
      const id = await seedDestinationRow(ACC, FORM, 'webhook', 'HTTP 502 from https://x.test/hook');
      const rows = await listFailedDeliveries(db, ACC, FORM);
      expect(rows.map((r) => r.id)).toEqual([id]);
      expect(rows[0]?.kind).toBe('webhook');
    });

    it('does not leak a destination failure into another FORM', async () => {
      await seedDestinationRow(ACC, 'form-2', 'webhook', 'not this form');
      expect(await listFailedDeliveries(db, ACC, FORM)).toEqual([]);
    });

    it('does not leak a destination failure into another ACCOUNT', async () => {
      // The whole safety argument for widening the matcher: the tenant filter is
      // in SQL, so a looser payload match can only ever reveal more of the
      // caller's OWN rows.
      await seedDestinationRow(OTHER, FORM, 'webhook', 'another tenant');
      expect(await listFailedDeliveries(db, ACC, FORM)).toEqual([]);
    });

    it('still matches the top-level shape booking_sync writes', async () => {
      const booking = await seedRow(ACC, FORM, 'failed', 'calendly 500');
      const webhook = await seedDestinationRow(ACC, FORM, 'webhook', 'HTTP 500');
      const rows = await listFailedDeliveries(db, ACC, FORM);
      expect(rows.map((r) => r.id).sort()).toEqual([booking, webhook].sort());
    });
  });
});

/**
 * The delivery transcript — what crossed the wire, kept on the row.
 *
 * The columns are the whole reason the history can answer "why", so the cases
 * that matter are the ones where a later write could destroy an earlier answer.
 */
describe('the delivery transcript', () => {
  const ACC = 'acc-1';
  const FORM = 'form-1';

  const seedPending = () =>
    enqueueOutbox(db, {
      kind: 'webhook',
      action: 'complete',
      accountId: ACC,
      payload: JSON.stringify({ destination: { type: 'webhook' }, ctx: { formId: FORM } }),
      now: 1_000,
    });

  const readBack = async (id: string) =>
    (await listOutbox(db, { accountId: ACC })).find((r) => r.id === id);

  it('keeps what was sent and what came back on a delivered row', async () => {
    const id = await seedPending();
    await markOutboxDone(db, id, 2_000, {
      requestBody: '{"hello":"world"}',
      responseStatus: 200,
      responseBody: 'ok',
    });
    const row = await readBack(id);
    expect(row?.requestBody).toBe('{"hello":"world"}');
    expect(row?.responseStatus).toBe(200);
    expect(row?.responseBody).toBe('ok');
  });

  it('keeps them on a failed row too — the one anybody reads back', async () => {
    const id = await seedPending();
    await markOutboxFailed(db, id, {
      attempts: 5,
      error: 'webhook delivery failed: HTTP 400',
      now: 2_000,
      transcript: { requestBody: '{"a":1}', responseStatus: 400, responseBody: '{"error":"nope"}' },
    });
    const row = await readBack(id);
    expect(row?.status).toBe('failed');
    expect(row?.responseStatus).toBe(400);
    expect(row?.responseBody).toBe('{"error":"nope"}');
  });

  it('does not let a later attempt with no transcript erase the earlier one', async () => {
    // The last retry of a webhook whose host stopped resolving reports no
    // response. Nulling the stored one would throw away the only evidence of
    // what the endpoint used to say — which is the answer being looked for.
    const id = await seedPending();
    await markOutboxRetry(db, id, {
      attempts: 1,
      error: 'HTTP 500',
      now: 2_000,
      transcript: { requestBody: '{"a":1}', responseStatus: 500, responseBody: 'boom' },
    });
    await markOutboxFailed(db, id, { attempts: 5, error: 'getaddrinfo ENOTFOUND', now: 3_000 });
    const row = await readBack(id);
    expect(row?.responseStatus).toBe(500);
    expect(row?.responseBody).toBe('boom');
  });

  it('truncates a receiver that answers with a whole page', async () => {
    const id = await seedPending();
    await markOutboxDone(db, id, 2_000, { responseBody: 'x'.repeat(5_000) });
    const row = await readBack(id);
    expect(row?.responseBody?.length).toBeLessThan(5_000);
    expect(row?.responseBody?.endsWith('…')).toBe(true);
  });
});

/**
 * The admin's test delivery is synchronous — it never passes through the queue —
 * but it IS a real POST to the real endpoint, so it is recorded like one.
 */
describe('recordSettledDelivery', () => {
  const ACC = 'acc-1';
  const FORM = 'form-1';

  const record = (status: 'done' | 'failed') =>
    recordSettledDelivery(db, {
      kind: 'webhook',
      action: WEBHOOK_PING_ACTION,
      accountId: ACC,
      payload: JSON.stringify({ destination: { type: 'webhook' }, ctx: { formId: FORM } }),
      status,
      error: status === 'failed' ? 'webhook delivery failed: HTTP 400' : null,
      transcript: { requestBody: '{"test":true}', responseStatus: 400, responseBody: 'nope' },
      now: 2_000,
    });

  it('lands in the form history like any other delivery', async () => {
    const id = await record('failed');
    const rows = await listFormDeliveries(db, ACC, FORM, { kinds: ['webhook'] });
    expect(rows.map((r) => r.id)).toEqual([id]);
    expect(rows[0]?.action).toBe(WEBHOOK_PING_ACTION);
    expect(rows[0]?.requestBody).toBe('{"test":true}');
  });

  it('is never claimable, so a test delivery cannot be sent twice', async () => {
    // Enqueueing and then settling would leave a window for the worker to grab
    // the row. Inserted terminal, with nothing due, there is no window at all.
    await record('done');
    expect(await claimDueOutbox(db, Number.MAX_SAFE_INTEGER)).toEqual([]);
  });
});

/**
 * The same read, widened to answer "what happened" rather than "what broke".
 *
 * Every case here is about a narrowing that must hold: the per-integration
 * history asks for `done` rows, and `done` is most of this table, so a `kinds`
 * filter that quietly failed open would put a form's landed emails inside its
 * webhook card.
 */
describe('listFormDeliveries', () => {
  const ACC = 'acc-1';
  const OTHER = 'acc-2';
  const FORM = 'form-1';

  async function seed(over: {
    accountId?: string;
    formId?: string;
    kind?: OutboxKind;
    action?: string;
    status?: OutboxStatus;
    lastError?: string | null;
    attempts?: number;
    updatedAt?: number;
  }) {
    const kind = over.kind ?? 'webhook';
    const accountId = over.accountId ?? ACC;
    const id = await enqueueOutbox(db, {
      kind,
      action: over.action ?? 'complete',
      accountId,
      payload: JSON.stringify({
        destination: { type: kind, enabled: true, settings: { url: 'https://x.test/hook' } },
        ctx: { formId: over.formId ?? FORM, submissionId: 'sub-1', accountId },
      }),
      now: 1_000,
    });
    await db.run(
      sql`UPDATE outbox SET status = ${over.status ?? 'done'},
                            last_error = ${over.lastError ?? null},
                            attempts = ${over.attempts ?? 0},
                            updated_at = ${over.updatedAt ?? 2_000}
          WHERE id = ${id}`,
    );
    return id;
  }

  it('defaults to failures only, so existing callers see no change', async () => {
    const failed = await seed({ status: 'failed', lastError: 'HTTP 400' });
    await seed({ status: 'done' });
    await seed({ status: 'pending' });

    const rows = await listFormDeliveries(db, ACC, FORM);
    expect(rows.map((r) => r.id)).toEqual([failed]);
  });

  it('returns what landed when asked for it, newest first', async () => {
    const older = await seed({ status: 'done', updatedAt: 2_000 });
    const newer = await seed({ status: 'failed', lastError: 'HTTP 400', updatedAt: 3_000 });

    const rows = await listFormDeliveries(db, ACC, FORM, {
      statuses: ['done', 'pending', 'failed', 'skipped'],
    });
    expect(rows.map((r) => r.id)).toEqual([newer, older]);
    expect(rows.map((r) => r.status)).toEqual(['failed', 'done']);
  });

  it('narrows to the asked-for kinds and nothing else', async () => {
    const hook = await seed({ kind: 'webhook', status: 'done' });
    await seed({ kind: 'email', status: 'done', action: 'submission_received' });
    await seed({ kind: 'hubspot', status: 'done' });

    const rows = await listFormDeliveries(db, ACC, FORM, {
      kinds: ['webhook'],
      statuses: ['done'],
    });
    expect(rows.map((r) => r.id)).toEqual([hook]);
  });

  it('groups booking_sync with hubspot when both are asked for', async () => {
    const crm = await seed({ kind: 'hubspot', status: 'done', updatedAt: 3_000 });
    const booking = await seed({
      kind: 'booking_sync',
      action: 'crm_update',
      status: 'failed',
      lastError: 'calendly 500',
      updatedAt: 4_000,
    });
    await seed({ kind: 'webhook', status: 'done' });

    const rows = await listFormDeliveries(db, ACC, FORM, {
      kinds: ['hubspot', 'booking_sync'],
      statuses: ['done', 'failed'],
    });
    expect(rows.map((r) => r.id)).toEqual([booking, crm]);
  });

  it('answers with nothing when the caller narrowed to nothing', async () => {
    // An empty list is a caller that asked for no kinds — never a caller who
    // meant "all of them". Widening back would be the worst possible reading:
    // a card would fill with another integration's history.
    await seed({ status: 'done' });
    expect(await listFormDeliveries(db, ACC, FORM, { kinds: [], statuses: ['done'] })).toEqual([]);
    expect(await listFormDeliveries(db, ACC, FORM, { statuses: [] })).toEqual([]);
  });

  it('keeps the account boundary while reading landed rows', async () => {
    await seed({ accountId: OTHER, status: 'done' });
    expect(
      await listFormDeliveries(db, ACC, FORM, { kinds: ['webhook'], statuses: ['done'] }),
    ).toEqual([]);
  });

  it('carries the action and attempt count the row recorded', async () => {
    await seed({ action: 'partial', status: 'failed', lastError: 'HTTP 500', attempts: 5 });
    const [row] = await listFormDeliveries(db, ACC, FORM);
    expect(row?.action).toBe('partial');
    expect(row?.attempts).toBe(5);
  });

  it('bounds the answer with limit and the work with scanLimit', async () => {
    for (let i = 0; i < 4; i++) await seed({ status: 'done', updatedAt: 2_000 + i });
    const all = await listFormDeliveries(db, ACC, FORM, { statuses: ['done'] });
    expect(all).toHaveLength(4);
    expect(await listFormDeliveries(db, ACC, FORM, { statuses: ['done'], limit: 2 })).toHaveLength(2);
    // scanLimit stops the read before the form filter ever runs, which is what
    // keeps a busy account from paging its whole history into memory.
    expect(
      await listFormDeliveries(db, ACC, FORM, { statuses: ['done'], scanLimit: 1 }),
    ).toHaveLength(1);
  });
});

/**
 * The account-wide rollup behind the integrations page's webhook inventory.
 * Same rows and same SQL-level tenant scope as the per-form view; grouped in JS
 * because the form lives in a serialized payload rather than a column.
 */
describe('summarizeFailedDeliveriesByForm', () => {
  const ACC = 'acc-1';
  const OTHER = 'acc-2';

  async function seedWebhookRow(
    accountId: string,
    formId: string,
    lastError: string,
    updatedAt: number,
    kind: 'webhook' | 'hubspot' = 'webhook',
  ) {
    const id = await enqueueOutbox(db, {
      kind,
      action: 'complete',
      accountId,
      payload: JSON.stringify({ destination: { type: kind }, ctx: { formId, accountId } }),
      now: 1_000,
    });
    await db.run(
      sql`UPDATE outbox SET status = 'failed', last_error = ${lastError}, updated_at = ${updatedAt} WHERE id = ${id}`,
    );
    return id;
  }

  it('counts per form and reports the most recent reason', async () => {
    await seedWebhookRow(ACC, 'form-1', 'older', 1_000);
    await seedWebhookRow(ACC, 'form-1', 'newest', 3_000);
    await seedWebhookRow(ACC, 'form-2', 'other form', 2_000);

    const rows = await summarizeFailedDeliveriesByForm(db, ACC, 'webhook');
    const one = rows.find((r) => r.formId === 'form-1');
    expect(one).toEqual({ formId: 'form-1', count: 2, lastError: 'newest', lastAt: 3_000 });
    expect(rows.find((r) => r.formId === 'form-2')?.count).toBe(1);
  });

  it('answers for one kind only', async () => {
    await seedWebhookRow(ACC, 'form-1', 'hubspot token expired', 2_000, 'hubspot');
    expect(await summarizeFailedDeliveriesByForm(db, ACC, 'webhook')).toEqual([]);
    expect(await summarizeFailedDeliveriesByForm(db, ACC, 'hubspot')).toHaveLength(1);
  });

  it('never reports another account', async () => {
    await seedWebhookRow(OTHER, 'form-1', 'another tenant', 2_000);
    expect(await summarizeFailedDeliveriesByForm(db, ACC, 'webhook')).toEqual([]);
  });

  it('ignores rows whose payload names no form', async () => {
    const id = await enqueueOutbox(db, {
      kind: 'webhook',
      action: 'complete',
      accountId: ACC,
      payload: 'not json',
      now: 1_000,
    });
    await db.run(sql`UPDATE outbox SET status = 'failed' WHERE id = ${id}`);
    expect(await summarizeFailedDeliveriesByForm(db, ACC, 'webhook')).toEqual([]);
  });
});
