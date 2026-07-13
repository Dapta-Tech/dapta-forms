import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, migrate, seed, sql, getAvailability, listOutbox, type Db } from '@slate/db';
import { DisabledCalendarProvider } from '@slate/calendar';
import { BookingNotifier } from '@slate/notifications';
import type { EmailMessage, EmailProvider, EmailResult } from '@slate/notifications';
import { loadServerEnv } from '@slate/config/env';
import { CalendarEffects } from './calendar-effects';
import { EmailEffects } from './email-effects';
import { BookingService } from './booking.service';

class RecordingEmailProvider implements EmailProvider {
  readonly sent: EmailMessage[] = [];
  send(m: EmailMessage): Promise<EmailResult> {
    this.sent.push(m);
    return Promise.resolve({ delivered: true, driver: 'smtp' });
  }
}

const ENV = loadServerEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

describe('reminders — scheduled via the outbox at start − lead', () => {
  let db: Db;
  let email: RecordingEmailProvider;
  let booking: BookingService;
  let effects: EmailEffects;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    const memberId = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE handle='alex-rivera'`))!.id;
    await db.run(sql`UPDATE member SET email='alex@dapta.test' WHERE id=${memberId}`);
    email = new RecordingEmailProvider();
    effects = new EmailEffects(new BookingNotifier(email), db);
    booking = new BookingService(db, ENV, new CalendarEffects(new DisabledCalendarProvider(), db), effects);
  });

  async function bookFarOut(): Promise<{ uid: string; startMs: number }> {
    // A slot ≥2 days out so BOTH the 24h and 1h leads land in the future.
    const a = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      fromMs: Date.now() + 2 * 86_400_000,
      toMs: Date.now() + 10 * 86_400_000,
    });
    const startUtc = a!.slots[0]!.startUtc;
    const out = await booking.book({
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startUtc,
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
    });
    if ('error' in out) throw new Error(`book failed: ${out.error}`);
    return { uid: out.uid, startMs: new Date(startUtc).getTime() };
  }

  const reminders = async (uid: string) =>
    (await listOutbox(db, { status: 'pending', kind: 'email' })).filter(
      (r) => r.action === 'reminder' && r.bookingUid === uid,
    );

  it('accepting a booking schedules 24h + 1h reminders at start − lead', async () => {
    const { uid, startMs } = await bookFarOut();
    await settle();
    // One row per side (attendee + host) per lead (24h + 1h) = 4.
    const rows = await reminders(uid);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => typeof row.accountId === 'string')).toBe(true);
    const dueTimes = [...new Set(rows.map((r) => r.nextAttemptAt))].sort((a, b) => a - b);
    expect(dueTimes).toEqual([startMs - 24 * 60 * 60_000, startMs - 60 * 60_000]);
    const audiences = rows.map((r) => (JSON.parse(r.payload!) as { audience?: string }).audience).sort();
    expect(audiences).toEqual(['attendee', 'attendee', 'host', 'host']);
  });

  it('a due reminder sends a "Reminder:" email (no ICS), reused email kind', async () => {
    const { uid } = await bookFarOut();
    await settle();
    // Deliver the reminder payload directly (worker executor path).
    const row = (await reminders(uid))[0]!;
    await effects.deliver('reminder', row.payload!);
    const rem = email.sent.filter((m) => m.subject.startsWith('Reminder:'));
    expect(rem).toHaveLength(1);
    expect(rem[0]!.accountId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(rem[0]!.attachments ?? []).toHaveLength(0); // no invite on a reminder
    expect(rem[0]!.text).toMatch(/starts/);
  });

  it('recovers account context for a legacy payload before HMAC delivery', async () => {
    const { uid } = await bookFarOut();
    await settle();
    const row = (await reminders(uid))[0]!;
    const legacyPayload = JSON.parse(row.payload!) as Record<string, unknown>;
    delete legacyPayload.accountId;

    await effects.deliver('reminder', JSON.stringify(legacyPayload));

    expect(email.sent[0]!.accountId).toBe(row.accountId);
  });

  it('cancelling drops the pending reminders', async () => {
    const { uid } = await bookFarOut();
    await settle();
    expect(await reminders(uid)).not.toHaveLength(0);
    const token = new URL((await effectsManageUrl(uid)) ?? 'http://x/?token=').searchParams.get('token');
    await booking.cancel(uid, { token: token ?? undefined, byHost: true });
    await settle();
    expect(await reminders(uid)).toHaveLength(0);
  });

  // Host-side cancel doesn't need the token; use byHost to bypass the token gate.
  async function effectsManageUrl(_uid: string): Promise<string | null> {
    return null;
  }
});
