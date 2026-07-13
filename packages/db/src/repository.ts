/**
 * The booking repository — the only place that turns the portable schema into
 * domain operations. Reads compose the pure @slate/engine (slot computation);
 * the write path (createBooking) enforces the anti-double-booking guarantee with
 * dual enforcement: an app-level overlap-check-in-a-transaction on BOTH engines
 * (the only backstop on SQLite), plus the DB-level EXCLUDE on Postgres (caught
 * as a 23P01 → conflict). See migration plan §5.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  classifyEmptyReason,
  computeSlots,
  generateManageToken,
  isExclusionViolation,
  isUniqueViolation,
  type AvailabilityEmptyReason,
  type AvailabilityRule,
  type Interval,
} from '@slate/engine';
import type { CalendarProvider } from '@slate/calendar';
import type { Db } from './client';
import { loadExternalBusy } from './calendar-refs';
import { canonicalPublicCode } from './short-links';

/**
 * Read a JSON column uniformly: Postgres jsonb comes back parsed (object),
 * SQLite text comes back as a string. Returns `fallback` for null/empty.
 */
export function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/** Build a JSON write value: cast text → jsonb on Postgres, bind text on SQLite. */
export function jsonParam(db: Db, value: unknown) {
  const text = value == null ? null : JSON.stringify(value);
  if (text == null) return sql`NULL`;
  return db.dialect === 'postgres' ? sql`${text}::jsonb` : sql`${text}`;
}

export interface AccountRow {
  id: string;
  /** The canonical short code (or a legacy pretty code like the seeded `acme`). */
  code: string;
  name: string;
  /** Premium vanity slug; when set it is the canonical PUBLIC code. */
  vanity_slug: string | null;
}
export interface MemberRow {
  id: string;
  account_id: string;
  handle: string | null;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  brand_color: string | null;
  layout: string | null;
  booking_page_style: unknown;
  time_zone: string;
  default_schedule_id: string | null;
}
export interface EventTypeRow {
  id: string;
  account_id: string;
  member_id: string | null;
  team_id: string | null;
  slug: string;
  title: string;
  description: string | null;
  length_minutes: number;
  locations: unknown;
  schedule_id: string | null;
  scheduling_type: string | null;
  booking_fields: unknown;
  minimum_booking_notice: number;
  before_event_buffer: number;
  after_event_buffer: number;
  slot_interval: number | null;
  requires_confirmation: number;
  seats_per_time_slot: number | null;
}

export type BookingOutcome =
  | { ok: true; booking: BookingRecord; manageToken: string; deduplicated?: boolean }
  | { ok: false; reason: 'SLOT_TAKEN' | 'NOT_FOUND' | 'RESERVATION_EXPIRED' | 'CALENDAR_UNAVAILABLE' }
  | { ok: false; reason: 'INVALID'; message: string };

export interface BookingRecord {
  uid: string;
  status: string;
  title: string;
  startMs: number;
  endMs: number;
  hostHandle: string | null;
  hostName: string | null;
  attendee: { name: string; email: string; timeZone: string };
}

export interface CreateBookingArgs {
  accountCode: string;
  /** Public lookup: the member's public handle. */
  handle?: string;
  /** Host lookup: resolve the member by id (host on-behalf bookings work even
   *  before the member sets a public handle). */
  memberId?: string;
  slug: string;
  startMs: number;
  attendee: { name: string; email: string; timeZone: string; notes?: string; phone?: string };
  /** Answers to the event type's custom intake fields. */
  answers?: Record<string, unknown>;
  /** A held reservation to consume (deleted on success). */
  reservationUid?: string;
  idempotencyKey?: string;
  /** True when a host/agent booked on behalf (attribution; skips manage-token gating upstream). */
  onBehalf?: boolean;
}

/** Validate submitted intake answers against a set of field definitions. */
export function validateIntakeAnswers(
  fields: BookingFieldDef[],
  answers: Record<string, unknown> | undefined,
): string | null {
  for (const f of fields) {
    if (!f.required) continue;
    const v = answers?.[f.name];
    const missing =
      v == null || v === '' || (Array.isArray(v) && v.length === 0) || v === false;
    if (missing) return `Missing required field: ${f.label}`;
  }
  return null;
}

// --- Resolvers ------------------------------------------------------------

/**
 * THE public-code resolver (one place, mission short-links §4): a URL segment
 * may be the canonical short code, a claimed vanity slug, or a retired legacy
 * code kept alive in account_alias — all resolve to the same account. Callers
 * that emit links must use `canonicalPublicCode(account)` (vanity ?? code);
 * the web layer 308-redirects non-canonical segments.
 */
export async function getAccountByCode(db: Db, code: string): Promise<AccountRow | undefined> {
  const c = code.toLowerCase();
  const cols = sql`id, code, name, vanity_slug`;
  const direct = await db.get<AccountRow>(
    sql`SELECT ${cols} FROM account WHERE code = ${c} OR vanity_slug = ${c} LIMIT 1`,
  );
  if (direct) return direct;
  return db.get<AccountRow>(
    sql`SELECT a.id, a.code, a.name, a.vanity_slug FROM account a
        JOIN account_alias al ON al.account_id = a.id
        WHERE al.alias = ${c} LIMIT 1`,
  );
}

export async function getMember(
  db: Db,
  accountId: string,
  handle: string,
): Promise<MemberRow | undefined> {
  return db.get<MemberRow>(
    sql`SELECT id, account_id, handle, display_name, email, avatar_url, cover_url, brand_color,
               layout, booking_page_style, time_zone, default_schedule_id
        FROM member WHERE account_id = ${accountId} AND handle = ${handle} LIMIT 1`,
  );
}

export async function getEventType(
  db: Db,
  accountId: string,
  memberId: string,
  slug: string,
): Promise<EventTypeRow | undefined> {
  return db.get<EventTypeRow>(
    sql`SELECT id, account_id, member_id, team_id, slug, title, description, length_minutes,
               locations, schedule_id, scheduling_type, booking_fields, minimum_booking_notice,
               before_event_buffer, after_event_buffer, slot_interval, requires_confirmation,
               seats_per_time_slot
        FROM event_type
        WHERE account_id = ${accountId} AND member_id = ${memberId} AND slug = ${slug}
              AND hidden = 0 LIMIT 1`,
  );
}

export async function getMemberById(db: Db, id: string): Promise<MemberRow | undefined> {
  return db.get<MemberRow>(
    sql`SELECT id, account_id, handle, display_name, email, avatar_url, cover_url, brand_color,
               layout, booking_page_style, time_zone, default_schedule_id
        FROM member WHERE id = ${id} LIMIT 1`,
  );
}

export async function getEventTypeRowById(db: Db, id: string): Promise<EventTypeRow | undefined> {
  return db.get<EventTypeRow>(
    sql`SELECT id, account_id, member_id, team_id, slug, title, description, length_minutes,
               locations, schedule_id, scheduling_type, booking_fields, minimum_booking_notice,
               before_event_buffer, after_event_buffer, slot_interval, requires_confirmation,
               seats_per_time_slot
        FROM event_type WHERE id = ${id} LIMIT 1`,
  );
}

/**
 * B6: is `startMs` a REAL, currently-bookable slot for this host+event type?
 * Runs the SAME availability engine the booking flow uses — so it enforces the
 * schedule rules, min-notice, buffers, and "not in the past" — then checks the
 * instant is actually offered. Used to validate a reschedule target (the old
 * path only checked booking-overlap, letting a meeting move to 3 AM Sunday or
 * into the past). Resolves by member/event IDs so it works for personal AND
 * team bookings (a team event has no member handle). `excludeBookingId` drops
 * the booking being moved from the busy set so it can't block its own slot.
 */
export async function isSlotBookable(
  db: Db,
  args: {
    eventTypeId: string;
    hostMemberId: string;
    startMs: number;
    excludeBookingId?: string;
    now?: Date;
    calendar?: CalendarProvider;
  },
): Promise<boolean> {
  const eventType = await getEventTypeRowById(db, args.eventTypeId);
  const member = await getMemberById(db, args.hostMemberId);
  if (!eventType || !member) return false;

  const endMs = args.startMs + eventType.length_minutes * 60_000;
  const schedule =
    (await resolveScheduleTimeZone(db, eventType.schedule_id)) ??
    (await resolveScheduleTimeZone(db, member.default_schedule_id));
  const scheduleTimeZone = schedule?.timeZone ?? member.time_zone;
  const rules: AvailabilityRule[] = schedule ? await loadAvailabilityRules(db, schedule.id) : [];

  // Host busy over the target window, minus the booking being rescheduled.
  const exclude = args.excludeBookingId ? sql` AND id <> ${args.excludeBookingId}` : sql``;
  const rows = await db.all<{ start_ms: number; end_ms: number }>(
    sql`SELECT start_ms, end_ms FROM booking
        WHERE host_member_id = ${args.hostMemberId} AND status IN ('accepted','pending')
              AND start_ms < ${endMs} AND end_ms > ${args.startMs}${exclude}`,
  );
  // Fail-closed: an unreachable external calendar makes the target slot NOT
  // bookable (never move a meeting onto a conflict we couldn't see).
  let externalBusy: Interval[];
  try {
    externalBusy = await loadExternalBusy(db, args.calendar, args.hostMemberId, args.startMs, endMs);
  } catch {
    return false;
  }
  const busy: Interval[] = [
    ...rows.map((r) => ({ start: new Date(Number(r.start_ms)), end: new Date(Number(r.end_ms)) })),
    ...(await loadReservationBusy(db, args.hostMemberId, args.startMs, endMs, args.now?.getTime())),
    ...externalBusy,
  ];

  const slots = computeSlots({
    fromUtc: new Date(args.startMs),
    toUtc: new Date(endMs),
    timeZone: scheduleTimeZone,
    availability: rules,
    durationMin: eventType.length_minutes,
    slotIntervalMin: eventType.slot_interval,
    busy,
    beforeBufferMin: eventType.before_event_buffer,
    afterBufferMin: eventType.after_event_buffer,
    minimumBookingNoticeMin: eventType.minimum_booking_notice,
    now: args.now ?? new Date(),
  });
  return slots.some((d) => d.getTime() === args.startMs);
}

export interface PublicProfile {
  account: { code: string; name: string };
  member: {
    handle: string;
    displayName: string | null;
    timeZone: string;
    avatarUrl: string | null;
    coverUrl: string | null;
    brandColor: string | null;
    layout: string | null;
    style: Record<string, unknown> | null;
  };
  eventTypes: Array<{
    slug: string;
    title: string;
    description: string | null;
    lengthMinutes: number;
  }>;
}

export async function getPublicProfile(
  db: Db,
  accountCode: string,
  handle: string,
): Promise<PublicProfile | undefined> {
  const account = await getAccountByCode(db, accountCode);
  if (!account) return undefined;
  const member = await getMember(db, account.id, handle);
  if (!member || !member.handle) return undefined;
  const rows = await db.all<{
    slug: string;
    title: string;
    description: string | null;
    length_minutes: number;
  }>(
    sql`SELECT slug, title, description, length_minutes FROM event_type
        WHERE account_id = ${account.id} AND member_id = ${member.id} AND hidden = 0
        ORDER BY length_minutes ASC`,
  );
  return {
    // Public responses always carry the CANONICAL code (vanity ?? short) so
    // clients build/redirect to canonical links even when queried by an alias.
    account: { code: canonicalPublicCode(account), name: account.name },
    member: {
      handle: member.handle,
      displayName: member.display_name,
      timeZone: member.time_zone,
      avatarUrl: member.avatar_url,
      coverUrl: member.cover_url,
      brandColor: member.brand_color,
      layout: member.layout,
      style: parseJsonColumn<Record<string, unknown> | null>(member.booking_page_style, null),
    },
    eventTypes: rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      description: r.description,
      lengthMinutes: r.length_minutes,
    })),
  };
}

// --- Availability ---------------------------------------------------------

export interface BookingFieldDef {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

export interface AvailabilityResult {
  eventType: {
    slug: string;
    title: string;
    lengthMinutes: number;
    bookingFields: BookingFieldDef[];
  };
  timeZone: string;
  /** Each offered instant. `spotsLeft`/`capacity` are set only for group events (R23). */
  slots: Array<{ startUtc: string; spotsLeft?: number; capacity?: number }>;
  /**
   * Present only when `slots` is empty because of a CONFIGURATION error
   * (missing schedule, no hours, unreachable external calendar) — never for
   * genuine fully-booked / out-of-range emptiness.
   */
  emptyReason?: AvailabilityEmptyReason;
}

export async function loadAvailabilityRules(db: Db, scheduleId: string): Promise<AvailabilityRule[]> {
  const rows = await db.all<{
    days: string | null;
    start_time: string;
    end_time: string;
    date: string | null;
  }>(
    sql`SELECT days, start_time, end_time, date FROM availability WHERE schedule_id = ${scheduleId}`,
  );
  return rows.map((r) => ({
    days: r.days ? (JSON.parse(r.days) as number[]) : null,
    startTime: r.start_time,
    endTime: r.end_time,
    date: r.date,
  }));
}

export async function loadBusyForHost(
  db: Db,
  hostMemberId: string,
  fromMs: number,
  toMs: number,
  /**
   * Group events (seats > 1): the event's OWN bookings must not blank out their
   * slot — the slot stays offered until seats fill (spotsLeft handles capacity).
   * Pass the event's id to exclude its bookings from the host busy set.
   */
  excludeEventTypeId?: string,
): Promise<Interval[]> {
  const exclude = excludeEventTypeId ? sql` AND b.event_type_id <> ${excludeEventTypeId}` : sql``;
  // A member is busy for a booking whether they're the primary host_member_id OR
  // an assigned co-host (collective / fixed_round_robin) recorded in booking_host.
  const rows = await db.all<{ start_ms: number; end_ms: number }>(
    sql`SELECT b.start_ms, b.end_ms FROM booking b
        WHERE b.status IN ('accepted','pending')
              AND b.start_ms < ${toMs} AND b.end_ms > ${fromMs}${exclude}
              AND (b.host_member_id = ${hostMemberId}
                   OR EXISTS (SELECT 1 FROM booking_host bh
                              WHERE bh.booking_id = b.id AND bh.member_id = ${hostMemberId}))`,
  );
  return rows.map((r) => ({ start: new Date(Number(r.start_ms)), end: new Date(Number(r.end_ms)) }));
}

/** Active (unexpired) slot holds for a host — subtracted from availability. */
export async function loadReservationBusy(
  db: Db,
  memberId: string,
  fromMs: number,
  toMs: number,
  now = Date.now(),
): Promise<Interval[]> {
  const rows = await db.all<{ slot_start_ms: number; slot_end_ms: number }>(
    sql`SELECT slot_start_ms, slot_end_ms FROM slot_reservation
        WHERE member_id = ${memberId} AND release_at_ms > ${now}
              AND slot_start_ms < ${toMs} AND slot_end_ms > ${fromMs}`,
  );
  return rows.map((r) => ({
    start: new Date(Number(r.slot_start_ms)),
    end: new Date(Number(r.slot_end_ms)),
  }));
}

export async function resolveScheduleTimeZone(
  db: Db,
  scheduleId: string | null,
): Promise<{ id: string; timeZone: string } | undefined> {
  if (!scheduleId) return undefined;
  return db.get<{ id: string; timeZone: string }>(
    sql`SELECT id, time_zone AS "timeZone" FROM schedule WHERE id = ${scheduleId} LIMIT 1`,
  );
}

export async function getAvailability(
  db: Db,
  args: {
    accountCode: string;
    /** Public lookup: the member's public handle. */
    handle?: string;
    /** Host lookup: resolve the member by id — works for members with no handle
     *  yet (the authenticated host booking their own manual slots). */
    memberId?: string;
    slug: string;
    fromMs: number;
    toMs: number;
    displayTimeZone?: string;
    now?: Date;
  },
  /**
   * The wired CalendarProvider. When enabled, the host's external busy times are
   * subtracted from the offered slots. Undefined / disabled ⇒ local busy only
   * (the OSS clone-and-run default — no behavior change).
   */
  calendar?: CalendarProvider,
): Promise<AvailabilityResult | undefined> {
  const account = await getAccountByCode(db, args.accountCode);
  if (!account) return undefined;
  const member = args.memberId
    ? await getMemberById(db, args.memberId)
    : args.handle
      ? await getMember(db, account.id, args.handle)
      : undefined;
  // The by-id path must stay account-scoped (tenant isolation).
  if (!member || member.account_id !== account.id) return undefined;
  const eventType = await getEventType(db, account.id, member.id, args.slug);
  if (!eventType) return undefined;

  const referenced = await resolveScheduleTimeZone(db, eventType.schedule_id);
  const fallback = referenced
    ? undefined
    : await resolveScheduleTimeZone(db, member.default_schedule_id);
  const schedule = referenced ?? fallback;
  const scheduleTimeZone = schedule?.timeZone ?? member.time_zone;

  let rules: AvailabilityRule[] = [];
  if (schedule) rules = await loadAvailabilityRules(db, schedule.id);

  const eventTypeOut = {
    slug: eventType.slug,
    title: eventType.title,
    lengthMinutes: eventType.length_minutes,
    bookingFields: parseJsonColumn<BookingFieldDef[]>(eventType.booking_fields, []),
  };
  const displayTz = args.displayTimeZone ?? scheduleTimeZone;

  // Config errors (dangling schedule ref / no schedule / no hours) must be
  // RECOGNIZABLE, not a silent empty array — classify before computing.
  const configReason = classifyEmptyReason({
    referencedScheduleId: eventType.schedule_id,
    referencedScheduleExists: !!referenced,
    fallbackScheduleExists: !!fallback,
    ruleCount: rules.length,
  });
  if (configReason) {
    return { eventType: eventTypeOut, timeZone: displayTz, slots: [], emptyReason: configReason };
  }

  const capacity = eventType.seats_per_time_slot ?? 1;
  const isGroup = capacity > 1;

  // External busy is FAIL-CLOSED: if the connected calendar can't be read we
  // withhold slots (with a visible reason) rather than offer times that may
  // double-book — and rather than 500 on the whole request.
  let externalBusy: Interval[];
  try {
    externalBusy = await loadExternalBusy(db, calendar, member.id, args.fromMs, args.toMs);
  } catch {
    return {
      eventType: eventTypeOut,
      timeZone: displayTz,
      slots: [],
      emptyReason: 'CALENDAR_UNAVAILABLE',
    };
  }

  const busy = [
    // Group events don't self-block: their own bookings stay offered until full.
    ...(await loadBusyForHost(db, member.id, args.fromMs, args.toMs, isGroup ? eventType.id : undefined)),
    ...(await loadReservationBusy(db, member.id, args.fromMs, args.toMs, args.now?.getTime())),
    ...externalBusy,
  ];

  const slots = computeSlots({
    fromUtc: new Date(args.fromMs),
    toUtc: new Date(args.toMs),
    timeZone: scheduleTimeZone,
    availability: rules,
    durationMin: eventType.length_minutes,
    slotIntervalMin: eventType.slot_interval,
    busy,
    beforeBufferMin: eventType.before_event_buffer,
    afterBufferMin: eventType.after_event_buffer,
    minimumBookingNoticeMin: eventType.minimum_booking_notice,
    now: args.now ?? new Date(),
  });

  // Group events (R23): annotate each slot with seats left and drop full ones.
  let outSlots: Array<{ startUtc: string; spotsLeft?: number; capacity?: number }>;
  if (isGroup) {
    const taken = await seatsTakenByStart(db, eventType.id, args.fromMs, args.toMs);
    outSlots = slots
      .map((d) => {
        const ms = d.getTime();
        const spotsLeft = capacity - (taken.get(ms) ?? 0);
        return { startUtc: d.toISOString(), spotsLeft, capacity };
      })
      .filter((s) => (s.spotsLeft ?? 0) > 0);
  } else {
    outSlots = slots.map((d) => ({ startUtc: d.toISOString() }));
  }

  return { eventType: eventTypeOut, timeZone: displayTz, slots: outSlots };
}

/**
 * Seats consumed per start instant for a group event = attendee rows across its
 * accepted/pending bookings (one booking row per slot, N attendees ≤ capacity).
 */
async function seatsTakenByStart(
  db: Db,
  eventTypeId: string,
  fromMs: number,
  toMs: number,
): Promise<Map<number, number>> {
  const rows = await db.all<{ start_ms: number; seats: number }>(
    sql`SELECT b.start_ms AS start_ms, COUNT(a.id) AS seats
        FROM booking b JOIN booking_attendee a ON a.booking_id = b.id
        WHERE b.event_type_id = ${eventTypeId} AND b.status IN ('accepted','pending')
              AND b.start_ms >= ${fromMs} AND b.start_ms < ${toMs}
        GROUP BY b.start_ms`,
  );
  return new Map(rows.map((r) => [Number(r.start_ms), Number(r.seats)]));
}

// --- Create booking (the atomic, dual-enforced write) ---------------------

function overlapExists(db: Db, hostMemberId: string, startMs: number, endMs: number): boolean {
  // SQLite synchronous read via the native drizzle instance (inside a txn).
  const row = db.sqlite!.drizzle.get<{ id: string }>(
    sql`SELECT id FROM booking WHERE host_member_id = ${hostMemberId} AND status IN ('accepted','pending')
        AND start_ms < ${endMs} AND end_ms > ${startMs} LIMIT 1`,
  );
  return !!row;
}

export async function createBooking(
  db: Db,
  args: CreateBookingArgs,
  /**
   * Wired CalendarProvider: the create path re-checks the host's external busy
   * over the booking window (fail-closed). Undefined/disabled ⇒ local-only,
   * exactly the pre-existing clone-and-run behavior.
   */
  calendar?: CalendarProvider,
): Promise<BookingOutcome> {
  const account = await getAccountByCode(db, args.accountCode);
  if (!account) return { ok: false, reason: 'NOT_FOUND' };
  const member = args.memberId
    ? await getMemberById(db, args.memberId)
    : args.handle
      ? await getMember(db, account.id, args.handle)
      : undefined;
  // The by-id path must stay account-scoped (tenant isolation).
  if (!member || member.account_id !== account.id) return { ok: false, reason: 'NOT_FOUND' };
  const eventType = await getEventType(db, account.id, member.id, args.slug);
  if (!eventType) return { ok: false, reason: 'NOT_FOUND' };

  // Required-intake validation (server-side; never trust the client).
  const fields = parseJsonColumn<BookingFieldDef[]>(eventType.booking_fields, []);
  const invalid = validateIntakeAnswers(fields, args.answers);
  if (invalid) return { ok: false, reason: 'INVALID', message: invalid };

  // Idempotency: return the prior booking for a repeated key.
  if (args.idempotencyKey) {
    const prior = await findBookingByIdempotencyKey(db, args.idempotencyKey);
    // Replay: return the existing booking, do NOT re-mint the token, and flag it
    // deduplicated (B3 — contract).
    if (prior) return { ok: true, booking: prior.record, manageToken: '', deduplicated: true };
  }

  // Hold validation at consume: a reservation that is missing or expired → 410.
  // (The two-layer expiry: app-level release_at check here + the DB sweep.)
  if (args.reservationUid) {
    const hold = await db.get<{ release_at_ms: number }>(
      sql`SELECT release_at_ms FROM slot_reservation WHERE uid = ${args.reservationUid} LIMIT 1`,
    );
    if (!hold) return { ok: false, reason: 'RESERVATION_EXPIRED' };
    if (Number(hold.release_at_ms) <= Date.now()) {
      await db.run(sql`DELETE FROM slot_reservation WHERE uid = ${args.reservationUid}`);
      return { ok: false, reason: 'RESERVATION_EXPIRED' };
    }
  }

  const startMs = args.startMs;
  const endMs = startMs + eventType.length_minutes * 60_000;

  // R23 group events (seats > 1): a slot is ONE booking row that accrues up to
  // `capacity` attendees. A second+ booker adds a seat to the existing row
  // (so it never trips the one-accepted-per-slot overlap/EXCLUDE guard); the
  // FIRST booker falls through to the normal create below.
  const capacity = eventType.seats_per_time_slot ?? 1;
  if (capacity > 1) {
    const existing = await db.get<{ id: string; uid: string; status: string; start_ms: number; end_ms: number }>(
      sql`SELECT id, uid, status, start_ms, end_ms FROM booking
          WHERE event_type_id = ${eventType.id} AND host_member_id = ${member.id}
                AND start_ms = ${startMs} AND status IN ('accepted','pending') LIMIT 1`,
    );
    if (existing) {
      // NOTE: check-then-insert can transiently over-fill by one under a rare
      // concurrent race; acceptable for v1 (one row, no EXCLUDE involved).
      const seats = await db.get<{ n: number }>(
        sql`SELECT COUNT(*) AS n FROM booking_attendee WHERE booking_id = ${existing.id}`,
      );
      if (Number(seats?.n ?? 0) >= capacity) return { ok: false, reason: 'SLOT_TAKEN' };
      await db.run(
        sql`INSERT INTO booking_attendee (id, booking_id, name, email, time_zone, phone, notes, created_at)
            VALUES (${randomUUID()}, ${existing.id}, ${args.attendee.name}, ${args.attendee.email},
              ${args.attendee.timeZone}, ${args.attendee.phone ?? null}, ${args.attendee.notes ?? null}, ${Date.now()})`,
      );
      if (args.reservationUid)
        await db.run(sql`DELETE FROM slot_reservation WHERE uid = ${args.reservationUid}`);
      const rec: BookingRecord = {
        uid: existing.uid,
        status: existing.status,
        title: eventType.title,
        startMs: Number(existing.start_ms),
        endMs: Number(existing.end_ms),
        hostHandle: member.handle,
        hostName: member.display_name,
        attendee: { name: args.attendee.name, email: args.attendee.email, timeZone: args.attendee.timeZone },
      };
      // Seat-takers join the shared group booking; the manage link stays with
      // the first booker (per-seat manage tokens are a follow-up).
      return { ok: true, booking: rec, manageToken: '' };
    }
  }

  // External-calendar conflict check at CREATE time (error-visibility §5).
  // Availability reads already subtract external busy, but the create path
  // previously trusted the read blindly — a slot gone busy on the connected
  // calendar between read and book was silently double-booked. Policy:
  // fail-closed — a conflict rejects the slot, and an UNREADABLE calendar
  // blocks the booking visibly instead of booking blind.
  try {
    const externalBusy = await loadExternalBusy(db, calendar, member.id, startMs, endMs);
    if (externalBusy.some((b) => b.start.getTime() < endMs && b.end.getTime() > startMs)) {
      return { ok: false, reason: 'SLOT_TAKEN' };
    }
  } catch {
    return { ok: false, reason: 'CALENDAR_UNAVAILABLE' };
  }

  const now = Date.now();
  const uid = randomUUID();
  const bookingId = randomUUID();
  const attendeeId = randomUUID();
  const { token, tokenHash } = generateManageToken();
  const metadata = JSON.stringify({ _manage: { tokenHash } });
  const title = eventType.title;

  // Postgres stores metadata as jsonb (source-of-truth, full power); the bound
  // text param is cast on write. SQLite stores the same JSON as text.
  // requiresConfirmation → the booking starts 'pending' (host confirms later);
  // otherwise 'accepted'. Pending still HOLDS the slot (overlap check includes it).
  const status = eventType.requires_confirmation ? 'pending' : 'accepted';
  const metaExpr = db.dialect === 'postgres' ? sql`${metadata}::jsonb` : sql`${metadata}`;
  const responsesExpr = jsonParam(db, args.answers ?? null);
  // Snapshot the event type's configured Where onto the booking so the manage
  // page (and calendar write-out) can show it, even if the event is edited later.
  const eventLocation = parseJsonColumn<string | null>(eventType.locations, null);
  const insertBooking = sql`
    INSERT INTO booking (id, account_id, uid, event_type_id, host_member_id, title, location,
      start_ms, end_ms, status, metadata, responses, attendee_time_zone, idempotency_key,
      created_at, updated_at)
    VALUES (${bookingId}, ${account.id}, ${uid}, ${eventType.id}, ${member.id}, ${title}, ${eventLocation},
      ${startMs}, ${endMs}, ${status}, ${metaExpr}, ${responsesExpr}, ${args.attendee.timeZone},
      ${args.idempotencyKey ?? null}, ${now}, ${now})`;
  const insertAttendee = sql`
    INSERT INTO booking_attendee (id, booking_id, name, email, time_zone, phone, notes, created_at)
    VALUES (${attendeeId}, ${bookingId}, ${args.attendee.name}, ${args.attendee.email},
      ${args.attendee.timeZone}, ${args.attendee.phone ?? null}, ${args.attendee.notes ?? null}, ${now})`;

  const record: BookingRecord = {
    uid,
    status,
    title,
    startMs,
    endMs,
    hostHandle: member.handle,
    hostName: member.display_name,
    attendee: {
      name: args.attendee.name,
      email: args.attendee.email,
      timeZone: args.attendee.timeZone,
    },
  };

  if (db.dialect === 'sqlite') {
    const outcome = db.sqlite!.txn<'ok' | 'conflict'>(() => {
      if (overlapExists(db, member.id, startMs, endMs)) return 'conflict';
      db.sqlite!.drizzle.run(insertBooking);
      db.sqlite!.drizzle.run(insertAttendee);
      return 'ok';
    });
    if (outcome === 'conflict') return { ok: false, reason: 'SLOT_TAKEN' };
    if (args.reservationUid) await db.run(sql`DELETE FROM slot_reservation WHERE uid = ${args.reservationUid}`);
    return { ok: true, booking: record, manageToken: token };
  }

  // Postgres: async transaction; the EXCLUDE constraint is the ultimate backstop.
  const pg = db.pg!.drizzle;
  try {
    const conflicted = await pg.transaction(async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT id FROM booking WHERE host_member_id = ${member.id} AND status IN ('accepted','pending')
            AND start_ms < ${endMs} AND end_ms > ${startMs} LIMIT 1`,
      )) as unknown as Array<{ id: string }>;
      if (rows.length > 0) return true;
      await tx.execute(insertBooking);
      await tx.execute(insertAttendee);
      return false;
    });
    if (conflicted) return { ok: false, reason: 'SLOT_TAKEN' };
    if (args.reservationUid) await db.run(sql`DELETE FROM slot_reservation WHERE uid = ${args.reservationUid}`);
    return { ok: true, booking: record, manageToken: token };
  } catch (err) {
    if (isExclusionViolation(err) || isUniqueViolation(err)) {
      return { ok: false, reason: 'SLOT_TAKEN' };
    }
    throw err;
  }
}

async function findBookingByIdempotencyKey(
  db: Db,
  key: string,
): Promise<{ record: BookingRecord } | undefined> {
  const row = await db.get<{
    uid: string;
    status: string;
    title: string;
    start_ms: number;
    end_ms: number;
    host_handle: string | null;
    host_name: string | null;
    att_name: string | null;
    att_email: string | null;
    att_tz: string | null;
  }>(
    sql`SELECT b.uid, b.status, b.title, b.start_ms, b.end_ms,
               m.handle AS host_handle, m.display_name AS host_name,
               a.name AS att_name, a.email AS att_email, a.time_zone AS att_tz
        FROM booking b
        LEFT JOIN member m ON m.id = b.host_member_id
        LEFT JOIN booking_attendee a ON a.booking_id = b.id
        WHERE b.idempotency_key = ${key} LIMIT 1`,
  );
  if (!row) return undefined;
  return {
    record: {
      uid: row.uid,
      status: row.status,
      title: row.title,
      startMs: Number(row.start_ms),
      endMs: Number(row.end_ms),
      hostHandle: row.host_handle,
      hostName: row.host_name,
      attendee: {
        name: row.att_name ?? '',
        email: row.att_email ?? '',
        timeZone: row.att_tz ?? 'UTC',
      },
    },
  };
}
