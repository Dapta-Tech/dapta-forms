import { Inject, Injectable, Logger } from '@nestjs/common';
import { enqueueOutbox, type Db } from '@quill/db';
import { DB } from './tokens';

/**
 * The durable payload a `booking_sync` outbox row carries: the validated
 * scheduling-callback facts plus the identifiers the worker-side handler
 * (`BookingSyncEffects`) needs to reload the form's destination config and the
 * submission for the session. Deliberately small — the HubSpot destination
 * config is read FRESH at delivery time (so an admin edit between enqueue and
 * drain is honored), and no secrets or answer PII are ever serialized here.
 */
export interface BookingSyncPayload {
  /** The persisted booking_event row this sync is for (also the subject_uid). */
  bookingEventId: string;
  formId: string;
  accountId: string;
  sessionId: string;
  /** Scheduling provider reported by the renderer (calendly / hubspot_meetings). */
  provider: string;
  eventUri: string | null;
  inviteeUri: string | null;
  /** Scheduled start reported by the callback, epoch-ms (null = unknown). */
  startTime: number | null;
}

/**
 * Durable BOOKING → CRM sync enqueue (mirrors EmailEffects). After a booking
 * callback is persisted, the sync is ENQUEUED as an `outbox` row (kind
 * `booking_sync`) instead of delivered inline; the OutboxWorker drains it with
 * retry+backoff. Enqueueing never blocks or fails the public callback — a
 * persisted booking_event is the durable fact, CRM sync rides on top of it.
 */
@Injectable()
export class BookingEffects {
  private readonly log = new Logger('BookingEffects');

  constructor(@Inject(DB) private readonly db: Db) {}

  /** Never rejects — the booking handler must not fail on a bad enqueue. */
  async enqueueBookingSync(payload: BookingSyncPayload): Promise<void> {
    try {
      await enqueueOutbox(this.db, {
        kind: 'booking_sync',
        action: 'crm_update',
        subjectUid: payload.bookingEventId,
        accountId: payload.accountId,
        payload: JSON.stringify(payload),
      });
    } catch (err) {
      this.log.error(`failed to enqueue booking_sync: ${String(err)}`);
    }
  }
}
