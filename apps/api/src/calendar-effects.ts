import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CalendarProvider } from '@slate/calendar';
import {
  claimBookingDestination,
  deleteBookingReferences,
  enqueueOutbox,
  fillBookingReference,
  loadBookingForCalendarWrite,
  loadBookingReferences,
  releaseBookingReference,
  type Db,
} from '@slate/db';
import { CALENDAR, DB } from './tokens';

/** Calendar lifecycle transitions the outbox can carry. */
export type CalendarAction = 'create' | 'delete' | 'reschedule';

/**
 * The single place the booking lifecycle reaches the CalendarProvider PORT to
 * WRITE events out (and the availability path reaches it to READ busy times via
 * `provider`). Fully behind the port; no vendor is named here (R15) — only the
 * generic port + `booking_reference`.
 *
 * DURABILITY (B7 / audit DM1): the lifecycle no longer fire-and-forgets the
 * write. Each transition ENQUEUES an `outbox` row; the OutboxWorker drains it
 * with retry+backoff and calls `runCalendarJob` below. So:
 *   - Contract B8: a calendar failure NEVER rolls back the booking — the
 *     lifecycle only enqueues (a fast local INSERT) and returns; the actual
 *     vendor call happens out-of-band in the worker.
 *   - No silent loss: a provider outage retries instead of vanishing.
 *   - Idempotent: the DH1 claim (`booking_reference` unique index) means a retry
 *     cannot double-create a remote event.
 *   - OSS clone-and-run: the default provider is disabled (`enabled === false`),
 *     so nothing is ever enqueued and behavior is unchanged.
 */
@Injectable()
export class CalendarEffects {
  private readonly log = new Logger('CalendarEffects');

  constructor(
    @Inject(CALENDAR) private readonly calendar: CalendarProvider,
    @Inject(DB) private readonly db: Db,
  ) {}

  /** The wired provider — handed to the availability path for busy-subtraction. */
  get provider(): CalendarProvider {
    return this.calendar;
  }

  /**
   * A booking became `accepted` (fresh accept, host on-behalf, team, or a
   * pending→accepted confirm): queue a durable create of the remote event.
   */
  onBookingAccepted(uid: string): void {
    this.enqueue('create', uid);
  }

  /** A booking was cancelled/declined: queue a durable delete of its event(s). */
  onBookingCancelled(uid: string): void {
    this.enqueue('delete', uid);
  }

  /** A booking moved (reschedule): queue a durable MOVE of the existing event. */
  onBookingRescheduled(uid: string): void {
    this.enqueue('reschedule', uid);
  }

  /**
   * Record the transition on the outbox. No-op when no calendar is wired (the
   * OSS default) so a bare clone enqueues nothing. The enqueue itself is a fast
   * local INSERT; we keep the call site synchronous (never blocks the booking
   * response) and only log if the enqueue itself fails.
   */
  private enqueue(action: CalendarAction, uid: string): void {
    if (!this.calendar.enabled) return;
    void enqueueOutbox(this.db, { kind: 'calendar', action, bookingUid: uid }).catch((err) => {
      this.log.error(`failed to enqueue calendar ${action} for ${uid}: ${String(err)}`);
    });
  }

  /**
   * The worker's executor for a claimed calendar outbox row. Performs the real
   * vendor write via the port and THROWS on failure so the worker retries
   * (idempotent via the DH1 claim). No-op when the provider is disabled.
   */
  async runCalendarJob(action: CalendarAction, uid: string): Promise<void> {
    if (!this.calendar.enabled) return;
    if (action === 'delete') {
      await this.removeEvent(uid);
    } else if (action === 'reschedule') {
      await this.moveEvent(uid);
    } else {
      await this.writeEvent(uid);
    }
  }

  /**
   * A true reschedule: MOVE the existing remote event(s) to the booking's new
   * time via `updateEvent`, keeping the same `externalEventId` so attendees see
   * the event move (no cancel + fresh invite, no duplicate). Slate's reschedule
   * keeps the same booking uid, so the stored `booking_reference` rows are the
   * events to move. If nothing was written yet (e.g. accepted then rescheduled
   * before the create drained), fall back to a fresh create.
   */
  private async moveEvent(uid: string): Promise<void> {
    const ctx = await loadBookingForCalendarWrite(this.db, uid);
    if (!ctx) return;
    const refs = await loadBookingReferences(this.db, ctx.bookingId);
    const movable = refs.filter((r) => r.externalEventId);
    if (movable.length === 0) {
      await this.writeEvent(uid);
      return;
    }
    for (const ref of movable) {
      await this.calendar.updateEvent({
        connectionRef: ref.externalCalendarId ?? ctx.destinationRefs[0] ?? '',
        externalEventId: ref.externalEventId!,
        title: ctx.title,
        startUtc: ctx.startUtc,
        endUtc: ctx.endUtc,
        attendeeEmails: ctx.attendeeEmails,
        organizerEmail: ctx.organizerEmail,
        timeZone: ctx.attendeeTimeZone,
      });
    }
  }

  private async writeEvent(uid: string): Promise<void> {
    const ctx = await loadBookingForCalendarWrite(this.db, uid);
    if (!ctx || ctx.destinationRefs.length === 0) return;
    for (const connectionRef of ctx.destinationRefs) {
      // DH1: claim (booking_id, destination) FIRST. A retry / concurrent confirm
      // loses the claim → skips createEvent → no duplicate external event.
      const claimId = await claimBookingDestination(this.db, ctx.bookingId, connectionRef);
      if (!claimId) continue;
      let created;
      try {
        created = await this.calendar.createEvent({
          connectionRef,
          title: ctx.title,
          startUtc: ctx.startUtc,
          endUtc: ctx.endUtc,
          attendeeEmails: ctx.attendeeEmails,
          organizerEmail: ctx.organizerEmail,
          // B9: the exact literal that triggers a conferencing link.
          requestConferenceLink: ctx.location === 'google_meet',
          timeZone: ctx.attendeeTimeZone,
        });
      } catch (err) {
        // createEvent failed → drop the claim so a later retry can re-create.
        await releaseBookingReference(this.db, claimId);
        throw err;
      }
      await fillBookingReference(this.db, claimId, {
        externalEventId: created.externalEventId,
        // Store the connection ref so a later delete addresses the same calendar.
        externalCalendarId: created.externalCalendarId ?? connectionRef,
        meetingUrl: created.meetingUrl ?? null,
      });
    }
  }

  private async removeEvent(uid: string): Promise<void> {
    const ctx = await loadBookingForCalendarWrite(this.db, uid);
    if (!ctx) return;
    const refs = await loadBookingReferences(this.db, ctx.bookingId);
    for (const ref of refs) {
      if (!ref.externalEventId) continue;
      await this.calendar.deleteEvent({
        connectionRef: ref.externalCalendarId ?? ctx.destinationRefs[0] ?? '',
        externalEventId: ref.externalEventId,
      });
    }
    await deleteBookingReferences(this.db, ctx.bookingId);
  }
}
