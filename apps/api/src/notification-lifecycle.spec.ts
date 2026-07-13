import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDb,
  migrate,
  seed,
  sql,
  createEventType,
  createWebhook,
  getAvailability,
  listOutbox,
  type Db,
} from '@slate/db';
import { DisabledCalendarProvider } from '@slate/calendar';
import { BookingNotifier } from '@slate/notifications';
import type { EmailMessage, EmailProvider, EmailResult } from '@slate/notifications';
import { loadServerEnv } from '@slate/config/env';
import { CalendarEffects } from './calendar-effects';
import { EmailEffects } from './email-effects';
import { BookingService } from './booking.service';
import { AdminService } from './admin.service';
import { OutboxWorker } from './outbox.worker';

class RecordingEmailProvider implements EmailProvider {
  readonly sent: EmailMessage[] = [];
  send(message: EmailMessage): Promise<EmailResult> {
    this.sent.push(message);
    return Promise.resolve({ delivered: true, driver: 'smtp' });
  }
}

const ENV = loadServerEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
/** Let the services' void-ed fire-and-forget enqueues settle before draining. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

describe('booking lifecycle notifications (B2-B6, end-to-end via the outbox)', () => {
  let db: Db;
  let email: RecordingEmailProvider;
  let booking: BookingService;
  let admin: AdminService;
  let worker: OutboxWorker;
  let accountId: string;
  let memberId: string;
  let principal: { accountId: string; memberId: string; role: 'owner' };

  const fakeFetch = (async () => ({ ok: true, status: 200 }) as Response) as unknown as typeof fetch;

  async function firstSlotUtc(slug: string): Promise<string> {
    const a = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug,
      fromMs: Date.now(),
      toMs: Date.now() + 10 * 86_400_000,
    });
    return a!.slots[0]!.startUtc;
  }

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code='acme'`))!.id;
    memberId = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE handle='alex-rivera'`))!.id;
    // Give the host an email so the attendee+host recipient set is deterministic.
    await db.run(sql`UPDATE member SET email='alex@dapta.test' WHERE id=${memberId}`);
    principal = { accountId, memberId, role: 'owner' };

    email = new RecordingEmailProvider();
    const notifier = new BookingNotifier(email);
    const emailEffects = new EmailEffects(notifier, db);
    const calendar = new CalendarEffects(new DisabledCalendarProvider(), db);
    booking = new BookingService(db, ENV, calendar, emailEffects);
    admin = new AdminService(db, calendar, emailEffects);
    worker = new OutboxWorker(db, ENV, calendar, emailEffects);
    worker.fetchImpl = fakeFetch;
  });

  const drain = async () => {
    await settle();
    await worker.drainOnce(Date.now());
  };

  async function bookAccepted(slug = 'intro-call'): Promise<string> {
    const out = await booking.book({
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug,
      startUtc: await firstSlotUtc(slug),
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
    });
    if ('error' in out) throw new Error(`book failed: ${out.error}`);
    return out.uid;
  }

  async function pendingEvent(): Promise<string> {
    const ev = await createEventType(db, accountId, memberId, {
      slug: 'needs-confirm',
      title: 'Needs Confirm',
      lengthMinutes: 30,
      requiresConfirmation: true,
      scheduleId: null,
    });
    if (!ev.ok) throw new Error('event setup');
    return 'needs-confirm';
  }

  it('B5: accepted booking sends ONE confirmation with a REQUEST invite', async () => {
    await bookAccepted();
    await settle();
    const queuedEmail = (await listOutbox(db, { kind: 'email' })).find(
      (row) => row.action === 'confirmation',
    );
    expect(queuedEmail?.accountId).toBe(accountId);
    await worker.drainOnce(Date.now());
    const confirmations = email.sent.filter((m) => m.subject.startsWith('Confirmed:'));
    expect(confirmations).toHaveLength(1);
    expect(String(confirmations[0]!.attachments?.[0]?.content)).toContain('METHOD:REQUEST');
  });

  it('B5: pending booking sends "request received" with NO invite; confirm then sends the confirmation', async () => {
    const slug = await pendingEvent();
    const uid = await booking.book({
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug,
      startUtc: await firstSlotUtc(slug),
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'UTC' },
    });
    if ('error' in uid) throw new Error('book failed');
    await drain();
    const pending = email.sent.filter((m) => m.subject.startsWith('Request received:'));
    expect(pending).toHaveLength(1);
    expect(pending[0]!.attachments ?? []).toHaveLength(0); // no confirmed ICS while pending
    expect(email.sent.some((m) => m.subject.startsWith('Confirmed:'))).toBe(false);

    // Host confirms → NOW a confirmation email goes out.
    const conf = await admin.confirm(principal, uid.uid);
    expect(conf.ok).toBe(true);
    await drain();
    expect(email.sent.some((m) => m.subject.startsWith('Confirmed:'))).toBe(true);
  });

  it('B3: declining a pending booking notifies the attendee (+ webhook)', async () => {
    const slug = await pendingEvent();
    await createWebhook(db, {
      accountId,
      subscriberUrl: 'https://198.51.100.10/hook',
      eventTriggers: ['booking.cancelled'],
    });
    const res = await booking.book({
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug,
      startUtc: await firstSlotUtc(slug),
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'UTC' },
    });
    if ('error' in res) throw new Error('book failed');
    email.sent.length = 0; // ignore the pending mail

    const out = await admin.decline(principal, res.uid, 'slot no longer available');
    expect(out.ok).toBe(true);
    await settle();
    // A webhook delivery row was queued for the decline.
    const webhookRows = await listOutbox(db, { kind: 'webhook' });
    expect(webhookRows.length).toBeGreaterThanOrEqual(1);
    await worker.drainOnce(Date.now());
    const declined = email.sent.filter((m) => m.subject.startsWith('Not accepted:'));
    expect(declined).toHaveLength(1);
    const to = Array.isArray(declined[0]!.to) ? declined[0]!.to : [declined[0]!.to];
    expect(to).toContain('sam@example.com'); // attendee always; host copied too
  });

  it('B2: host-dashboard cancel emails the attendee (+host) and fires the webhook', async () => {
    await createWebhook(db, {
      accountId,
      subscriberUrl: 'https://198.51.100.10/hook',
      eventTriggers: ['booking.cancelled'],
    });
    const uid = await bookAccepted();
    email.sent.length = 0;
    const out = await admin.hostCancel(principal, uid, 'host is out');
    expect(out.ok).toBe(true);
    await settle();
    expect((await listOutbox(db, { kind: 'webhook' })).length).toBeGreaterThanOrEqual(1);
    await worker.drainOnce(Date.now());
    // Per-side messages: the attendee and the host each get their own copy
    // (separately toggleable in Settings → Notifications).
    const cancels = email.sent.filter((m) => m.subject.startsWith('Cancelled:'));
    expect(cancels).toHaveLength(2);
    const allTo = cancels.flatMap((m) => (Array.isArray(m.to) ? m.to : [m.to]));
    expect(allTo.sort()).toEqual(['alex@dapta.test', 'sam@example.com']);
  });

  it('B4: team booking returns a manage link AND sends a confirmation email', async () => {
    const teamAvail = await booking.teamAvailability(
      'acme',
      'sales',
      'team-demo',
      new Date().toISOString(),
      new Date(Date.now() + 10 * 86_400_000).toISOString(),
    );
    const slot = teamAvail!.slots[0]!.startUtc;

    const out = await booking.teamBook('acme', 'sales', {
      slug: 'team-demo',
      startUtc: slot,
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'UTC' },
    });
    if ('error' in out) throw new Error(`teamBook failed: ${out.error}`);
    expect(out.manageUrl).toBeTruthy(); // B4: token no longer discarded
    await drain();
    const confs = email.sent.filter((m) => m.subject.startsWith('Confirmed:'));
    expect(confs).toHaveLength(1);
    expect(confs[0]!.text).toContain(out.manageUrl!);
  });

  it('B6: reschedule to the past / off-hours is rejected (INVALID_SLOT 400)', async () => {
    const uid = await bookAccepted();
    // Into the past.
    const past = await booking.reschedule(uid, { newStartUtc: '2020-01-01T10:00:00.000Z', byHost: true });
    expect('error' in past && past.status).toBe(400);
    if ('error' in past) expect(past.error).toBe('INVALID_SLOT');
    // 3 AM on the target day is outside the seeded 9-17 schedule.
    const bad = await booking.reschedule(uid, { newStartUtc: '2099-06-01T03:00:00.000Z', byHost: true });
    expect('error' in bad && bad.error).toBe('INVALID_SLOT');
  });

  it('B6: reschedule to a real available slot succeeds', async () => {
    const uid = await bookAccepted();
    // A different real slot ≥ 2 days out (avoids min-notice + the original slot).
    const slots = (await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      fromMs: Date.now() + 2 * 86_400_000,
      toMs: Date.now() + 6 * 86_400_000,
    }))!.slots;
    const target = slots[0]!.startUtc;
    const out = await booking.reschedule(uid, { newStartUtc: target, byHost: true });
    expect('error' in out).toBe(false);
    if (!('error' in out)) expect(out.startUtc).toBe(target);
  });

  it('P1-1: a retried cancel succeeds AND does not send a second cancellation email', async () => {
    const uid = await bookAccepted();
    email.sent.length = 0;
    expect((await admin.hostCancel(principal, uid, 'x')).ok).toBe(true);
    await drain();
    // One attendee copy + one host copy.
    expect(email.sent.filter((m) => m.subject.startsWith('Cancelled:'))).toHaveLength(2);
    // Retry — succeeds (not 410) and enqueues NO second email.
    expect((await admin.hostCancel(principal, uid, 'x')).ok).toBe(true);
    await drain();
    expect(email.sent.filter((m) => m.subject.startsWith('Cancelled:'))).toHaveLength(2);
  });

  it('P1-2: a reschedule retried with the same Idempotency-Key sends no second email', async () => {
    const uid = await bookAccepted();
    const target = (await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      fromMs: Date.now() + 2 * 86_400_000,
      toMs: Date.now() + 6 * 86_400_000,
    }))!.slots[0]!.startUtc;
    email.sent.length = 0;
    await booking.reschedule(uid, { newStartUtc: target, byHost: true, idempotencyKey: 'RK' });
    await drain();
    // One attendee copy + one host copy.
    expect(email.sent.filter((m) => m.subject.startsWith('Rescheduled:'))).toHaveLength(2);
    // Replay with the same key → dedup, no second reschedule email.
    await booking.reschedule(uid, { newStartUtc: target, byHost: true, idempotencyKey: 'RK' });
    await drain();
    expect(email.sent.filter((m) => m.subject.startsWith('Rescheduled:'))).toHaveLength(2);
  });
});
