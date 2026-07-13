import type { EmailProvider, EmailResult } from './email.port';
import { buildIcs, icsContentType } from './ics';
import { escapeHtml } from './util';
import {
  renderTemplate,
  templateVars,
  type EmailTemplate,
  type RenderedEmail,
  type TemplateLocale,
  formatWhen,
} from './templates';

/** Render plaintext lines to a safe HTML body — every line HTML-escaped (E8). */
function htmlBody(lines: string[]): string {
  return `<p>${lines.map(escapeHtml).join('<br/>')}</p>`;
}

/** Everything a booking notification needs to render, provider-agnostic. */
export interface BookingNotification {
  accountId: string;
  uid: string;
  title: string;
  startUtc: string;
  endUtc: string;
  host: { name?: string | null; email?: string | null };
  /** Additional assigned hosts (collective / fixed_round_robin) — also notified. */
  coHosts?: Array<{ name?: string | null; email?: string | null }>;
  attendee: { name: string; email: string; timeZone?: string | null };
  location?: string | null;
  manageUrl?: string | null;
  cancellationReason?: string | null;
  previousStartUtc?: string | null;
  /** DTSTAMP for the .ics (injected for determinism). Defaults to startUtc. */
  stamp?: string;
  /**
   * Which side this message is for: `attendee` → attendee only; `host` → host +
   * co-hosts (deduped, `:host`-suffixed idempotency key). ABSENT = legacy: one
   * message to everyone with the attendee copy — pre-toggle callers and forks
   * that construct notifications directly keep today's behavior.
   */
  audience?: 'attendee' | 'host';
  /**
   * Resolved template to render (per-account custom or shipped default). The
   * enqueue side snapshots it into the outbox payload so a later template edit
   * never rewrites already-queued mail. Absent = built-in copy.
   */
  template?: EmailTemplate | null;
  /** Locale for template variable formatting (`en` default). */
  templateLocale?: string | null;
  /** True while the booking awaits host confirmation (drives {{pending_note}}). */
  pending?: boolean;
  /** Public book-again URL for this event type (drives {{booking_link}}). */
  bookingLink?: string | null;
}

/**
 * Renders and sends booking emails through the EmailProvider port, each with an
 * .ics invite where appropriate (SEQUENCE 0/1/2 for confirm/reschedule/cancel;
 * stable UID). The app only ever calls these methods; the transport is whatever
 * adapter is wired.
 *
 * Recipients: without an `audience`, confirmation/reschedule/cancellation go to
 * the attendee AND the host (deduped) — parity with the old service. With an
 * `audience` (the toggle-aware enqueue path) each side gets its own message so
 * per-side notification settings can silence one without the other.
 */
export class BookingNotifier {
  constructor(private readonly email: EmailProvider) {}

  /** Recipient set for the notification's audience, deduped, empties dropped. */
  private recipients(n: BookingNotification): string[] {
    const set = new Set<string>();
    if (n.audience !== 'host' && n.attendee.email) set.add(n.attendee.email);
    if (n.audience !== 'attendee') {
      if (n.host.email) set.add(n.host.email);
      for (const h of n.coHosts ?? []) if (h.email) set.add(h.email);
    }
    return [...set];
  }

  /** Host-side messages get their own dedupe key; attendee keeps the legacy key. */
  private idem(n: BookingNotification, base: string): string {
    return n.audience === 'host' ? `${base}:host` : base;
  }

  /** Template copy when one is resolved; otherwise the built-in legacy copy. */
  private copy(
    n: BookingNotification & { reminderLeadMinutes?: number },
    legacy: () => { subject: string; lines: string[] },
  ): RenderedEmail {
    if (n.template) {
      const locale: TemplateLocale = n.templateLocale === 'es' ? 'es' : 'en';
      return renderTemplate(n.template, templateVars(n, locale));
    }
    const { subject, lines } = legacy();
    const kept = lines.filter(Boolean);
    return { subject, text: kept.join('\n'), html: htmlBody(kept) };
  }

  sendConfirmation(n: BookingNotification): Promise<EmailResult> {
    const when = formatWhen(n.startUtc, n.attendee.timeZone ?? 'UTC');
    const rendered = this.copy(n, () => ({
      subject: `Confirmed: ${n.title} — ${when}`,
      lines: [
        `Hi ${n.attendee.name},`,
        ``,
        `Your booking "${n.title}" is confirmed.`,
        `When: ${when}`,
        n.host.name ? `Host: ${n.host.name}` : '',
        n.location ? `Where: ${n.location}` : '',
        n.manageUrl ? `Manage your booking: ${n.manageUrl}` : '',
      ],
    }));
    return this.email.send({
      accountId: n.accountId,
      to: this.recipients(n),
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: { 'X-Booking-Uid': n.uid },
      idempotencyKey: this.idem(n, `calendar:${n.uid}:confirmation`),
      attachments: [this.ics(n, 'REQUEST', 0)],
    });
  }

  /**
   * A scheduled REMINDER before the meeting. No new .ics — the confirmed invite
   * already lives in the calendar; this is just a nudge. The `payload` carries
   * `reminderLeadMinutes` so the copy can say "starts in X".
   */
  sendReminder(n: BookingNotification & { reminderLeadMinutes?: number }): Promise<EmailResult> {
    const when = formatWhen(n.startUtc, n.attendee.timeZone ?? 'UTC');
    const lead = n.reminderLeadMinutes;
    const inWord =
      lead == null ? 'soon' : lead % 1440 === 0 ? `in ${lead / 1440} day(s)` : lead % 60 === 0 ? `in ${lead / 60} hour(s)` : `in ${lead} minutes`;
    const rendered = this.copy(n, () => ({
      subject: `Reminder: ${n.title} — ${when}`,
      lines: [
        `Hi ${n.attendee.name},`,
        ``,
        `Reminder: "${n.title}" starts ${inWord}.`,
        `When: ${when}`,
        n.host.name ? `Host: ${n.host.name}` : '',
        n.location ? `Where: ${n.location}` : '',
        n.manageUrl ? `Manage your booking: ${n.manageUrl}` : '',
      ],
    }));
    return this.email.send({
      accountId: n.accountId,
      to: this.recipients(n),
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: { 'X-Booking-Uid': n.uid },
      // Distinct per lead so two reminders (24h, 1h) aren't de-duped as one.
      idempotencyKey: this.idem(n, `calendar:${n.uid}:reminder:${lead ?? 'x'}`),
      // No .ics on a reminder.
    });
  }

  /**
   * Post-meeting FOLLOW-UP (thank-you) — scheduled at end + lead, attendee
   * side, strictly opt-in (default OFF). No .ics: the meeting already
   * happened; this is a courtesy note with a book-again link.
   */
  sendFollowUp(n: BookingNotification & { reminderLeadMinutes?: number }): Promise<EmailResult> {
    const when = formatWhen(n.startUtc, n.attendee.timeZone ?? 'UTC');
    const rendered = this.copy(n, () => ({
      subject: `Thanks for meeting — ${n.title}`,
      lines: [
        `Hi ${n.attendee.name},`,
        ``,
        `Thanks for taking the time for "${n.title}" (${when}) — we hope it was useful.`,
        n.bookingLink ? `Want to talk again? Book another slot: ${n.bookingLink}` : '',
      ],
    }));
    return this.email.send({
      accountId: n.accountId,
      to: this.recipients(n),
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: { 'X-Booking-Uid': n.uid },
      // Keyed per lead, mirroring reminders — a re-pointed follow-up at the
      // same lead after reschedule replaces, not duplicates.
      idempotencyKey: this.idem(n, `calendar:${n.uid}:follow_up:${n.reminderLeadMinutes ?? 'x'}`),
      // No .ics on a follow-up.
    });
  }

  /**
   * B5: a `requiresConfirmation` booking is PENDING, not confirmed. Tell the
   * attendee we received the request — and DO NOT attach a CONFIRMED invite (no
   * .ics), so their calendar isn't populated with an event the host may decline.
   */
  sendPendingRequest(n: BookingNotification): Promise<EmailResult> {
    const when = formatWhen(n.startUtc, n.attendee.timeZone ?? 'UTC');
    const rendered = this.copy(n, () => ({
      subject: `Request received: ${n.title} — ${when}`,
      lines: [
        `Hi ${n.attendee.name},`,
        ``,
        `We received your request to book "${n.title}".`,
        `When: ${when}`,
        n.host.name ? `Host: ${n.host.name}` : '',
        `This is pending confirmation${n.host.name ? ` by ${n.host.name}` : ''}. ` +
          `You'll get another email once it's confirmed.`,
        n.manageUrl ? `Cancel this request: ${n.manageUrl}` : '',
      ],
    }));
    return this.email.send({
      accountId: n.accountId,
      // Without an audience the host is copied too — the cue to confirm/decline.
      to: this.recipients(n),
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: { 'X-Booking-Uid': n.uid },
      idempotencyKey: this.idem(n, `calendar:${n.uid}:pending`),
      // No .ics on purpose — nothing is confirmed yet.
    });
  }

  /** B3: the host declined a pending request — tell the attendee it's off. */
  sendDeclined(n: BookingNotification): Promise<EmailResult> {
    const when = formatWhen(n.startUtc, n.attendee.timeZone ?? 'UTC');
    const rendered = this.copy(n, () => ({
      subject: `Not accepted: ${n.title} — ${when}`,
      lines: [
        `Hi ${n.attendee.name},`,
        ``,
        `Unfortunately your request to book "${n.title}" (${when}) was not accepted.`,
        n.cancellationReason ? `Reason: ${n.cancellationReason}` : '',
      ],
    }));
    return this.email.send({
      accountId: n.accountId,
      // Without an audience the host is copied too — confirms the decline landed.
      to: this.recipients(n),
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: { 'X-Booking-Uid': n.uid },
      idempotencyKey: this.idem(n, `calendar:${n.uid}:declined`),
      // No .ics — the pending request never produced a confirmed event.
    });
  }

  sendReschedule(n: BookingNotification): Promise<EmailResult> {
    const when = formatWhen(n.startUtc, n.attendee.timeZone ?? 'UTC');
    const prev = n.previousStartUtc ? formatWhen(n.previousStartUtc, n.attendee.timeZone ?? 'UTC') : null;
    const rendered = this.copy(n, () => ({
      subject: `Rescheduled: ${n.title} — ${when}`,
      lines: [
        `Hi ${n.attendee.name},`,
        ``,
        `Your booking "${n.title}" has been rescheduled.`,
        prev ? `Was: ${prev}` : '',
        `Now: ${when}`,
        n.host.name ? `Host: ${n.host.name}` : '',
        n.location ? `Where: ${n.location}` : '',
        n.manageUrl ? `Manage your booking: ${n.manageUrl}` : '',
      ],
    }));
    return this.email.send({
      accountId: n.accountId,
      to: this.recipients(n),
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: { 'X-Booking-Uid': n.uid },
      // Keyed by the TARGET start: a retry of the same reschedule is de-duped,
      // but a second reschedule to a different time is a distinct message.
      idempotencyKey: this.idem(n, `calendar:${n.uid}:reschedule:${n.startUtc}`),
      attachments: [this.ics(n, 'REQUEST', 1)],
    });
  }

  sendCancellation(n: BookingNotification): Promise<EmailResult> {
    const when = formatWhen(n.startUtc, n.attendee.timeZone ?? 'UTC');
    const rendered = this.copy(n, () => ({
      subject: `Cancelled: ${n.title} — ${when}`,
      lines: [
        `Hi ${n.attendee.name},`,
        ``,
        `Your booking "${n.title}" (${when}) has been cancelled.`,
        n.cancellationReason ? `Reason: ${n.cancellationReason}` : '',
      ],
    }));
    return this.email.send({
      accountId: n.accountId,
      to: this.recipients(n),
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: { 'X-Booking-Uid': n.uid },
      idempotencyKey: this.idem(n, `calendar:${n.uid}:cancellation`),
      attachments: [this.ics(n, 'CANCEL', 2)],
    });
  }

  private ics(n: BookingNotification, method: 'REQUEST' | 'CANCEL', sequence: number) {
    return {
      filename: 'invite.ics',
      content: buildIcs({
        uid: n.uid,
        method,
        sequence,
        startUtc: n.startUtc,
        endUtc: n.endUtc,
        title: n.title,
        location: n.location,
        organizer: n.host,
        attendees: [{ name: n.attendee.name, email: n.attendee.email }],
        stamp: n.stamp ?? n.startUtc,
      }),
      contentType: icsContentType(method),
    };
  }
}

