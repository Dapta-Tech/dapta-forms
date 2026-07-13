import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDb,
  migrate,
  seed,
  sql,
  getAvailability,
  listOutbox,
  enqueueOutbox,
  loadBookingNotificationContext,
  upsertNotificationSetting,
  type Db,
} from '@slate/db';
import { DisabledCalendarProvider } from '@slate/calendar';
import { BookingNotifier } from '@slate/notifications';
import type { EmailMessage, EmailProvider, EmailResult } from '@slate/notifications';
import { loadServerEnv } from '@slate/config/env';
import { AdminService } from './admin.service';
import { CalendarEffects } from './calendar-effects';
import { EmailEffects, OutboxSkipError } from './email-effects';
import { OutboxWorker } from './outbox.worker';
import { BookingService } from './booking.service';
import type { HostPrincipal } from './auth.service';

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

/**
 * Settings → Notifications wire-through: per-side toggles gate the outbox at
 * ENQUEUE time, custom templates render into the delivered mail, and queued
 * reminders are re-gated at DELIVER time.
 */
describe('notification settings — toggles + templates through the outbox', () => {
  let db: Db;
  let email: RecordingEmailProvider;
  let booking: BookingService;
  let effects: EmailEffects;
  let admin: AdminService;
  let accountId: string;
  let principal: HostPrincipal;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    const member = (await db.get<{ id: string; account_id: string }>(
      sql`SELECT id, account_id FROM member WHERE handle='alex-rivera'`,
    ))!;
    await db.run(sql`UPDATE member SET email='alex@dapta.test', role='owner' WHERE id=${member.id}`);
    accountId = member.account_id;
    principal = { accountId, memberId: member.id, role: 'owner' };
    email = new RecordingEmailProvider();
    effects = new EmailEffects(new BookingNotifier(email), db, undefined, ENV);
    const calendar = new CalendarEffects(new DisabledCalendarProvider(), db);
    booking = new BookingService(db, ENV, calendar, effects);
    admin = new AdminService(db, calendar, effects);
  });

  async function book(): Promise<string> {
    const a = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      fromMs: Date.now() + 2 * 86_400_000,
      toMs: Date.now() + 10 * 86_400_000,
    });
    const out = await booking.book({
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startUtc: a!.slots[0]!.startUtc,
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
    });
    if ('error' in out) throw new Error(`book failed: ${out.error}`);
    return out.uid;
  }

  const emailRows = async (uid: string, action: string) =>
    (await listOutbox(db, { kind: 'email', bookingUid: uid })).filter((r) => r.action === action);

  it('booking enqueues one confirmation row per side with resolved templates', async () => {
    const uid = await book();
    await settle();
    const rows = await emailRows(uid, 'confirmation');
    expect(rows).toHaveLength(2);
    const payloads = rows.map((r) => JSON.parse(r.payload!) as { audience: string; template?: { subject: string } });
    expect(payloads.map((p) => p.audience).sort()).toEqual(['attendee', 'host']);
    for (const p of payloads) expect(p.template?.subject).toBeTruthy();
  });

  it('a disabled side is NOT enqueued (no misleading delivery-log rows)', async () => {
    await upsertNotificationSetting(db, accountId, 'host_booked', { enabled: false });
    const uid = await book();
    await settle();
    const rows = await emailRows(uid, 'confirmation');
    expect(rows).toHaveLength(1);
    expect((JSON.parse(rows[0]!.payload!) as { audience: string }).audience).toBe('attendee');
  });

  it('a custom template renders into the delivered mail (variables + escaping)', async () => {
    await upsertNotificationSetting(db, accountId, 'attendee_confirmation', {
      subject: 'See you, {{attendee_name}}!',
      body: 'Booked <b>{{event_title}}</b> — {{start_time}}',
    });
    const uid = await book();
    await settle();
    const row = (await emailRows(uid, 'confirmation')).find(
      (r) => (JSON.parse(r.payload!) as { audience: string }).audience === 'attendee',
    )!;
    await effects.deliver('confirmation', row.payload!, row.accountId);
    const m = email.sent.at(-1)!;
    expect(m.subject).toBe('See you, Sam!');
    expect(m.text).toContain('Booked <b>Intro Call</b>');
    expect(m.html).toContain('&lt;b&gt;Intro Call&lt;/b&gt;'); // template markup escaped
    expect(m.to).toEqual(['sam@example.com']); // attendee side only
  });

  it('reminder leads come from settings; disabled reminder side is not scheduled', async () => {
    await upsertNotificationSetting(db, accountId, 'attendee_reminder', { reminderLeadMinutes: [120] });
    await upsertNotificationSetting(db, accountId, 'host_reminder', { enabled: false });
    const uid = await book();
    await settle();
    const rows = await emailRows(uid, 'reminder');
    expect(rows).toHaveLength(1); // one lead × attendee side only
    const p = JSON.parse(rows[0]!.payload!) as { audience: string; reminderLeadMinutes: number };
    expect(p.audience).toBe('attendee');
    expect(p.reminderLeadMinutes).toBe(120);
  });

  it('a queued reminder is re-gated at deliver time (toggle OFF after scheduling)', async () => {
    const uid = await book();
    await settle();
    const row = (await emailRows(uid, 'reminder')).find(
      (r) => (JSON.parse(r.payload!) as { audience?: string }).audience === 'attendee',
    )!;
    // Flip OFF after the row was scheduled — delivery must silently skip.
    await upsertNotificationSetting(db, accountId, 'attendee_reminder', { enabled: false });
    await effects.deliver('reminder', row.payload!, row.accountId);
    expect(email.sent.filter((m) => m.subject.startsWith('Reminder:'))).toHaveLength(0);
  });

  it('host-dashboard cancel drops the still-pending reminders', async () => {
    const uid = await book();
    await settle();
    const pending = (await emailRows(uid, 'reminder')).filter((r) => r.status === 'pending');
    expect(pending.length).toBeGreaterThan(0);
    await admin.hostCancel(principal, uid, 'host is out');
    await settle();
    expect((await emailRows(uid, 'reminder')).filter((r) => r.status === 'pending')).toHaveLength(0);
  });

  it('declined fans out to BOTH sides; host_declined toggle silences only the host copy', async () => {
    const uid = await book();
    await settle();
    await effects.enqueueDeclined(uid, { reason: 'nope' });
    const rows = await emailRows(uid, 'declined');
    expect(rows).toHaveLength(2);
    const payloads = rows.map((r) => JSON.parse(r.payload!) as { audience: string; template?: { subject: string } });
    expect(payloads.map((p) => p.audience).sort()).toEqual(['attendee', 'host']);
    const host = payloads.find((p) => p.audience === 'host')!;
    expect(host.template?.subject).toContain('Declined:');

    // host_declined OFF → attendee copy only.
    await upsertNotificationSetting(db, accountId, 'host_declined', { enabled: false });
    const uid2 = await book();
    await settle();
    await effects.enqueueDeclined(uid2, { reason: 'nope' });
    const rows2 = await emailRows(uid2, 'declined');
    expect(rows2).toHaveLength(1);
    expect((JSON.parse(rows2[0]!.payload!) as { audience: string }).audience).toBe('attendee');
  });

  it('legacy audience-less reminder rows send while EITHER reminder toggle is ON', async () => {
    const uid = await book();
    await settle();
    const row = (await emailRows(uid, 'reminder'))[0]!;
    const legacy = JSON.parse(row.payload!) as Record<string, unknown>;
    delete legacy.audience; // pre-split rows mailed attendee+host combined
    delete legacy.template;

    // attendee OFF but host ON → the combined mail still goes (host must not
    // be silenced by the attendee toggle).
    await upsertNotificationSetting(db, accountId, 'attendee_reminder', { enabled: false });
    await effects.deliver('reminder', JSON.stringify(legacy), row.accountId);
    expect(email.sent.filter((m) => m.subject.startsWith('Reminder:'))).toHaveLength(1);

    // BOTH off → skipped.
    await upsertNotificationSetting(db, accountId, 'host_reminder', { enabled: false });
    await effects.deliver('reminder', JSON.stringify(legacy), row.accountId);
    expect(email.sent.filter((m) => m.subject.startsWith('Reminder:'))).toHaveLength(1);
  });

  it('legacy row without recoverable accountId: delivered on plain transports, skipped-once on the signed wire', async () => {
    const uid = await book();
    await settle();
    const row = (await emailRows(uid, 'confirmation')).find(
      (r) => (JSON.parse(r.payload!) as { audience: string }).audience === 'attendee',
    )!;
    const orphan = JSON.parse(row.payload!) as Record<string, unknown>;
    delete orphan.accountId;
    delete orphan.uid; // booking gone too — context unrecoverable

    // Plain transport (no requiresAccountContext): deliver anyway.
    await effects.deliver('confirmation', JSON.stringify(orphan), null);
    expect(email.sent.length).toBeGreaterThan(0);

    // Signed transport: OutboxSkipError → worker marks the row skipped ONCE
    // with the reason; the retry schedule is never burned.
    const signedProvider: EmailProvider = {
      requiresAccountContext: true,
      send: () => Promise.resolve({ delivered: true, driver: 'http' as const }),
    };
    const signedEffects = new EmailEffects(new BookingNotifier(signedProvider), db, signedProvider);
    await expect(signedEffects.deliver('confirmation', JSON.stringify(orphan), null)).rejects.toThrow(
      OutboxSkipError,
    );

    const rowId = await enqueueOutbox(db, {
      kind: 'email',
      action: 'confirmation',
      accountId: null,
      payload: JSON.stringify(orphan),
      now: 1000,
    });
    const worker = new OutboxWorker(
      db,
      ENV,
      new CalendarEffects(new DisabledCalendarProvider(), db),
      signedEffects,
    );
    await worker.drainOnce(2000);
    const after = (await listOutbox(db, { kind: 'email' })).find((r) => r.id === rowId)!;
    expect(after.status).toBe('skipped');
    expect(after.attempts).toBe(0); // decision, not a failure — no retries burned
    expect(after.lastError).toContain('missing account context');
    // A later drain does not resurrect it.
    await worker.drainOnce(3000);
    expect(((await listOutbox(db, { kind: 'email' })).find((r) => r.id === rowId))!.status).toBe('skipped');
  });

  it('listNotificationSettings returns the full catalog with defaults + overrides', async () => {
    await upsertNotificationSetting(db, accountId, 'attendee_cancellation', {
      enabled: false,
      subject: 'Bye',
    });
    const out = await admin.listNotificationSettings(principal);
    expect(out.settings).toHaveLength(12);
    // follow_up is the one OPT-IN key: absent row reads back DISABLED, with
    // its own default lead (after end) exposed for the editor.
    const followUp = out.settings.find((s) => s.key === 'follow_up')!;
    expect(followUp.enabled).toBe(false);
    expect(followUp.reminderLeadMinutes).toEqual([60]);
    expect(out.variables).toContain('attendee_name');
    const cancel = out.settings.find((s) => s.key === 'attendee_cancellation')!;
    expect(cancel.enabled).toBe(false);
    expect(cancel.subject).toBe('Bye');
    expect(cancel.customized).toBe(true);
    expect(cancel.defaultSubject).toContain('Cancelled:');
    const conf = out.settings.find((s) => s.key === 'attendee_confirmation')!;
    expect(conf.enabled).toBe(true);
    expect(conf.customized).toBe(false);
    const rem = out.settings.find((s) => s.key === 'attendee_reminder')!;
    expect(rem.reminderLeadMinutes).toEqual([1440, 60]);
  });

  // --- Post-meeting follow-up (v1.5) — mirrors the reminders pattern -------

  it('follow-up is OPT-IN: no rows by default; enabling schedules end + lead', async () => {
    const uid = await book();
    await settle();
    expect(await emailRows(uid, 'follow_up')).toHaveLength(0); // default OFF
    expect((await emailRows(uid, 'reminder')).length).toBeGreaterThan(0); // reminders unaffected

    await upsertNotificationSetting(db, accountId, 'follow_up', { enabled: true });
    const uid2 = await book();
    await settle();
    const rows = await emailRows(uid2, 'follow_up');
    expect(rows).toHaveLength(1);
    const endMs = new Date(
      (await loadBookingNotificationContext(db, uid2))!.endUtc,
    ).getTime();
    expect(rows[0]!.nextAttemptAt).toBe(endMs + 60 * 60_000); // default +1h after end
    const payload = JSON.parse(rows[0]!.payload!) as {
      audience: string;
      bookingLink?: string;
      template?: { subject: string };
      reminderLeadMinutes: number;
    };
    expect(payload.audience).toBe('attendee');
    expect(payload.reminderLeadMinutes).toBe(60);
    expect(payload.template?.subject).toContain('Thanks for meeting');
    expect(payload.bookingLink).toContain('/acme/alex-rivera/intro-call');
  });

  it('follow-up lead is editable (like reminders) and drives next_attempt_at', async () => {
    await upsertNotificationSetting(db, accountId, 'follow_up', {
      enabled: true,
      reminderLeadMinutes: [120],
    });
    const uid = await book();
    await settle();
    const rows = await emailRows(uid, 'follow_up');
    expect(rows).toHaveLength(1);
    const endMs = new Date((await loadBookingNotificationContext(db, uid))!.endUtc).getTime();
    expect(rows[0]!.nextAttemptAt).toBe(endMs + 120 * 60_000);
  });

  it('reschedule re-points the follow-up to the new end time', async () => {
    await upsertNotificationSetting(db, accountId, 'follow_up', { enabled: true });
    const uid = await book();
    await settle();
    const before = (await emailRows(uid, 'follow_up'))[0]!;

    const a = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      fromMs: Date.now() + 4 * 86_400_000,
      toMs: Date.now() + 10 * 86_400_000,
    });
    const target = a!.slots[5]!.startUtc;
    const out = await booking.reschedule(uid, { newStartUtc: target, byHost: true });
    expect('error' in out).toBe(false);
    await settle();
    const after = (await emailRows(uid, 'follow_up')).filter((r) => r.status === 'pending');
    expect(after).toHaveLength(1);
    const newEndMs = new Date((await loadBookingNotificationContext(db, uid))!.endUtc).getTime();
    expect(after[0]!.nextAttemptAt).toBe(newEndMs + 60 * 60_000);
    expect(after[0]!.nextAttemptAt).not.toBe(before.nextAttemptAt);
  });

  it('cancel deletes the pending follow-up', async () => {
    await upsertNotificationSetting(db, accountId, 'follow_up', { enabled: true });
    const uid = await book();
    await settle();
    expect((await emailRows(uid, 'follow_up')).filter((r) => r.status === 'pending')).toHaveLength(1);
    await admin.hostCancel(principal, uid, 'gone');
    await settle();
    expect((await emailRows(uid, 'follow_up')).filter((r) => r.status === 'pending')).toHaveLength(0);
  });

  it('a queued follow-up is re-gated at deliver time (toggle OFF after scheduling)', async () => {
    await upsertNotificationSetting(db, accountId, 'follow_up', { enabled: true });
    const uid = await book();
    await settle();
    const row = (await emailRows(uid, 'follow_up'))[0]!;
    await upsertNotificationSetting(db, accountId, 'follow_up', { enabled: false });
    await effects.deliver('follow_up', row.payload!, row.accountId);
    expect(email.sent.filter((m) => m.subject.startsWith('Thanks for meeting'))).toHaveLength(0);

    // Re-enable → the (still pending) payload delivers with the book-again link.
    await upsertNotificationSetting(db, accountId, 'follow_up', { enabled: true });
    await effects.deliver('follow_up', row.payload!, row.accountId);
    const sent = email.sent.filter((m) => m.subject.startsWith('Thanks for meeting'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(['sam@example.com']);
    expect(sent[0]!.text).toContain('/acme/alex-rivera/intro-call');
    expect(sent[0]!.attachments ?? []).toHaveLength(0); // no invite on a follow-up
  });

  it('preview renders sample data and flags unknown tokens; reset restores defaults', async () => {
    const preview = await admin.previewNotificationTemplate(principal, 'attendee_confirmation', {
      subject: 'Yo {{attendee_name}} {{bogus_token}}',
      body: null,
    });
    expect(preview.subject).toMatch(/^Yo /);
    expect(preview.unknownTokens).toEqual(['bogus_token']);
    expect(preview.text.length).toBeGreaterThan(0);

    await upsertNotificationSetting(db, accountId, 'attendee_confirmation', { subject: 'X', body: 'Y' });
    const reset = await admin.resetNotificationTemplate(principal, 'attendee_confirmation');
    expect(reset.subject).toBeNull();
    expect(reset.body).toBeNull();
  });
});
