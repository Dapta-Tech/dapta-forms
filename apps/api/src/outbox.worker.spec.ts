import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  createDb,
  migrate,
  seed,
  sql,
  createBooking,
  createWebhook,
  getAvailability,
  enqueueOutbox,
  listOutbox,
  countOutbox,
  backoffMs,
  type Db,
} from '@slate/db';
import type {
  CalendarProvider,
  CreateEventInput,
  CreatedEvent,
  DeleteEventInput,
  UpdateEventInput,
} from '@slate/calendar';
import { loadServerEnv } from '@slate/config/env';
import { BookingNotifier, NoopEmailProvider, type EmailProvider, type EmailResult } from '@slate/notifications';
import { CalendarEffects } from './calendar-effects';
import { EmailEffects } from './email-effects';
import { OutboxWorker } from './outbox.worker';

/** An EmailEffects backed by the silent noop provider (worker calendar/webhook tests don't assert email). */
function makeEmailEffects(db: Db): EmailEffects {
  return new EmailEffects(new BookingNotifier(new NoopEmailProvider()), db);
}

/** A calendar provider whose createEvent fails a controllable number of times. */
class FlakyCalendarProvider implements CalendarProvider {
  readonly enabled = true;
  readonly created: CreateEventInput[] = [];
  readonly deleted: DeleteEventInput[] = [];
  failuresRemaining: number;
  private seq = 0;
  constructor(failuresRemaining = 0) {
    this.failuresRemaining = failuresRemaining;
  }
  listBusy(): Promise<[]> {
    return Promise.resolve([]);
  }
  createEvent(input: CreateEventInput): Promise<CreatedEvent> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      return Promise.reject(new Error('vendor 503'));
    }
    this.created.push(input);
    return Promise.resolve({ externalEventId: `evt-${++this.seq}`, meetingUrl: null });
  }
  updateEvent(input: UpdateEventInput): Promise<CreatedEvent> {
    return Promise.resolve({ externalEventId: input.externalEventId, meetingUrl: null });
  }
  deleteEvent(input: DeleteEventInput): Promise<void> {
    this.deleted.push(input);
    return Promise.resolve();
  }
  listCalendars(): Promise<[]> {
    return Promise.resolve([]);
  }
  checkConnection(): Promise<{ ok: boolean; detail: string }> {
    return Promise.resolve({ ok: true, detail: 'Connected' });
  }
}

const ENV = loadServerEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);

describe('OutboxWorker — durable drain with retry/backoff (B7/DM1)', () => {
  let db: Db;
  let accountId: string;
  let memberId: string;
  const CAL_REF = 'cal-dest-1';

  async function bookFirstSlot(): Promise<string> {
    const avail = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      fromMs: Date.now(),
      toMs: Date.now() + 10 * 86_400_000,
    });
    const startMs = new Date(avail!.slots[0]!.startUtc).getTime();
    const booked = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs,
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
    });
    if (!booked.ok) throw new Error('seed booking failed');
    return booked.booking.uid;
  }

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme'`))!.id;
    memberId = (await db.get<{ id: string }>(
      sql`SELECT id FROM member WHERE handle = 'alex-rivera'`,
    ))!.id;
    await db.run(
      sql`INSERT INTO connected_calendar
            (id, account_id, member_id, provider, external_id, primary_email,
             is_destination, check_conflicts, created_at)
          VALUES (${randomUUID()}, ${accountId}, ${memberId}, 'google', ${CAL_REF}, ${null},
             1, 1, ${Date.now()})`,
    );
  });

  it('retries a failing calendar write and eventually succeeds (no silent loss)', async () => {
    const provider = new FlakyCalendarProvider(1); // fail once, then succeed
    const effects = new CalendarEffects(provider, db);
    const worker = new OutboxWorker(db, ENV, effects, makeEmailEffects(db));
    const uid = await bookFirstSlot();

    await enqueueOutbox(db, { kind: 'calendar', action: 'create', bookingUid: uid, now: 0 });

    // First drain: createEvent throws → row rescheduled (still pending), nothing written.
    await worker.drainOnce(0);
    expect(provider.created).toHaveLength(0);
    const afterFail = await listOutbox(db, { kind: 'calendar' });
    expect(afterFail[0]!.status).toBe('pending');
    expect(afterFail[0]!.attempts).toBe(1);
    expect(afterFail[0]!.lastError).toContain('vendor 503');

    // Second drain once the backoff has elapsed: succeeds → done, event written ONCE.
    await worker.drainOnce(backoffMs(1) + 1);
    expect(provider.created).toHaveLength(1);
    expect(await countOutbox(db, 'done')).toBe(1);
    expect(await countOutbox(db, 'pending')).toBe(0);

    const refs = await db.all(
      sql`SELECT br.id FROM booking_reference br JOIN booking b ON b.id = br.booking_id
          WHERE b.uid = ${uid} AND br.external_event_id IS NOT NULL`,
    );
    expect(refs).toHaveLength(1);
  });

  it('a duplicate-enqueued calendar job does NOT double-create the remote event (DH1)', async () => {
    const provider = new FlakyCalendarProvider(0); // always succeeds
    const effects = new CalendarEffects(provider, db);
    const worker = new OutboxWorker(db, ENV, effects, makeEmailEffects(db));
    const uid = await bookFirstSlot();

    // Two rows for the same booking (e.g. a retry that also got re-enqueued).
    await enqueueOutbox(db, { kind: 'calendar', action: 'create', bookingUid: uid, now: 0 });
    await enqueueOutbox(db, { kind: 'calendar', action: 'create', bookingUid: uid, now: 0 });

    await worker.drainOnce(0);

    // Both rows resolve, but the DH1 claim means createEvent ran exactly once.
    expect(provider.created).toHaveLength(1);
    expect(await countOutbox(db, 'done')).toBe(2);
    const refs = await db.all(
      sql`SELECT br.id FROM booking_reference br JOIN booking b ON b.id = br.booking_id
          WHERE b.uid = ${uid} AND br.destination = ${CAL_REF}`,
    );
    expect(refs).toHaveLength(1);
  });

  it('gives up after max attempts and logs, leaving the row as a failed delivery-log entry', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const provider = new FlakyCalendarProvider(0);
      const effects = new CalendarEffects(provider, db);
      const worker = new OutboxWorker(db, ENV, effects, makeEmailEffects(db));
      // A real, active subscriber (public IP literal → SSRF guard passes offline).
      const wh = await createWebhook(db, {
        accountId,
        subscriberUrl: 'https://198.51.100.10/hook',
        eventTriggers: ['booking.created'],
      });
      // Delivery always fails.
      worker.fetchImpl = (async () => {
        throw new Error('connect ECONNREFUSED');
      }) as unknown as typeof fetch;

      await enqueueOutbox(db, {
        kind: 'webhook',
        action: 'booking.created',
        accountId,
        webhookId: wh.id,
        payload: JSON.stringify({ event: 'booking.created', data: { uid: 'x' } }),
        maxAttempts: 2,
        now: 0,
      });

      // Attempt 1 → retry.
      await worker.drainOnce(0);
      expect(await countOutbox(db, 'pending')).toBe(1);
      // Attempt 2 (after backoff) → give up.
      await worker.drainOnce(backoffMs(1) + 1);

      const failed = await listOutbox(db, { status: 'failed' });
      expect(failed).toHaveLength(1);
      expect(failed[0]!.attempts).toBe(2);
      expect(failed[0]!.lastError).toContain('ECONNREFUSED');
      expect(await countOutbox(db, 'pending')).toBe(0);
      // It logged: a warn on the retry, an error on giving up.
      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('delivers a webhook successfully via the outbox and marks it done', async () => {
    const provider = new FlakyCalendarProvider(0);
    const effects = new CalendarEffects(provider, db);
    const worker = new OutboxWorker(db, ENV, effects, makeEmailEffects(db));
    const wh = await createWebhook(db, {
      accountId,
      subscriberUrl: 'https://198.51.100.10/hook',
      eventTriggers: ['booking.created'],
      secret: 's3cret',
    });
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    worker.fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;

    await enqueueOutbox(db, {
      kind: 'webhook',
      action: 'booking.created',
      accountId,
      webhookId: wh.id,
      payload: JSON.stringify({ event: 'booking.created', data: { uid: 'abc' } }),
      now: 0,
    });

    await worker.drainOnce(0);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers['X-Slate-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(await countOutbox(db, 'done')).toBe(1);
  });

  it('a webhook that returns non-2xx is retried (treated as a failure)', async () => {
    const provider = new FlakyCalendarProvider(0);
    const effects = new CalendarEffects(provider, db);
    const worker = new OutboxWorker(db, ENV, effects, makeEmailEffects(db));
    const wh = await createWebhook(db, {
      accountId,
      subscriberUrl: 'https://198.51.100.10/hook',
      eventTriggers: ['booking.created'],
    });
    worker.fetchImpl = (async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch;

    await enqueueOutbox(db, {
      kind: 'webhook',
      action: 'booking.created',
      accountId,
      webhookId: wh.id,
      payload: JSON.stringify({ event: 'booking.created', data: {} }),
      now: 0,
    });
    await worker.drainOnce(0);
    const row = (await listOutbox(db, { kind: 'webhook' }))[0]!;
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('HTTP 500');
  });

  it('B1: a failing email (SMTP blip) is retried, then delivered — never silently lost', async () => {
    // A provider that throws once (transient SMTP error) then succeeds. A THROW
    // is the retry signal; log-only's delivered:false would be a success no-op.
    let failuresRemaining = 1;
    const flakyEmail: EmailProvider = {
      send(): Promise<EmailResult> {
        if (failuresRemaining > 0) {
          failuresRemaining--;
          return Promise.reject(new Error('smtp 421 try again'));
        }
        return Promise.resolve({ delivered: true, driver: 'smtp' });
      },
    };
    const effects = new CalendarEffects(new FlakyCalendarProvider(0), db);
    const emailEffects = new EmailEffects(new BookingNotifier(flakyEmail), db);
    const worker = new OutboxWorker(db, ENV, effects, emailEffects);

    const notification = {
      accountId,
      uid: 'bk-x',
      title: 'Intro',
      startUtc: '2026-08-01T15:00:00.000Z',
      endUtc: '2026-08-01T15:30:00.000Z',
      host: { name: 'Alex', email: 'alex@example.com' },
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'UTC' },
    };
    await enqueueOutbox(db, {
      kind: 'email',
      action: 'confirmation',
      bookingUid: 'bk-x',
      accountId,
      payload: JSON.stringify(notification),
      now: 0,
    });

    // First drain: send throws → row stays pending (retry scheduled).
    await worker.drainOnce(0);
    const afterFail = (await listOutbox(db, { kind: 'email' }))[0]!;
    expect(afterFail.status).toBe('pending');
    expect(afterFail.attempts).toBe(1);
    expect(afterFail.lastError).toContain('smtp 421');

    // Second drain after backoff: succeeds → done (no silent loss).
    await worker.drainOnce(backoffMs(1) + 1);
    expect(await countOutbox(db, 'done')).toBe(1);
    expect(await countOutbox(db, 'pending')).toBe(0);
  });
});
