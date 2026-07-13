import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@slate/db';
import {
  cancelBooking,
  createBooking,
  createTeamBooking,
  enqueueWebhookDeliveries,
  getAccountByCode,
  getAvailability,
  getPublicProfile,
  getTeamAvailability,
  getTeamProfile,
  rescheduleBooking,
  reserveSlot,
  resolveBooking,
  parseJsonColumn,
  sql,
} from '@slate/db';
import { verifyManageToken } from '@slate/engine';
import type { ServerEnv } from '@slate/config/env';
import { CalendarEffects } from './calendar-effects';
import { EmailEffects } from './email-effects';
import {
  availabilityQuerySchema,
  availabilityResponseSchema,
  createBookingSchema,
  reserveSlotSchema,
  type AvailabilityResponse,
  type BookingView,
  type PublicProfile,
  type TeamProfile,
} from '@slate/types';
import { DB, ENV } from './tokens';

export type ServiceError = { error: string; message: string; status: number };

@Injectable()
export class BookingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(CalendarEffects) private readonly calendar: CalendarEffects,
    @Inject(EmailEffects) private readonly email: EmailEffects,
  ) {}

  private manageUrl(uid: string, token: string): string {
    return `${this.env.PUBLIC_APP_URL}/manage/${uid}?token=${token}`;
  }

  async profile(accountCode: string, handle: string): Promise<PublicProfile | null> {
    const p = await getPublicProfile(this.db, accountCode, handle);
    return (p as PublicProfile | undefined) ?? null;
  }

  async availability(raw: unknown): Promise<AvailabilityResponse | null> {
    const q = availabilityQuerySchema.parse(raw);
    const fromMs = new Date(q.from).getTime();
    // Cap the search window at 60 days (contract §Engine) — clamp `to` rather
    // than reject, so an over-wide agent query still returns a bounded result.
    const toMs = Math.min(new Date(q.to).getTime(), fromMs + 60 * 86_400_000);
    const result = await getAvailability(
      this.db,
      {
        accountCode: q.accountCode,
        handle: q.handle,
        slug: q.slug,
        fromMs,
        toMs,
        displayTimeZone: q.timeZone,
      },
      // Subtract the host's real connected-calendar busy times (no-op on the
      // OSS default disabled provider).
      this.calendar.provider,
    );
    if (!result) return null;
    return availabilityResponseSchema.parse({
      eventType: result.eventType,
      timeZone: result.timeZone,
      // result.slots are already {startUtc, spotsLeft?, capacity?} (group-aware).
      slots: result.slots,
      // Machine-readable config-error reason (only when slots is empty). The
      // code is public-safe; clients own the copy (admin actionable, public generic).
      emptyReason: result.emptyReason,
    });
  }

  /** Reserve a 10-minute soft hold on a slot (public reserve→confirm two-step). */
  async reserve(raw: unknown): Promise<{ reservationUid: string; expiresAt: string } | ServiceError> {
    const input = reserveSlotSchema.parse(raw);
    const held = await reserveSlot(this.db, {
      accountCode: input.accountCode,
      handle: input.handle,
      slug: input.slug,
      startMs: new Date(input.startUtc).getTime(),
    });
    if (!held.ok) {
      if (held.reason === 'NOT_FOUND')
        return { error: 'NOT_FOUND', message: 'No such booking page.', status: 404 };
      if (held.reason === 'RATE_LIMITED')
        return { error: 'RATE_LIMITED', message: 'Too many active holds. Try again shortly.', status: 429 };
      return { error: 'INVALID_SLOT', message: 'That time is not available to hold.', status: 400 };
    }
    return { reservationUid: held.uid, expiresAt: new Date(held.releaseAtMs).toISOString() };
  }

  async book(raw: unknown, onBehalf = false): Promise<BookingView | ServiceError> {
    const input = createBookingSchema.parse(raw);
    const outcome = await createBooking(
      this.db,
      {
        accountCode: input.accountCode,
        handle: input.handle,
        slug: input.slug,
        startMs: new Date(input.startUtc).getTime(),
        attendee: input.attendee,
        answers: input.answers,
        reservationUid: input.reservationUid,
        idempotencyKey: input.idempotencyKey,
        onBehalf,
      },
      // Fail-closed external conflict check at create time (no-op when disabled).
      this.calendar.provider,
    );

    if (!outcome.ok) {
      if (outcome.reason === 'NOT_FOUND')
        return { error: 'NOT_FOUND', message: 'No such booking page.', status: 404 };
      if (outcome.reason === 'INVALID')
        return { error: 'INTAKE_INVALID', message: outcome.message, status: 400 };
      if (outcome.reason === 'RESERVATION_EXPIRED')
        return { error: 'RESERVATION_EXPIRED', message: 'Your hold on this time expired. Please pick a time again.', status: 410 };
      if (outcome.reason === 'CALENDAR_UNAVAILABLE')
        return {
          error: 'CALENDAR_UNAVAILABLE',
          message: 'This time could not be confirmed right now. Please try again in a few minutes.',
          status: 409,
        };
      return { error: 'SLOT_TAKEN', message: 'That time was just booked. Pick another slot.', status: 409 };
    }

    const b = outcome.booking;
    const startUtc = new Date(b.startMs).toISOString();
    const endUtc = new Date(b.endMs).toISOString();
    // Idempotent replay returns an empty token → do NOT reissue a manage link
    // (single-active-token invariant); only mint a URL for a fresh booking.
    const manageUrl = outcome.manageToken ? this.manageUrl(b.uid, outcome.manageToken) : undefined;

    if (outcome.manageToken) {
      // B5: gate the email + calendar write on STATUS. An ACCEPTED booking is
      // confirmed (write to the calendar + send a "confirmed" mail with a
      // REQUEST .ics). A PENDING (requiresConfirmation) booking is NOT confirmed
      // — send a "request received" mail with NO confirmed .ics and write
      // nothing to the calendar until the host confirms. (B8: never blocks.)
      if (b.status === 'accepted') {
        this.calendar.onBookingAccepted(b.uid);
        void this.email.enqueueConfirmation(b.uid, { manageUrl });
        // Schedule the pre-meeting reminders (24h + 1h) — dormant outbox rows.
        void this.email.enqueueReminders(b.uid, { manageUrl });
        void this.email.enqueueFollowUps(b.uid, { manageUrl });
      } else if (b.status === 'pending') {
        void this.email.enqueuePending(b.uid, { manageUrl });
      }
      // Durable webhook delivery: enqueue one outbox row per subscriber; the
      // OutboxWorker signs + POSTs with retry+backoff (B7/DM1). No-op when the
      // account has no matching webhooks (bare clone-and-run).
      void getAccountByCode(this.db, input.accountCode)
        .then((acc) =>
          acc
            ? enqueueWebhookDeliveries(this.db, acc.id, 'booking.created', {
                uid: b.uid,
                status: b.status,
                startUtc,
                endUtc,
                title: b.title,
              })
            : undefined,
        )
        .catch(() => undefined);
    }

    return {
      uid: b.uid,
      status: b.status as BookingView['status'],
      title: b.title,
      startUtc,
      endUtc,
      host: { name: b.hostName, handle: b.hostHandle },
      attendee: b.attendee,
      manageUrl,
      deduplicated: outcome.deduplicated || undefined,
    };
  }

  // --- Manage (token-gated public reschedule/cancel) ----------------------

  async manageView(uid: string, token: string): Promise<BookingView | ServiceError> {
    const b = await resolveBooking(this.db, uid);
    if (!b) return { error: 'NOT_FOUND', message: 'Booking not found.', status: 404 };
    // Reuse the repository verify by attempting a no-op check via cancel/reschedule guards
    const meta = parseJsonColumn<{ _manage?: { tokenHash?: string } }>(b.metadata, {});
    if (!verifyManageToken(token, meta._manage?.tokenHash ?? null))
      return { error: 'FORBIDDEN', message: 'Invalid manage link.', status: 403 };
    const attendee = await this.db.get<{ name: string; email: string; time_zone: string | null }>(
      sql`SELECT name, email, time_zone FROM booking_attendee WHERE booking_id = ${b.id} LIMIT 1`,
    );
    // Where/meeting-link for the manage page. `location` is the booking's own
    // location column (same field calendar write-out reads); the meeting link is
    // the provider-generated URL persisted per booking in booking_reference (the
    // real source — booking.meeting_url is not populated by the create flow).
    const details = await this.db.get<{ location: string | null }>(
      sql`SELECT location FROM booking WHERE id = ${b.id} LIMIT 1`,
    );
    const ref = await this.db.get<{ meeting_url: string | null }>(
      sql`SELECT meeting_url FROM booking_reference
          WHERE booking_id = ${b.id} AND meeting_url IS NOT NULL LIMIT 1`,
    );
    // Event context so the manage page can fetch availability and offer a real
    // slot picker for reschedule (instead of a free-form datetime — G7).
    const ctx = await this.db.get<{ code: string; handle: string | null; slug: string }>(
      // COALESCE → the CANONICAL public code (vanity ?? short) so the manage
      // page's reschedule link never resurrects a legacy alias.
      sql`SELECT COALESCE(a.vanity_slug, a.code) AS code, m.handle AS handle, et.slug AS slug
          FROM booking bk
          JOIN account a ON a.id = bk.account_id
          JOIN event_type et ON et.id = bk.event_type_id
          LEFT JOIN member m ON m.id = bk.host_member_id
          WHERE bk.id = ${b.id} LIMIT 1`,
    );
    return {
      uid: b.uid,
      status: b.status as BookingView['status'],
      title: b.title,
      startUtc: new Date(Number(b.start_ms)).toISOString(),
      endUtc: new Date(Number(b.end_ms)).toISOString(),
      host: { name: null, handle: ctx?.handle ?? null },
      attendee: {
        name: attendee?.name ?? '',
        email: attendee?.email ?? '',
        timeZone: attendee?.time_zone ?? 'UTC',
      },
      location: details?.location ?? null,
      meetingUrl: ref?.meeting_url ?? null,
      reschedule:
        ctx?.handle && ctx.slug ? { accountCode: ctx.code, handle: ctx.handle, slug: ctx.slug } : undefined,
    };
  }

  async cancel(
    uid: string,
    opts: { reason?: string; token?: string; byHost?: boolean; idempotencyKey?: string },
  ): Promise<{ uid: string; status: string } | ServiceError> {
    const out = await cancelBooking(this.db, {
      uid,
      reason: opts.reason,
      manageToken: opts.token,
      byHost: opts.byHost,
      idempotencyKey: opts.idempotencyKey,
    });
    if (!out.ok) return this.mapMutation(out.reason);
    // Idempotent retry (already cancelled): skip side-effects so a retried
    // cancel doesn't send a second email / fire a second webhook.
    if (!out.alreadyApplied) {
      this.calendar.onBookingCancelled(uid);
      void this.email.enqueueCancellation(uid, { reason: opts.reason ?? null });
      // Drop any scheduled reminders — don't remind about a cancelled meeting.
      void this.email.cancelReminders(uid);
      void this.email.cancelFollowUps(uid);
      this.fireWebhook(uid, 'booking.cancelled', { uid, reason: opts.reason ?? null });
    }
    return { uid: out.uid, status: 'cancelled' };
  }

  async reschedule(
    uid: string,
    opts: { newStartUtc: string; token?: string; byHost?: boolean; idempotencyKey?: string },
  ): Promise<{ uid: string; startUtc: string; endUtc: string; manageUrl?: string } | ServiceError> {
    const out = await rescheduleBooking(
      this.db,
      {
        uid,
        newStartMs: new Date(opts.newStartUtc).getTime(),
        manageToken: opts.token,
        byHost: opts.byHost,
        idempotencyKey: opts.idempotencyKey,
      },
      // Fail-closed external conflict check on the target slot — the same
      // policy as create (no-op when the provider is disabled).
      this.calendar.provider,
    );
    if (!out.ok) return this.mapMutation(out.reason);
    // Idempotent retry (same Idempotency-Key): the booking was NOT moved again,
    // so skip all side-effects (no duplicate calendar move / email / webhook).
    if (!out.alreadyApplied) {
      this.calendar.onBookingRescheduled(uid);
      // Durable reschedule email (attendee + host) with the previous time + a
      // REQUEST .ics so the existing calendar event is updated in place.
      if (out.manageToken) {
        void this.email.enqueueReschedule(uid, {
          manageUrl: this.manageUrl(uid, out.manageToken),
          previousStartUtc: out.previousStartUtc ?? null,
        });
        // Move the reminders to the new time (drop old, re-schedule).
        void this.email.repointReminders(uid, { manageUrl: this.manageUrl(uid, out.manageToken) });
        void this.email.repointFollowUps(uid, { manageUrl: this.manageUrl(uid, out.manageToken) });
      }
      this.fireWebhook(uid, 'booking.rescheduled', { uid, startUtc: out.startUtc, endUtc: out.endUtc });
    }
    // The repo layer ROTATES the manage token on a real move (single-active-token
    // invariant), which invalidates the token the caller just used. Return the
    // fresh manage URL so the web manage page (and API callers) can keep acting
    // on the booking without digging the new link out of the reschedule email.
    // Idempotent replays don't rotate (out.manageToken is empty) → no URL here.
    return {
      uid: out.uid,
      startUtc: out.startUtc,
      endUtc: out.endUtc,
      manageUrl: out.manageToken ? this.manageUrl(uid, out.manageToken) : undefined,
    };
  }

  /** Durable webhook dispatch for a booking lifecycle event (via the outbox). */
  private fireWebhook(uid: string, event: string, data: Record<string, unknown>): void {
    void resolveBooking(this.db, uid)
      .then((bk) => (bk ? enqueueWebhookDeliveries(this.db, bk.account_id, event, data) : undefined))
      .catch(() => undefined);
  }

  private mapMutation(
    reason: 'NOT_FOUND' | 'FORBIDDEN' | 'SLOT_TAKEN' | 'GONE' | 'INVALID_SLOT' | 'CALENDAR_UNAVAILABLE',
  ): ServiceError {
    switch (reason) {
      case 'NOT_FOUND':
        return { error: 'NOT_FOUND', message: 'Booking not found.', status: 404 };
      case 'FORBIDDEN':
        return { error: 'FORBIDDEN', message: 'Invalid manage link.', status: 403 };
      case 'GONE':
        return { error: 'GONE', message: 'Booking is no longer active.', status: 410 };
      case 'SLOT_TAKEN':
        return { error: 'SLOT_TAKEN', message: 'That time is taken.', status: 409 };
      case 'CALENDAR_UNAVAILABLE':
        return {
          error: 'CALENDAR_UNAVAILABLE',
          message: 'This time could not be confirmed right now. Please try again in a few minutes.',
          status: 409,
        };
      case 'INVALID_SLOT':
        return {
          error: 'INVALID_SLOT',
          message: 'That time is not available (outside the host’s hours, too soon, or in the past).',
          status: 400,
        };
    }
  }

  // --- Teams --------------------------------------------------------------

  async teamProfile(accountCode: string, teamSlug: string): Promise<TeamProfile | null> {
    return (await getTeamProfile(this.db, accountCode, teamSlug)) as TeamProfile | null;
  }

  async teamAvailability(
    accountCode: string,
    teamSlug: string,
    slug: string,
    from: string,
    to: string,
    timeZone?: string,
  ): Promise<AvailabilityResponse | null> {
    const result = await getTeamAvailability(
      this.db,
      {
        accountCode,
        teamSlug,
        slug,
        fromMs: new Date(from).getTime(),
        toMs: new Date(to).getTime(),
        displayTimeZone: timeZone,
      },
      this.calendar.provider,
    );
    if (!result) return null;
    return availabilityResponseSchema.parse({
      eventType: result.eventType,
      timeZone: result.timeZone,
      slots: result.slots.map((startUtc) => ({ startUtc })),
      emptyReason: result.emptyReason,
    });
  }

  async teamBook(
    accountCode: string,
    teamSlug: string,
    body: { slug: string; startUtc: string; attendee: BookingView['attendee']; answers?: Record<string, unknown> },
  ): Promise<{ uid: string; hostMemberId: string; manageUrl?: string } | ServiceError> {
    const out = await createTeamBooking(
      this.db,
      {
        accountCode,
        teamSlug,
        slug: body.slug,
        startMs: new Date(body.startUtc).getTime(),
        attendee: body.attendee,
        answers: body.answers,
      },
      this.calendar.provider,
    );
    if (!out.ok) {
      if (out.reason === 'NOT_FOUND') return { error: 'NOT_FOUND', message: 'Not found.', status: 404 };
      if (out.reason === 'INVALID')
        return { error: 'INTAKE_INVALID', message: out.message ?? 'Invalid.', status: 400 };
      if (out.reason === 'CALENDAR_UNAVAILABLE')
        return {
          error: 'CALENDAR_UNAVAILABLE',
          message: 'This time could not be confirmed right now. Please try again in a few minutes.',
          status: 409,
        };
      return { error: 'SLOT_TAKEN', message: 'That time is taken.', status: 409 };
    }
    // B4: a team booking is created `accepted`. It was silently unmanageable
    // before — now write it to the chosen host's calendar, send the attendee a
    // confirmation WITH a working manage link (the token minted by
    // createTeamBooking, previously discarded), and fire the webhook.
    this.calendar.onBookingAccepted(out.uid);
    const manageUrl = out.manageToken ? this.manageUrl(out.uid, out.manageToken) : undefined;
    void this.email.enqueueConfirmation(out.uid, { manageUrl });
    void this.email.enqueueReminders(out.uid, { manageUrl });
    void this.email.enqueueFollowUps(out.uid, { manageUrl });
    this.fireWebhook(out.uid, 'booking.created', {
      uid: out.uid,
      status: 'accepted',
      startUtc: body.startUtc,
    });
    return { uid: out.uid, hostMemberId: out.hostMemberId, manageUrl };
  }
}
