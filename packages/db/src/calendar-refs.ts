/**
 * The seam between the booking data layer and the CalendarProvider PORT
 * (`@slate/calendar`). This module owns everything the port needs from the DB:
 *   - which connection refs feed conflict-checking (availability busy-subtraction)
 *   - which connection refs are write destinations (event write-out)
 *   - the `booking_reference` table (the external event id we persist per booking)
 *
 * It depends ONLY on the port INTERFACE — never a concrete adapter, never a
 * vendor name (R15). The OSS default provider is disabled, so every function
 * here is a no-op on a bare clone: no connections rows ⇒ no external busy and no
 * write-out. A private overlay swaps in a real provider without touching this.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Interval } from '@slate/engine';
import type { CalendarProvider } from '@slate/calendar';
import type { Db } from './client';

/**
 * Connection refs used for CONFLICT checking (availability). Only calendars the
 * host opted into (`check_conflicts = 1`) contribute busy times. The ref is the
 * opaque `external_id` the provider round-trips — never an OAuth token.
 */
export async function loadConflictConnectionRefs(db: Db, memberId: string): Promise<string[]> {
  const rows = await db.all<{ external_id: string }>(
    sql`SELECT external_id FROM connected_calendar
        WHERE member_id = ${memberId} AND check_conflicts = 1`,
  );
  return rows.map((r) => r.external_id);
}

/**
 * Connection refs that are WRITE destinations (`is_destination = 1`): where a
 * confirmed booking's event is created. Empty ⇒ nothing is written out.
 */
export async function loadDestinationConnectionRefs(db: Db, memberId: string): Promise<string[]> {
  const rows = await db.all<{ external_id: string }>(
    sql`SELECT external_id FROM connected_calendar
        WHERE member_id = ${memberId} AND is_destination = 1`,
  );
  return rows.map((r) => r.external_id);
}

/**
 * The host's external busy times over [fromMs,toMs), fetched via the port and
 * projected to engine `Interval`s to be UNIONed with local booking/hold busy.
 *
 * Strict no-op contract (keeps clone-and-run behavior identical to before):
 *   - `calendar` undefined or `enabled === false` (the OSS DisabledProvider) → []
 *   - no conflict-checked connections → [] (never calls the provider)
 */
export async function loadExternalBusy(
  db: Db,
  calendar: CalendarProvider | undefined,
  memberId: string,
  fromMs: number,
  toMs: number,
): Promise<Interval[]> {
  if (!calendar?.enabled) return [];
  const connectionRefs = await loadConflictConnectionRefs(db, memberId);
  if (connectionRefs.length === 0) return [];
  const busy = await calendar.listBusy({
    connectionRefs,
    fromUtc: new Date(fromMs).toISOString(),
    toUtc: new Date(toMs).toISOString(),
  });
  // The engine merges/sorts busy itself (computeSlots → mergeIntervals), so an
  // unsorted union is fine here.
  return busy.map((b) => ({ start: new Date(b.startUtc), end: new Date(b.endUtc) }));
}

// --- booking_reference (the persisted external event id per booking) --------

/** Everything the port needs to create/delete a booking's remote event. */
export interface CalendarWriteContext {
  bookingId: string;
  uid: string;
  title: string;
  startUtc: string;
  endUtc: string;
  /** B9: a Meet link is requested when this is exactly `'google_meet'`. */
  location: string | null;
  attendeeTimeZone: string | null;
  attendeeEmails: string[];
  organizerEmail: string | null;
  /** Write-destination connection refs (`is_destination = 1`). */
  destinationRefs: string[];
}

/**
 * Load the booking + its attendees + host organizer email + destination refs
 * needed to write (or later delete) the external calendar event. Returns null
 * if the booking is gone.
 */
export async function loadBookingForCalendarWrite(
  db: Db,
  uid: string,
): Promise<CalendarWriteContext | null> {
  const b = await db.get<{
    id: string;
    uid: string;
    title: string;
    start_ms: number;
    end_ms: number;
    location: string | null;
    attendee_time_zone: string | null;
    host_member_id: string | null;
    host_email: string | null;
  }>(
    sql`SELECT b.id, b.uid, b.title, b.start_ms, b.end_ms, b.location, b.attendee_time_zone,
               b.host_member_id, m.email AS host_email
        FROM booking b
        LEFT JOIN member m ON m.id = b.host_member_id
        WHERE b.uid = ${uid} LIMIT 1`,
  );
  if (!b) return null;
  const attendees = await db.all<{ email: string }>(
    sql`SELECT email FROM booking_attendee WHERE booking_id = ${b.id}`,
  );

  // The assigned host set: co-hosts recorded in booking_host (collective /
  // fixed_round_robin) plus the primary organizer. Round-robin bookings have no
  // booking_host rows, so this is just the single host_member_id — behavior
  // unchanged. Each host's destination calendar gets the event; co-hosts are
  // added as attendees so everyone sees one shared event with all hosts on it.
  const coHosts = await db.all<{ member_id: string; email: string | null }>(
    sql`SELECT bh.member_id, m.email
        FROM booking_host bh LEFT JOIN member m ON m.id = bh.member_id
        WHERE bh.booking_id = ${b.id}`,
  );
  const hostMemberIds = new Set<string>();
  if (b.host_member_id) hostMemberIds.add(b.host_member_id);
  for (const h of coHosts) hostMemberIds.add(h.member_id);

  const destinationSet = new Set<string>();
  for (const memberId of hostMemberIds) {
    for (const ref of await loadDestinationConnectionRefs(db, memberId)) destinationSet.add(ref);
  }

  // On multi-host bookings the co-hosts join the invite as attendees (the
  // organizer is the booking's primary host, so exclude their email).
  const coHostEmails = coHosts
    .map((h) => h.email)
    .filter((e): e is string => !!e && e !== b.host_email);
  const attendeeEmails = [...new Set([...attendees.map((a) => a.email), ...coHostEmails])].filter(Boolean);

  return {
    bookingId: b.id,
    uid: b.uid,
    title: b.title,
    startUtc: new Date(Number(b.start_ms)).toISOString(),
    endUtc: new Date(Number(b.end_ms)).toISOString(),
    location: b.location,
    attendeeTimeZone: b.attendee_time_zone,
    attendeeEmails,
    organizerEmail: b.host_email,
    destinationRefs: [...destinationSet],
  };
}

export interface BookingReferenceRow {
  id: string;
  type: string;
  externalEventId: string | null;
  externalCalendarId: string | null;
  meetingUrl: string | null;
}

/**
 * Persist the external event id returned by the port. `externalCalendarId`
 * carries the connection ref used to create it, so a later delete can address
 * the same connection without re-resolving destinations.
 */
export async function writeBookingReference(
  db: Db,
  ref: {
    bookingId: string;
    type: string;
    externalEventId: string;
    externalCalendarId: string | null;
    meetingUrl: string | null;
  },
): Promise<void> {
  await db.run(
    sql`INSERT INTO booking_reference
          (id, booking_id, type, external_event_id, external_calendar_id, meeting_url, created_at)
        VALUES (${randomUUID()}, ${ref.bookingId}, ${ref.type}, ${ref.externalEventId},
          ${ref.externalCalendarId}, ${ref.meetingUrl}, ${Date.now()})`,
  );
}

/**
 * DH1 idempotency: atomically CLAIM a (booking_id, destination) slot before
 * creating the remote event. The UNIQUE index makes the INSERT the guard — a
 * retried or concurrent write loses the race and gets `null`, so it skips
 * createEvent and cannot produce a duplicate external event. Returns the new
 * reference id on success, or null if this destination is already claimed.
 */
export async function claimBookingDestination(
  db: Db,
  bookingId: string,
  destination: string,
): Promise<string | null> {
  const id = randomUUID();
  try {
    await db.run(
      sql`INSERT INTO booking_reference (id, booking_id, destination, type, created_at)
          VALUES (${id}, ${bookingId}, ${destination}, 'calendar_event', ${Date.now()})`,
    );
    return id;
  } catch {
    // Unique-violation (already claimed) — idempotent no-op.
    return null;
  }
}

/** Fill a claimed reference with the created event's ids once createEvent succeeds. */
export async function fillBookingReference(
  db: Db,
  referenceId: string,
  ref: { externalEventId: string; externalCalendarId: string | null; meetingUrl: string | null },
): Promise<void> {
  await db.run(
    sql`UPDATE booking_reference
        SET external_event_id = ${ref.externalEventId},
            external_calendar_id = ${ref.externalCalendarId},
            meeting_url = ${ref.meetingUrl}
        WHERE id = ${referenceId}`,
  );
}

/** Release a claim (e.g. createEvent failed) so a later retry can re-create it. */
export async function releaseBookingReference(db: Db, referenceId: string): Promise<void> {
  await db.run(sql`DELETE FROM booking_reference WHERE id = ${referenceId}`);
}

export async function loadBookingReferences(
  db: Db,
  bookingId: string,
): Promise<BookingReferenceRow[]> {
  const rows = await db.all<{
    id: string;
    type: string;
    external_event_id: string | null;
    external_calendar_id: string | null;
    meeting_url: string | null;
  }>(
    sql`SELECT id, type, external_event_id, external_calendar_id, meeting_url
        FROM booking_reference WHERE booking_id = ${bookingId}`,
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    externalEventId: r.external_event_id,
    externalCalendarId: r.external_calendar_id,
    meetingUrl: r.meeting_url,
  }));
}

/** Drop all references for a booking once the remote events are deleted. */
export async function deleteBookingReferences(db: Db, bookingId: string): Promise<void> {
  await db.run(sql`DELETE FROM booking_reference WHERE booking_id = ${bookingId}`);
}
