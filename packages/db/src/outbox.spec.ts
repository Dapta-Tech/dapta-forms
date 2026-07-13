import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import {
  backoffMs,
  claimDueOutbox,
  countOutbox,
  enqueueOutbox,
  listOutbox,
  markOutboxDone,
  markOutboxFailed,
  markOutboxRetry,
} from './outbox';

describe('outbox — durable side-effect queue (B7/DM1)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
  });

  it('enqueue → claimDue returns the row once it is due', async () => {
    await enqueueOutbox(db, { kind: 'calendar', action: 'create', bookingUid: 'bk-1', now: 1000 });
    // Not yet due.
    expect(await claimDueOutbox(db, 999)).toHaveLength(0);
    // Due.
    const due = await claimDueOutbox(db, 1000);
    expect(due).toHaveLength(1);
    expect(due[0]!.kind).toBe('calendar');
    expect(due[0]!.action).toBe('create');
    expect(due[0]!.bookingUid).toBe('bk-1');
    expect(due[0]!.status).toBe('pending');
    expect(due[0]!.attempts).toBe(0);
  });

  it('markDone removes a row from the due set', async () => {
    const id = await enqueueOutbox(db, { kind: 'webhook', action: 'booking.created', webhookId: 'w1', payload: '{}', now: 0 });
    await markOutboxDone(db, id, 5);
    expect(await claimDueOutbox(db, 10)).toHaveLength(0);
    expect(await countOutbox(db, 'done')).toBe(1);
    expect(await countOutbox(db, 'pending')).toBe(0);
  });

  it('markRetry bumps attempts, records the error, and reschedules with backoff', async () => {
    const id = await enqueueOutbox(db, { kind: 'calendar', action: 'create', bookingUid: 'bk-1', now: 0 });
    await markOutboxRetry(db, id, { attempts: 1, error: 'boom', now: 100 });
    // Still pending but not due until now + backoff(1) = 100 + 1000.
    expect(await claimDueOutbox(db, 100)).toHaveLength(0);
    const due = await claimDueOutbox(db, 100 + backoffMs(1));
    expect(due).toHaveLength(1);
    expect(due[0]!.attempts).toBe(1);
    expect(due[0]!.lastError).toBe('boom');
  });

  it('markFailed is terminal — never re-served, kept as the log', async () => {
    const id = await enqueueOutbox(db, { kind: 'webhook', action: 'x', webhookId: 'w', payload: '{}', now: 0 });
    await markOutboxFailed(db, id, { attempts: 5, error: 'gave up', now: 10 });
    expect(await claimDueOutbox(db, 1_000_000)).toHaveLength(0);
    const failed = await listOutbox(db, { status: 'failed' });
    expect(failed).toHaveLength(1);
    expect(failed[0]!.lastError).toBe('gave up');
    expect(failed[0]!.attempts).toBe(5);
  });

  it('backoffMs is exponential and capped at 5 minutes', () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(3)).toBe(4000);
    expect(backoffMs(100)).toBe(5 * 60_000);
  });

  it('claimDue returns oldest-due first', async () => {
    await enqueueOutbox(db, { kind: 'calendar', action: 'create', bookingUid: 'b', now: 300 });
    await enqueueOutbox(db, { kind: 'calendar', action: 'delete', bookingUid: 'a', now: 100 });
    const due = await claimDueOutbox(db, 1000);
    expect(due.map((r) => r.action)).toEqual(['delete', 'create']);
  });
});
