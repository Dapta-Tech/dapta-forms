import { describe, it, expect, beforeEach } from 'vitest';
import { BookingNotifier, type BookingNotification } from './booking-notifier';
import type { EmailMessage, EmailProvider, EmailResult } from './email.port';

/** Captures every message the notifier sends so we can assert the matrix. */
class RecordingEmailProvider implements EmailProvider {
  readonly sent: EmailMessage[] = [];
  send(message: EmailMessage): Promise<EmailResult> {
    this.sent.push(message);
    return Promise.resolve({ delivered: true, driver: 'smtp' });
  }
}

const base: BookingNotification = {
  accountId: '11111111-1111-4111-8111-111111111111',
  uid: 'bk-123',
  title: 'Intro Call',
  startUtc: '2026-08-01T15:00:00.000Z',
  endUtc: '2026-08-01T15:30:00.000Z',
  host: { name: 'Alex Rivera', email: 'alex@example.com' },
  attendee: { name: 'Sam Guest', email: 'sam@example.com', timeZone: 'America/New_York' },
  location: 'Google Meet',
  manageUrl: 'https://app.example.com/manage/bk-123?token=tok',
  stamp: '2026-07-09T12:00:00.000Z',
};

/**
 * The notification MATRIX (event → template → recipients → ICS). This is the
 * contract the recovery backlog calls out explicitly; each row pins the subject,
 * the recipient set, and the .ics METHOD/SEQUENCE (or its absence).
 */
describe('notification matrix', () => {
  let email: RecordingEmailProvider;
  let notifier: BookingNotifier;
  beforeEach(() => {
    email = new RecordingEmailProvider();
    notifier = new BookingNotifier(email);
  });

  const only = () => {
    expect(email.sent).toHaveLength(1);
    const message = email.sent[0]!;
    expect(message.accountId).toBe(base.accountId);
    return message;
  };
  const ics = (m: EmailMessage) => String(m.attachments?.[0]?.content ?? '');
  const recipients = (m: EmailMessage) => (Array.isArray(m.to) ? m.to : [m.to]);

  it('confirmation → attendee+host, REQUEST/SEQ0, ORGANIZER + location', async () => {
    await notifier.sendConfirmation(base);
    const m = only();
    expect(recipients(m).sort()).toEqual(['alex@example.com', 'sam@example.com']);
    expect(m.subject).toMatch(/^Confirmed: Intro Call/);
    expect(m.text).toContain('Where: Google Meet');
    expect(m.text).toContain(base.manageUrl!);
    const cal = ics(m);
    expect(cal).toContain('METHOD:REQUEST');
    expect(cal).toContain('SEQUENCE:0');
    expect(cal).toContain('ORGANIZER;CN=Alex Rivera:mailto:alex@example.com');
    expect(m.attachments?.[0]?.contentType).toContain('method=REQUEST');
  });

  it('pending (requiresConfirmation) → attendee+host, NO ics, "request received"', async () => {
    await notifier.sendPendingRequest(base);
    const m = only();
    expect(recipients(m).sort()).toEqual(['alex@example.com', 'sam@example.com']);
    expect(m.subject).toMatch(/^Request received: Intro Call/);
    expect(m.text).toContain('pending confirmation');
    // B5: nothing is confirmed yet — do NOT ship a confirmed invite.
    expect(m.attachments ?? []).toHaveLength(0);
  });

  it('declined → attendee+host, NO ics, reason included', async () => {
    await notifier.sendDeclined({ ...base, cancellationReason: 'Out of office' });
    const m = only();
    expect(recipients(m).sort()).toEqual(['alex@example.com', 'sam@example.com']);
    expect(m.subject).toMatch(/^Not accepted: Intro Call/);
    expect(m.text).toContain('Reason: Out of office');
    expect(m.attachments ?? []).toHaveLength(0);
  });

  it('reschedule → attendee+host, REQUEST/SEQ1, previous time line', async () => {
    await notifier.sendReschedule({ ...base, previousStartUtc: '2026-07-30T15:00:00.000Z' });
    const m = only();
    expect(recipients(m).sort()).toEqual(['alex@example.com', 'sam@example.com']);
    expect(m.subject).toMatch(/^Rescheduled: Intro Call/);
    expect(m.text).toContain('Was:');
    const cal = ics(m);
    expect(cal).toContain('METHOD:REQUEST');
    expect(cal).toContain('SEQUENCE:1');
  });

  it('cancellation → attendee+host, CANCEL/SEQ2', async () => {
    await notifier.sendCancellation({ ...base, cancellationReason: 'no longer needed' });
    const m = only();
    expect(recipients(m).sort()).toEqual(['alex@example.com', 'sam@example.com']);
    expect(m.subject).toMatch(/^Cancelled: Intro Call/);
    expect(m.text).toContain('Reason: no longer needed');
    const cal = ics(m);
    expect(cal).toContain('METHOD:CANCEL');
    expect(cal).toContain('SEQUENCE:2');
  });

  it('recipients dedupe when the host IS the attendee', async () => {
    await notifier.sendConfirmation({
      ...base,
      host: { name: 'Self', email: 'sam@example.com' },
    });
    expect(recipients(only())).toEqual(['sam@example.com']);
  });

  it('no host email → attendee-only recipient, no ORGANIZER line', async () => {
    await notifier.sendConfirmation({ ...base, host: { name: 'Alex', email: null } });
    const m = only();
    expect(recipients(m)).toEqual(['sam@example.com']);
    expect(ics(m)).not.toContain('ORGANIZER');
  });
});
