/**
 * Parity repository — the modules ported from the original service beyond the
 * core booking path: reservation holds, identity/multi-tenant, branding/studio
 * persistence, teams + round-robin, reschedule/cancel, host bookings, and the
 * connections/api-keys/webhooks surfaces. Same clean/portable/Postgres-first
 * shape as repository.ts (raw portable SQL through the Db handle, JSON via the
 * parseJsonColumn/jsonParam helpers).
 */
import { randomUUID, createHash, randomBytes, createHmac } from 'node:crypto';
import {
  RESERVED_PUBLIC_SLUGS,
  classifyEmptyReason,
  computeSlots,
  generateManageToken,
  intersectInstants,
  selectFixedRoundRobinHosts,
  selectLuckyHost,
  unionInstants,
  verifyManageToken,
  type AvailabilityEmptyReason,
  type AvailabilityRule,
  type HostCandidate,
  type Interval,
} from '@slate/engine';
import type { CalendarProvider } from '@slate/calendar';
import { sql, type Db } from './client';
import {
  getAccountByCode,
  getAvailability,
  getEventType,
  getMember,
  isSlotBookable,
  jsonParam,
  loadAvailabilityRules,
  loadBusyForHost,
  loadReservationBusy,
  parseJsonColumn,
  resolveScheduleTimeZone,
  type BookingFieldDef,
} from './repository';
import { loadExternalBusy } from './calendar-refs';
import { canonicalPublicCode } from './short-links';
import { checkWebhookUrl } from './webhook-url';
import { enqueueOutbox } from './outbox';

// --- Reservation holds ----------------------------------------------------

const DEFAULT_HOLD_MS = 10 * 60_000;
/** Cap on concurrent unexpired holds per booking page (per host member). */
const MAX_ACTIVE_HOLDS_PER_MEMBER = 10;

export async function releaseReservation(db: Db, uid: string): Promise<void> {
  await db.run(sql`DELETE FROM slot_reservation WHERE uid = ${uid}`);
}

export async function sweepExpiredReservations(db: Db, now = Date.now()): Promise<void> {
  await db.run(sql`DELETE FROM slot_reservation WHERE release_at_ms <= ${now}`);
}

export type ReserveOutcome =
  | { ok: true; uid: string; releaseAtMs: number }
  | { ok: false; reason: 'NOT_FOUND' | 'INVALID_SLOT' | 'RATE_LIMITED' };

/**
 * Place a soft hold on a slot. Hardened (M5):
 *  - opportunistically sweeps expired holds so rows can't accrete;
 *  - validates the requested start is a REAL, currently-bookable slot (no
 *    holding arbitrary/blocked instants to blank out a page's availability);
 *  - caps concurrent unexpired holds per page to blunt hold-spam DoS.
 */
export async function reserveSlot(
  db: Db,
  args: { accountCode: string; handle: string; slug: string; startMs: number; holdMs?: number },
): Promise<ReserveOutcome> {
  const now = Date.now();
  await sweepExpiredReservations(db, now);

  const account = await getAccountByCode(db, args.accountCode);
  if (!account) return { ok: false, reason: 'NOT_FOUND' };
  const member = await getMember(db, account.id, args.handle);
  if (!member) return { ok: false, reason: 'NOT_FOUND' };
  const eventType = await getEventType(db, account.id, member.id, args.slug);
  if (!eventType) return { ok: false, reason: 'NOT_FOUND' };

  const endMs = args.startMs + eventType.length_minutes * 60_000;

  // The requested start must currently be offered by the availability engine.
  const avail = await getAvailability(db, {
    accountCode: args.accountCode,
    handle: args.handle,
    slug: args.slug,
    fromMs: args.startMs,
    toMs: endMs,
  });
  const offered = avail?.slots.some((s) => new Date(s.startUtc).getTime() === args.startMs) ?? false;
  if (!offered) return { ok: false, reason: 'INVALID_SLOT' };

  // Per-page hold cap (rate limit).
  const active = await db.get<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM slot_reservation WHERE member_id = ${member.id} AND release_at_ms > ${now}`,
  );
  if (Number(active?.n ?? 0) >= MAX_ACTIVE_HOLDS_PER_MEMBER)
    return { ok: false, reason: 'RATE_LIMITED' };

  const uid = randomUUID();
  const releaseAtMs = now + (args.holdMs ?? DEFAULT_HOLD_MS);
  await db.run(
    sql`INSERT INTO slot_reservation (id, account_id, event_type_id, member_id, slot_start_ms,
          slot_end_ms, uid, release_at_ms, is_seat, created_at)
        VALUES (${randomUUID()}, ${account.id}, ${eventType.id}, ${member.id}, ${args.startMs},
          ${endMs}, ${uid}, ${releaseAtMs}, 0, ${now})`,
  );
  return { ok: true, uid, releaseAtMs };
}

// --- Identity / multi-tenant ----------------------------------------------

export interface MeView {
  accountId: string;
  /** The CANONICAL public code (vanity slug when claimed, else the short code). */
  accountCode: string;
  /** The immutable short code — stays a permanent alias while a vanity is set. */
  accountShortCode: string;
  vanitySlug: string | null;
  memberId: string;
  handle: string | null;
  displayName: string | null;
  email: string | null;
  timeZone: string | null;
  locale: string | null;
  /** Account-level role — the FE gates admin-only surfaces on this. */
  role: string;
  status: string;
}

/** Resolve the authenticated principal's account + member for /me. */
export async function getMe(
  db: Db,
  accountId: string,
  memberId?: string,
): Promise<MeView | null> {
  const account = await db.get<{ id: string; code: string; vanity_slug: string | null }>(
    sql`SELECT id, code, vanity_slug FROM account WHERE id = ${accountId} LIMIT 1`,
  );
  if (!account) return null;
  const member = await db.get<{
    id: string;
    handle: string | null;
    display_name: string | null;
    email: string | null;
    time_zone: string | null;
    locale: string | null;
    role: string;
    status: string;
  }>(
    memberId
      ? sql`SELECT id, handle, display_name, email, time_zone, locale, role, status FROM member WHERE id = ${memberId} AND account_id = ${accountId} LIMIT 1`
      : sql`SELECT id, handle, display_name, email, time_zone, locale, role, status FROM member WHERE account_id = ${accountId} ORDER BY created_at ASC LIMIT 1`,
  );
  if (!member) return null;
  return {
    accountId: account.id,
    accountCode: canonicalPublicCode(account),
    accountShortCode: account.code,
    vanitySlug: account.vanity_slug,
    memberId: member.id,
    handle: member.handle,
    displayName: member.display_name,
    email: member.email,
    timeZone: member.time_zone,
    locale: member.locale,
    role: member.role ?? 'member',
    status: member.status ?? 'active',
  };
}

// Unified with the vanity-slug blocklist (@slate/engine) so a handle can never
// shadow an app route the vanity rules protect — one server source of truth.
const RESERVED_HANDLES = RESERVED_PUBLIC_SLUGS;

export interface HandleAvailability {
  handle: string;
  available: boolean;
  reason: string | null;
  /** A free alternative to offer when the requested handle is taken (D18). */
  suggestion?: string;
}

async function isHandleFree(
  db: Db,
  accountId: string,
  h: string,
  excludeMemberId?: string,
): Promise<boolean> {
  if (RESERVED_HANDLES.has(h)) return false;
  const row = await db.get<{ id: string }>(
    sql`SELECT id FROM member WHERE account_id = ${accountId} AND handle = ${h} LIMIT 1`,
  );
  return !row || row.id === excludeMemberId;
}

export async function checkHandleAvailable(
  db: Db,
  accountId: string,
  handle: string,
  excludeMemberId?: string,
): Promise<HandleAvailability> {
  const h = handle.toLowerCase();
  if (h.length < 3) return { handle: h, available: false, reason: 'too_short' };
  if (h.length > 40) return { handle: h, available: false, reason: 'too_long' };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(h))
    return { handle: h, available: false, reason: 'invalid' };
  if (RESERVED_HANDLES.has(h)) return { handle: h, available: false, reason: 'reserved' };
  if (!(await isHandleFree(db, accountId, h, excludeMemberId))) {
    // Offer the first free handle-N (D18 — old contract returns a suggestion).
    let suggestion: string | undefined;
    for (let n = 2; n <= 99; n++) {
      const candidate = `${h}-${n}`.slice(0, 40);
      if (await isHandleFree(db, accountId, candidate, excludeMemberId)) {
        suggestion = candidate;
        break;
      }
    }
    return { handle: h, available: false, reason: 'taken', suggestion };
  }
  return { handle: h, available: true, reason: null };
}

// --- Branding / studio persistence ----------------------------------------

export interface BrandingPatch {
  displayName?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  brandColor?: string | null;
  layout?: string | null;
  style?: Record<string, unknown>;
}

export async function updateBranding(
  db: Db,
  memberId: string,
  patch: BrandingPatch,
): Promise<boolean> {
  const sets: ReturnType<typeof sql>[] = [];
  if ('displayName' in patch) sets.push(sql`display_name = ${patch.displayName ?? null}`);
  if ('avatarUrl' in patch) sets.push(sql`avatar_url = ${patch.avatarUrl ?? null}`);
  if ('coverUrl' in patch) sets.push(sql`cover_url = ${patch.coverUrl ?? null}`);
  if ('brandColor' in patch) sets.push(sql`brand_color = ${patch.brandColor ?? null}`);
  if ('layout' in patch) sets.push(sql`layout = ${patch.layout ?? null}`);
  if ('style' in patch) sets.push(sql`booking_page_style = ${jsonParam(db, patch.style ?? null)}`);
  if (sets.length === 0) return true;
  const assignments = sets.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`));
  await db.run(sql`UPDATE member SET ${assignments} WHERE id = ${memberId}`);
  return true;
}

/** Update a member's general settings (timezone, locale, week start). */
export async function updateMemberSettings(
  db: Db,
  memberId: string,
  patch: { timeZone?: string; locale?: string | null; weekStart?: string; displayName?: string | null },
): Promise<void> {
  const sets: ReturnType<typeof sql>[] = [];
  if (patch.timeZone !== undefined) sets.push(sql`time_zone = ${patch.timeZone}`);
  if (patch.locale !== undefined) sets.push(sql`locale = ${patch.locale ?? null}`);
  if (patch.weekStart !== undefined) sets.push(sql`week_start = ${patch.weekStart}`);
  if (patch.displayName !== undefined) sets.push(sql`display_name = ${patch.displayName ?? null}`);
  if (sets.length === 0) return;
  const assign = sets.reduce((a, c, i) => (i === 0 ? c : sql`${a}, ${c}`));
  await db.run(sql`UPDATE member SET ${assign} WHERE id = ${memberId}`);
}

/** Rename a member's public handle (checked available first by the caller). */
export async function updateHandle(db: Db, memberId: string, handle: string): Promise<void> {
  await db.run(sql`UPDATE member SET handle = ${handle} WHERE id = ${memberId}`);
}

// --- Teams ----------------------------------------------------------------

export interface TeamProfileView {
  account: { code: string; name: string };
  team: { slug: string; name: string; logoUrl: string | null; timeZone: string };
  eventTypes: Array<{
    slug: string;
    title: string;
    description: string | null;
    lengthMinutes: number;
    schedulingType: string | null;
  }>;
}

async function getTeamBySlug(db: Db, accountId: string, teamSlug: string) {
  return db.get<{ id: string; slug: string; name: string; logo_url: string | null; time_zone: string }>(
    sql`SELECT id, slug, name, logo_url, time_zone FROM team WHERE account_id = ${accountId} AND slug = ${teamSlug} LIMIT 1`,
  );
}

export async function getTeamProfile(
  db: Db,
  accountCode: string,
  teamSlug: string,
): Promise<TeamProfileView | null> {
  const account = await getAccountByCode(db, accountCode);
  if (!account) return null;
  const team = await getTeamBySlug(db, account.id, teamSlug);
  if (!team) return null;
  const rows = await db.all<{
    slug: string;
    title: string;
    description: string | null;
    length_minutes: number;
    scheduling_type: string | null;
  }>(
    sql`SELECT slug, title, description, length_minutes, scheduling_type FROM event_type
        WHERE account_id = ${account.id} AND team_id = ${team.id} AND hidden = 0
        ORDER BY length_minutes ASC`,
  );
  return {
    // Canonical code always (vanity ?? short) — clients redirect aliases to it.
    account: { code: canonicalPublicCode(account), name: account.name },
    team: { slug: team.slug, name: team.name, logoUrl: team.logo_url, timeZone: team.time_zone },
    eventTypes: rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      description: r.description,
      lengthMinutes: r.length_minutes,
      schedulingType: r.scheduling_type,
    })),
  };
}

interface TeamEventType {
  id: string;
  account_id: string;
  team_id: string;
  slug: string;
  title: string;
  length_minutes: number;
  locations: unknown;
  slot_interval: number | null;
  minimum_booking_notice: number;
  before_event_buffer: number;
  after_event_buffer: number;
  scheduling_type: string | null;
  booking_fields: unknown;
}

async function getTeamEventType(db: Db, accountId: string, teamId: string, slug: string) {
  return db.get<TeamEventType>(
    sql`SELECT id, account_id, team_id, slug, title, length_minutes, locations, slot_interval,
               minimum_booking_notice, before_event_buffer, after_event_buffer, scheduling_type,
               booking_fields
        FROM event_type
        WHERE account_id = ${accountId} AND team_id = ${teamId} AND slug = ${slug} AND hidden = 0
        LIMIT 1`,
  );
}

interface EventHostRow {
  member_id: string;
  is_fixed: number;
  priority: number | null;
  weight: number | null;
  schedule_id: string | null;
}

async function getEventHosts(db: Db, eventTypeId: string): Promise<EventHostRow[]> {
  return db.all<EventHostRow>(
    sql`SELECT member_id, is_fixed, priority, weight, schedule_id FROM event_type_host
        WHERE event_type_id = ${eventTypeId}`,
  );
}

/**
 * Free slot instants (ms) for one host of a team event, over the window —
 * plus the config-error reason when the host can offer nothing because of
 * broken configuration (dangling/missing schedule, no hours, unreadable
 * external calendar), so team availability can surface WHY it's empty.
 */
async function hostFreeSlotMs(
  db: Db,
  host: EventHostRow,
  et: TeamEventType,
  fromMs: number,
  toMs: number,
  now: Date,
  calendar?: CalendarProvider,
): Promise<{ free: Set<number>; reason: AvailabilityEmptyReason | null }> {
  const member = await db.get<{ time_zone: string; default_schedule_id: string | null }>(
    sql`SELECT time_zone, default_schedule_id FROM member WHERE id = ${host.member_id} LIMIT 1`,
  );
  if (!member) return { free: new Set(), reason: 'NO_SCHEDULE' };
  const referenced = await resolveScheduleTimeZone(db, host.schedule_id);
  const fallback = referenced
    ? undefined
    : await resolveScheduleTimeZone(db, member.default_schedule_id);
  const schedule = referenced ?? fallback;
  const tz = schedule?.timeZone ?? member.time_zone;
  let rules: AvailabilityRule[] = [];
  if (schedule) rules = await loadAvailabilityRules(db, schedule.id);

  const configReason = classifyEmptyReason({
    referencedScheduleId: host.schedule_id,
    referencedScheduleExists: !!referenced,
    fallbackScheduleExists: !!fallback,
    ruleCount: rules.length,
  });
  if (configReason) return { free: new Set(), reason: configReason };

  // Fail-closed: an unreadable external calendar contributes NO free slots
  // (never offer times we couldn't conflict-check) and reports why.
  let externalBusy: Interval[];
  try {
    externalBusy = await loadExternalBusy(db, calendar, host.member_id, fromMs, toMs);
  } catch {
    return { free: new Set(), reason: 'CALENDAR_UNAVAILABLE' };
  }
  const busy: Interval[] = [
    ...(await loadBusyForHost(db, host.member_id, fromMs, toMs)),
    ...(await loadReservationBusy(db, host.member_id, fromMs, toMs, now.getTime())),
    ...externalBusy,
  ];
  const slots = computeSlots({
    fromUtc: new Date(fromMs),
    toUtc: new Date(toMs),
    timeZone: tz,
    availability: rules,
    durationMin: et.length_minutes,
    slotIntervalMin: et.slot_interval,
    busy,
    beforeBufferMin: et.before_event_buffer,
    afterBufferMin: et.after_event_buffer,
    minimumBookingNoticeMin: et.minimum_booking_notice,
    now,
  });
  return { free: new Set(slots.map((d) => d.getTime())), reason: null };
}

export interface TeamAvailabilityResult {
  eventType: {
    slug: string;
    title: string;
    lengthMinutes: number;
    bookingFields: BookingFieldDef[];
    schedulingType: string | null;
  };
  timeZone: string;
  slots: string[];
  /** Present only when `slots` is empty because of a configuration error. */
  emptyReason?: AvailabilityEmptyReason;
}

/** The three FREE team scheduling methods; null/unknown → round_robin. */
export type TeamSchedulingMethod = 'round_robin' | 'collective' | 'fixed_round_robin';

export function normalizeSchedulingMethod(raw: string | null | undefined): TeamSchedulingMethod {
  return raw === 'collective' || raw === 'fixed_round_robin' ? raw : 'round_robin';
}

/**
 * Combine per-host free-slot sets into the slots the team offers, per method:
 *   - round_robin       → UNION (any host free; host chosen at booking time).
 *   - collective        → INTERSECTION (every host must be free — all attend).
 *   - fixed_round_robin  → all fixed hosts free ∩ (≥1 rotating host free);
 *     with no fixed hosts it degrades to round_robin, with no rotating hosts to
 *     collective over the fixed set.
 */
function combineTeamSlots(
  method: TeamSchedulingMethod,
  hostSets: Array<{ isFixed: boolean; free: Set<number> }>,
): number[] {
  if (hostSets.length === 0) return [];
  const all = hostSets.map((h) => h.free);
  if (method === 'collective') return intersectInstants(all);
  if (method === 'fixed_round_robin') {
    const fixed = hostSets.filter((h) => h.isFixed).map((h) => h.free);
    const rotating = hostSets.filter((h) => !h.isFixed).map((h) => h.free);
    if (fixed.length === 0) return unionInstants(rotating); // misconfigured → plain RR
    const fixedAllFree = intersectInstants(fixed);
    if (rotating.length === 0) return fixedAllFree; // fixed-only → collective over fixed
    const rotUnion = new Set(unionInstants(rotating));
    return fixedAllFree.filter((ms) => rotUnion.has(ms));
  }
  return unionInstants(all); // round_robin
}

/**
 * Team availability, combined across hosts per the event's scheduling method
 * (UNION for round-robin, INTERSECTION for collective, fixed∩union for
 * fixed round-robin). The concrete host(s) are assigned at booking time.
 */
export async function getTeamAvailability(
  db: Db,
  args: {
    accountCode: string;
    teamSlug: string;
    slug: string;
    fromMs: number;
    toMs: number;
    displayTimeZone?: string;
    now?: Date;
  },
  /** Wired provider — each host's external busy is subtracted. See getAvailability. */
  calendar?: CalendarProvider,
): Promise<TeamAvailabilityResult | null> {
  const account = await getAccountByCode(db, args.accountCode);
  if (!account) return null;
  const team = await getTeamBySlug(db, account.id, args.teamSlug);
  if (!team) return null;
  const et = await getTeamEventType(db, account.id, team.id, args.slug);
  if (!et) return null;
  const hosts = await getEventHosts(db, et.id);
  const now = args.now ?? new Date();
  const method = normalizeSchedulingMethod(et.scheduling_type);

  const hostSets: Array<{ isFixed: boolean; free: Set<number>; reason: AvailabilityEmptyReason | null }> = [];
  for (const host of hosts) {
    const { free, reason } = await hostFreeSlotMs(db, host, et, args.fromMs, args.toMs, now, calendar);
    hostSets.push({ isFixed: host.is_fixed === 1, free, reason });
  }
  const slots = combineTeamSlots(method, hostSets).map((ms) => new Date(ms).toISOString());
  return {
    eventType: {
      slug: et.slug,
      title: et.title,
      lengthMinutes: et.length_minutes,
      bookingFields: parseJsonColumn<BookingFieldDef[]>(et.booking_fields, []),
      schedulingType: et.scheduling_type,
    },
    timeZone: args.displayTimeZone ?? team.time_zone,
    slots,
    emptyReason: slots.length === 0 ? teamEmptyReason(method, hosts.length, hostSets) : undefined,
  };
}

/**
 * Attribute an empty team window to configuration when the method makes the
 * broken host(s) decisive:
 *   - any host failing CALENDAR_UNAVAILABLE ⇒ we failed closed, report it;
 *   - collective (and the fixed set of fixed_round_robin): ONE broken host
 *     empties the intersection ⇒ report that host's reason;
 *   - round_robin (union): only when EVERY host is broken is emptiness a
 *     config error — otherwise a healthy host was genuinely busy.
 */
function teamEmptyReason(
  method: TeamSchedulingMethod,
  hostCount: number,
  hostSets: Array<{ isFixed: boolean; reason: AvailabilityEmptyReason | null }>,
): AvailabilityEmptyReason | undefined {
  if (hostCount === 0) return 'NO_HOSTS';
  const precedence: AvailabilityEmptyReason[] = ['SCHEDULE_MISSING', 'NO_SCHEDULE', 'NO_HOURS'];
  const pick = (reasons: Array<AvailabilityEmptyReason | null>): AvailabilityEmptyReason | undefined =>
    precedence.find((r) => reasons.includes(r));
  const all = hostSets.map((h) => h.reason);
  if (all.includes('CALENDAR_UNAVAILABLE')) return 'CALENDAR_UNAVAILABLE';
  if (method === 'collective') return pick(all);
  if (method === 'fixed_round_robin') {
    const fixedReasons = hostSets.filter((h) => h.isFixed).map((h) => h.reason);
    const fromFixed = pick(fixedReasons);
    if (fromFixed) return fromFixed;
  }
  return all.every((r) => r !== null) ? pick(all) : undefined;
}

export type TeamBookingOutcome =
  | { ok: true; uid: string; hostMemberId: string; manageToken: string }
  | { ok: false; reason: 'NOT_FOUND' | 'SLOT_TAKEN' | 'INVALID' | 'CALENDAR_UNAVAILABLE'; message?: string };

/** True (as a 1-row SELECT) if `memberId` already holds an overlapping booking —
 * whether as the primary host_member_id OR an assigned co-host (booking_host). */
function memberOverlapSql(memberId: string, startMs: number, endMs: number) {
  return sql`SELECT b.id FROM booking b
    WHERE b.status IN ('accepted','pending')
      AND b.start_ms < ${endMs} AND b.end_ms > ${startMs}
      AND (b.host_member_id = ${memberId}
           OR EXISTS (SELECT 1 FROM booking_host bh WHERE bh.booking_id = b.id AND bh.member_id = ${memberId}))
    LIMIT 1`;
}

/** The organizer (booking.host_member_id) for a resolved assignment. */
function pickOrganizer(
  method: TeamSchedulingMethod,
  assigned: [HostCandidate, ...HostCandidate[]],
): HostCandidate {
  if (method === 'fixed_round_robin') {
    // Prefer a fixed host as the durable organizer (always present); fair among them.
    const fixed = assigned.filter((h) => h.isFixed);
    return selectLuckyHost(fixed) ?? selectLuckyHost(assigned) ?? assigned[0];
  }
  // collective: rotate the organizer role fairly; round_robin: the sole host.
  return selectLuckyHost(assigned) ?? assigned[0];
}

/**
 * Book a team event, resolving the assigned host set from the event's scheduling
 * method (round_robin = one fair host; collective = ALL hosts; fixed_round_robin
 * = every fixed host + one rotating pick), then inserting under a dual-enforced
 * overlap guard applied to EVERY assigned host. Multi-host bookings also record
 * a booking_host row per host so calendar write-out and notifications fan out to
 * all of them.
 */
export async function createTeamBooking(
  db: Db,
  args: {
    accountCode: string;
    teamSlug: string;
    slug: string;
    startMs: number;
    attendee: { name: string; email: string; timeZone: string; notes?: string; phone?: string };
    answers?: Record<string, unknown>;
  },
  /** Wired CalendarProvider — candidate hosts are conflict-checked against
   *  their external calendars, fail-closed (see createBooking). */
  calendar?: CalendarProvider,
): Promise<TeamBookingOutcome> {
  const account = await getAccountByCode(db, args.accountCode);
  if (!account) return { ok: false, reason: 'NOT_FOUND' };
  const team = await getTeamBySlug(db, account.id, args.teamSlug);
  if (!team) return { ok: false, reason: 'NOT_FOUND' };
  const et = await getTeamEventType(db, account.id, team.id, args.slug);
  if (!et) return { ok: false, reason: 'NOT_FOUND' };

  const invalid = validateTeamIntake(et, args.answers);
  if (invalid) return { ok: false, reason: 'INVALID', message: invalid };

  const endMs = args.startMs + et.length_minutes * 60_000;
  const hosts = await getEventHosts(db, et.id);
  const method = normalizeSchedulingMethod(et.scheduling_type);

  // Which hosts are actually free at this instant (busy whether primary or co-host)?
  const candidates: HostCandidate[] = [];
  let sawCalendarFailure = false;
  for (const host of hosts) {
    const conflict = await db.get<{ id: string }>(memberOverlapSql(host.member_id, args.startMs, endMs));
    if (conflict) continue;
    // External-calendar conflict check at CREATE time, fail-closed per host: a
    // busy external calendar disqualifies the host, and so does an UNREADABLE
    // one (never assign a host we couldn't verify). If NO verifiable host
    // remains because of fetch failures, the outcome says so visibly.
    try {
      const externalBusy = await loadExternalBusy(db, calendar, host.member_id, args.startMs, endMs);
      if (externalBusy.some((b) => b.start.getTime() < endMs && b.end.getTime() > args.startMs)) continue;
    } catch {
      sawCalendarFailure = true;
      continue;
    }
    const counts = await db.get<{ n: number; last: number | null }>(
      sql`SELECT COUNT(*) AS n, MAX(b.start_ms) AS last FROM booking b
          WHERE b.status = 'accepted'
            AND (b.host_member_id = ${host.member_id}
                 OR EXISTS (SELECT 1 FROM booking_host bh WHERE bh.booking_id = b.id AND bh.member_id = ${host.member_id}))`,
    );
    candidates.push({
      memberId: host.member_id,
      priority: host.priority,
      weight: host.weight,
      isFixed: host.is_fixed === 1,
      bookingCount: Number(counts?.n ?? 0),
      lastBookedAt: counts?.last ? new Date(Number(counts.last)) : null,
    });
  }

  // Resolve the assigned host set for the method.
  const assigned = resolveAssignment(method, hosts, candidates);
  if (!assigned || assigned.length === 0)
    return { ok: false, reason: sawCalendarFailure ? 'CALENDAR_UNAVAILABLE' : 'SLOT_TAKEN' };

  const organizer = pickOrganizer(method, assigned as [HostCandidate, ...HostCandidate[]]);
  const assignedIds = assigned.map((h) => h.memberId);

  const uid = randomUUID();
  const bookingId = randomUUID();
  const attendeeId = randomUUID();
  const now = Date.now();
  const { token, tokenHash } = generateManageToken();
  const metaExpr = jsonParam(db, { _manage: { tokenHash } });
  const responsesExpr = jsonParam(db, args.answers ?? null);

  // Snapshot the team event type's configured Where onto the booking (F5), same
  // as the personal path — otherwise team bookings show no location.
  const eventLocation = parseJsonColumn<string | null>(et.locations, null);
  const insertBooking = sql`
    INSERT INTO booking (id, account_id, uid, event_type_id, host_member_id, team_id, title, location,
      start_ms, end_ms, status, metadata, responses, attendee_time_zone, created_at, updated_at)
    VALUES (${bookingId}, ${account.id}, ${uid}, ${et.id}, ${organizer.memberId}, ${team.id}, ${et.title}, ${eventLocation},
      ${args.startMs}, ${endMs}, 'accepted', ${metaExpr}, ${responsesExpr}, ${args.attendee.timeZone},
      ${now}, ${now})`;
  const insertAttendee = sql`
    INSERT INTO booking_attendee (id, booking_id, name, email, time_zone, phone, notes, created_at)
    VALUES (${attendeeId}, ${bookingId}, ${args.attendee.name}, ${args.attendee.email},
      ${args.attendee.timeZone}, ${args.attendee.phone ?? null}, ${args.attendee.notes ?? null}, ${now})`;
  // Multi-host bookings (collective / fixed_round_robin) record every assigned
  // host so write-out + notifications fan out. Round-robin's single host is
  // already carried by host_member_id, so it writes no booking_host rows.
  const insertHostRows =
    assignedIds.length > 1
      ? assigned.map(
          (h) =>
            sql`INSERT INTO booking_host (id, booking_id, member_id, is_fixed, created_at)
                VALUES (${randomUUID()}, ${bookingId}, ${h.memberId}, ${h.isFixed ? 1 : 0}, ${now})`,
        )
      : [];

  const booked = await insertBookingGuarded(
    db,
    assignedIds,
    args.startMs,
    endMs,
    [insertBooking, insertAttendee, ...insertHostRows],
  );
  return booked
    ? { ok: true, uid, hostMemberId: organizer.memberId, manageToken: token }
    : { ok: false, reason: 'SLOT_TAKEN' };
}

/**
 * Turn the free candidates into the assigned host set for a method, or null if
 * the slot can't be booked (a required host is busy).
 *   - round_robin       → the one fair host.
 *   - collective        → every event host (all must be free).
 *   - fixed_round_robin  → every fixed host (all must be free) + one rotating pick.
 */
function resolveAssignment(
  method: TeamSchedulingMethod,
  hosts: EventHostRow[],
  free: HostCandidate[],
): HostCandidate[] | null {
  const freeIds = new Set(free.map((c) => c.memberId));
  if (method === 'collective') {
    // Everyone attends — the booking is valid only if every host is free.
    return hosts.every((h) => freeIds.has(h.member_id)) && free.length > 0 ? free : null;
  }
  if (method === 'fixed_round_robin') {
    const requiredFixed = hosts.filter((h) => h.is_fixed === 1).map((h) => h.member_id);
    if (!requiredFixed.every((id) => freeIds.has(id))) return null; // a fixed host is busy
    return selectFixedRoundRobinHosts(free);
  }
  const lucky = selectLuckyHost(free);
  return lucky ? [lucky] : null;
}

function validateTeamIntake(et: TeamEventType, answers?: Record<string, unknown>): string | null {
  const fields = parseJsonColumn<BookingFieldDef[]>(et.booking_fields, []);
  for (const f of fields) {
    if (!f.required) continue;
    const v = answers?.[f.name];
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0) || v === false)
      return `Missing required field: ${f.label}`;
  }
  return null;
}

/**
 * Shared dual-enforced insert (SQLite sync txn / Postgres async txn + EXCLUDE).
 * Re-checks overlap for EVERY assigned host inside the transaction so a
 * collective/fixed-RR booking can't slip past a co-host who got booked
 * concurrently, then runs the ordered statement list (booking, attendee, and any
 * booking_host rows).
 */
async function insertBookingGuarded(
  db: Db,
  hostMemberIds: string[],
  startMs: number,
  endMs: number,
  statements: Array<ReturnType<typeof sql>>,
): Promise<boolean> {
  const overlapChecks = hostMemberIds.map((id) => memberOverlapSql(id, startMs, endMs));
  if (db.dialect === 'sqlite') {
    return db.sqlite!.txn<boolean>(() => {
      for (const check of overlapChecks) if (db.sqlite!.drizzle.get(check)) return false;
      for (const stmt of statements) db.sqlite!.drizzle.run(stmt);
      return true;
    });
  }
  const pg = db.pg!.drizzle;
  try {
    return await pg.transaction(async (tx) => {
      for (const check of overlapChecks) {
        const rows = (await tx.execute(check)) as unknown as unknown[];
        if (rows.length > 0) return false;
      }
      for (const stmt of statements) await tx.execute(stmt);
      return true;
    });
  } catch {
    return false;
  }
}

// --- Reschedule / cancel --------------------------------------------------

interface BookingRow {
  id: string;
  account_id: string;
  uid: string;
  event_type_id: string | null;
  host_member_id: string | null;
  title: string;
  start_ms: number;
  end_ms: number;
  status: string;
  metadata: unknown;
}

/**
 * Resolve a booking by uid. When `accountId` is provided (every host/admin
 * path), the lookup is tenant-scoped: a booking in another account resolves to
 * `undefined` (→ NOT_FOUND), never leaking its existence or letting it be
 * mutated. The public manage path (uid + manage token) passes no accountId.
 */
export async function resolveBooking(
  db: Db,
  uid: string,
  accountId?: string,
): Promise<BookingRow | undefined> {
  const scope = accountId != null ? sql` AND account_id = ${accountId}` : sql``;
  return db.get<BookingRow>(
    sql`SELECT id, account_id, uid, event_type_id, host_member_id, title, start_ms, end_ms, status, metadata
        FROM booking WHERE uid = ${uid}${scope} LIMIT 1`,
  );
}

function manageHashOf(metadata: unknown): string | null {
  const meta = parseJsonColumn<{ _manage?: { tokenHash?: string } }>(metadata, {});
  return meta._manage?.tokenHash ?? null;
}

export type MutationOutcome =
  | {
      ok: true;
      uid: string;
      startUtc: string;
      endUtc: string;
      manageToken?: string;
      /** The instant the booking was at BEFORE a reschedule (for the email). */
      previousStartUtc?: string;
      /**
       * True when this call was an idempotent no-op (already-cancelled, or a
       * reschedule retried with the same Idempotency-Key) — the state was NOT
       * changed, so the caller must skip side-effects (no duplicate email/webhook).
       */
      alreadyApplied?: boolean;
    }
  | {
      ok: false;
      reason: 'NOT_FOUND' | 'FORBIDDEN' | 'SLOT_TAKEN' | 'GONE' | 'INVALID_SLOT' | 'CALENDAR_UNAVAILABLE';
    };

export async function rescheduleBooking(
  db: Db,
  args: {
    uid: string;
    newStartMs: number;
    manageToken?: string;
    byHost?: boolean;
    accountId?: string;
    now?: Date;
    idempotencyKey?: string;
  },
  /** Wired CalendarProvider — the reschedule target is conflict-checked against
   *  the host's external calendars, fail-closed (same policy as createBooking). */
  calendar?: CalendarProvider,
): Promise<MutationOutcome> {
  const b = await resolveBooking(db, args.uid, args.accountId);
  if (!b) return { ok: false, reason: 'NOT_FOUND' };
  if (b.status !== 'accepted') return { ok: false, reason: 'GONE' };
  if (!args.byHost && !verifyManageToken(args.manageToken ?? '', manageHashOf(b.metadata)))
    return { ok: false, reason: 'FORBIDDEN' };

  // P1-2: honor the Idempotency-Key. A retry with the same key returns the
  // already-applied state WITHOUT moving again or re-rotating the manage token
  // (a double-move would silently invalidate the token the first response
  // handed back). Keyed on the booking's stored `_idem.reschedule`.
  const meta = parseJsonColumn<{ _manage?: unknown; _idem?: { reschedule?: string } }>(b.metadata, {});
  if (args.idempotencyKey && meta._idem?.reschedule === args.idempotencyKey) {
    return {
      ok: true,
      uid: b.uid,
      startUtc: new Date(Number(b.start_ms)).toISOString(),
      endUtc: new Date(Number(b.end_ms)).toISOString(),
      alreadyApplied: true,
    };
  }

  // B6: the new time must be a REAL bookable slot — enforce the host's schedule
  // rules, min-notice, buffers, and not-in-the-past (the old path only checked
  // booking-overlap, so a manage-link holder could move a meeting to any
  // instant). Skipped only when the booking has no host/event to validate against.
  if (b.host_member_id && b.event_type_id) {
    const bookable = await isSlotBookable(db, {
      eventTypeId: b.event_type_id,
      hostMemberId: b.host_member_id,
      startMs: args.newStartMs,
      excludeBookingId: b.id,
      now: args.now,
    });
    if (!bookable) return { ok: false, reason: 'INVALID_SLOT' };
  }

  const duration = Number(b.end_ms) - Number(b.start_ms);
  const newEndMs = args.newStartMs + duration;

  // External-calendar conflict check at RESCHEDULE time — the exact policy the
  // create path enforces (error-visibility §5): a conflict on the connected
  // calendar rejects the move, and an UNREADABLE calendar blocks it visibly
  // instead of moving the meeting onto a conflict we couldn't see (fail-closed).
  // This path previously skipped the check entirely, so a reschedule could
  // double-book the host over an external event.
  if (b.host_member_id) {
    try {
      const externalBusy = await loadExternalBusy(
        db,
        calendar,
        b.host_member_id,
        args.newStartMs,
        newEndMs,
      );
      if (externalBusy.some((x) => x.start.getTime() < newEndMs && x.end.getTime() > args.newStartMs)) {
        return { ok: false, reason: 'SLOT_TAKEN' };
      }
    } catch {
      return { ok: false, reason: 'CALENDAR_UNAVAILABLE' };
    }
  }
  const previousStartUtc = new Date(Number(b.start_ms)).toISOString();
  const now = Date.now();
  const { token, tokenHash } = generateManageToken();
  // Preserve any other metadata; rotate the manage token and record the
  // idempotency key so an identical retry short-circuits above.
  const newMeta: Record<string, unknown> = { ...meta, _manage: { tokenHash } };
  if (args.idempotencyKey)
    newMeta._idem = { ...(meta._idem ?? {}), reschedule: args.idempotencyKey };
  const metaExpr = jsonParam(db, newMeta);

  const overlapSql = sql`SELECT id FROM booking WHERE host_member_id = ${b.host_member_id}
    AND status = 'accepted' AND id <> ${b.id}
    AND start_ms < ${newEndMs} AND end_ms > ${args.newStartMs} LIMIT 1`;
  // Restore the reschedule audit trail: since this is an in-place move (uid
  // stable, no mint-new row), record where it came FROM (the previous start) in
  // `from_reschedule` — the old system's back-pointer analog. `rescheduled=1`
  // flags that it moved at all.
  const updateSql = sql`UPDATE booking SET start_ms = ${args.newStartMs}, end_ms = ${newEndMs},
    rescheduled = 1, from_reschedule = ${previousStartUtc}, metadata = ${metaExpr},
    updated_at = ${now} WHERE id = ${b.id}`;

  const moved = await runGuardedUpdate(db, overlapSql, updateSql);
  if (!moved) return { ok: false, reason: 'SLOT_TAKEN' };
  return {
    ok: true,
    uid: b.uid,
    startUtc: new Date(args.newStartMs).toISOString(),
    endUtc: new Date(newEndMs).toISOString(),
    manageToken: token,
    previousStartUtc,
  };
}

async function runGuardedUpdate(
  db: Db,
  overlapSql: ReturnType<typeof sql>,
  updateSql: ReturnType<typeof sql>,
): Promise<boolean> {
  if (db.dialect === 'sqlite') {
    return db.sqlite!.txn<boolean>(() => {
      if (db.sqlite!.drizzle.get(overlapSql)) return false;
      db.sqlite!.drizzle.run(updateSql);
      return true;
    });
  }
  const pg = db.pg!.drizzle;
  try {
    return await pg.transaction(async (tx) => {
      const rows = (await tx.execute(overlapSql)) as unknown as unknown[];
      if (rows.length > 0) return false;
      await tx.execute(updateSql);
      return true;
    });
  } catch {
    return false;
  }
}

export async function cancelBooking(
  db: Db,
  args: {
    uid: string;
    reason?: string;
    manageToken?: string;
    byHost?: boolean;
    accountId?: string;
    /** Retries with the same key (or any retry of an already-cancelled booking) are idempotent. */
    idempotencyKey?: string;
  },
): Promise<MutationOutcome> {
  const b = await resolveBooking(db, args.uid, args.accountId);
  if (!b) return { ok: false, reason: 'NOT_FOUND' };
  // Verify the caller BEFORE revealing status (no existence/timing leak on a
  // bad token), so an idempotent retry still requires a valid principal.
  if (!args.byHost && !verifyManageToken(args.manageToken ?? '', manageHashOf(b.metadata)))
    return { ok: false, reason: 'FORBIDDEN' };
  const nowIso = { startUtc: new Date(Number(b.start_ms)).toISOString(), endUtc: new Date(Number(b.end_ms)).toISOString() };
  // P1-1: cancel is IDEMPOTENT. A retried cancel of an already-cancelled booking
  // returns success (was 410 GONE, which broke agent retry loops that treat
  // non-2xx as failure). Only a truly non-cancellable state (pending/rejected)
  // is GONE.
  if (b.status === 'cancelled') return { ok: true, uid: b.uid, ...nowIso, alreadyApplied: true };
  if (b.status !== 'accepted') return { ok: false, reason: 'GONE' };
  const now = Date.now();
  await db.run(
    sql`UPDATE booking SET status = 'cancelled', cancellation_reason = ${args.reason ?? null},
        cancelled_by = ${args.byHost ? 'host' : 'attendee'}, updated_at = ${now} WHERE id = ${b.id}`,
  );
  return { ok: true, uid: b.uid, ...nowIso };
}

/**
 * Add an attendee to an existing booking (agent/group use). Account-scoped: a
 * uid outside the account resolves to not-found (anti-uid-probing upstream).
 */
export async function addAttendeeToBooking(
  db: Db,
  uid: string,
  accountId: string,
  attendee: { name: string; email: string; timeZone: string; notes?: string; phone?: string },
): Promise<{ ok: boolean; reason?: 'NOT_FOUND' }> {
  const b = await resolveBooking(db, uid, accountId);
  if (!b) return { ok: false, reason: 'NOT_FOUND' };
  await db.run(
    sql`INSERT INTO booking_attendee (id, booking_id, name, email, time_zone, phone, notes, created_at)
        VALUES (${randomUUID()}, ${b.id}, ${attendee.name}, ${attendee.email}, ${attendee.timeZone},
          ${attendee.phone ?? null}, ${attendee.notes ?? null}, ${Date.now()})`,
  );
  return { ok: true };
}

/** Host confirms a pending booking → accepted (guarded by overlap + EXCLUDE). */
export async function confirmBooking(
  db: Db,
  uid: string,
  accountId?: string,
): Promise<MutationOutcome> {
  const b = await resolveBooking(db, uid, accountId);
  if (!b) return { ok: false, reason: 'NOT_FOUND' };
  if (b.status !== 'pending') return { ok: false, reason: 'GONE' };
  const now = Date.now();
  const overlapSql = sql`SELECT id FROM booking WHERE host_member_id = ${b.host_member_id}
    AND status = 'accepted' AND id <> ${b.id}
    AND start_ms < ${b.end_ms} AND end_ms > ${b.start_ms} LIMIT 1`;
  // DH1: guard the transition on the CURRENT status so a concurrent/retried
  // confirm can only move pending→accepted once (defence-in-depth alongside the
  // idempotent calendar write claim).
  const updateSql = sql`UPDATE booking SET status = 'accepted', updated_at = ${now}
    WHERE id = ${b.id} AND status = 'pending'`;
  const ok = await runGuardedUpdate(db, overlapSql, updateSql);
  if (!ok) return { ok: false, reason: 'SLOT_TAKEN' };
  return {
    ok: true,
    uid: b.uid,
    startUtc: new Date(Number(b.start_ms)).toISOString(),
    endUtc: new Date(Number(b.end_ms)).toISOString(),
  };
}

/** Host declines a pending booking → rejected (releases the held slot). */
export async function declineBooking(
  db: Db,
  uid: string,
  reason?: string,
  accountId?: string,
): Promise<MutationOutcome> {
  const b = await resolveBooking(db, uid, accountId);
  if (!b) return { ok: false, reason: 'NOT_FOUND' };
  if (b.status !== 'pending') return { ok: false, reason: 'GONE' };
  await db.run(
    sql`UPDATE booking SET status = 'rejected', cancellation_reason = ${reason ?? null},
        updated_at = ${Date.now()} WHERE id = ${b.id}`,
  );
  return {
    ok: true,
    uid: b.uid,
    startUtc: new Date(Number(b.start_ms)).toISOString(),
    endUtc: new Date(Number(b.end_ms)).toISOString(),
  };
}

// --- Notification context -------------------------------------------------

/** Everything the email templates need for a booking, loaded once by uid. */
export interface BookingNotificationContext {
  accountId: string;
  uid: string;
  title: string;
  startUtc: string;
  endUtc: string;
  status: string;
  location: string | null;
  host: { name: string | null; email: string | null };
  attendee: { name: string; email: string; timeZone: string };
  /** Extra assigned hosts (collective / fixed_round_robin) beyond the organizer. */
  coHosts: Array<{ name: string | null; email: string | null }>;
  /** Host member's UI locale — picks the default-template language (EN/ES). */
  hostLocale: string | null;
  /** Public book-again path parts ({{booking_link}}) — null when unresolvable. */
  bookAgain: { accountCode: string; handle: string; slug: string } | null;
}

/**
 * Load the attendee + host + timing a booking email needs (B1-B4). Returns null
 * if the booking or its attendee is gone. Host email is included so the .ics
 * carries an ORGANIZER and the host can be a recipient (parity with old). On
 * multi-host team bookings, every assigned co-host is loaded too so all hosts
 * are notified.
 */
export async function loadBookingNotificationContext(
  db: Db,
  uid: string,
): Promise<BookingNotificationContext | null> {
  const row = await db.get<{
    id: string;
    account_id: string;
    uid: string;
    title: string;
    start_ms: number;
    end_ms: number;
    status: string;
    location: string | null;
    host_member_id: string | null;
    host_name: string | null;
    host_email: string | null;
    att_name: string | null;
    att_email: string | null;
    att_tz: string | null;
    host_locale: string | null;
    host_handle: string | null;
    account_code: string | null;
    event_slug: string | null;
  }>(
    sql`SELECT b.id, b.account_id, b.uid, b.title, b.start_ms, b.end_ms, b.status, b.location,
               b.host_member_id, m.display_name AS host_name, m.email AS host_email,
               m.locale AS host_locale, m.handle AS host_handle,
               COALESCE(acc.vanity_slug, acc.code) AS account_code, et.slug AS event_slug,
               a.name AS att_name, a.email AS att_email, a.time_zone AS att_tz
        FROM booking b
        LEFT JOIN member m ON m.id = b.host_member_id
        LEFT JOIN account acc ON acc.id = b.account_id
        LEFT JOIN event_type et ON et.id = b.event_type_id
        LEFT JOIN booking_attendee a ON a.booking_id = b.id
        WHERE b.uid = ${uid} LIMIT 1`,
  );
  if (!row || !row.att_email) return null;
  // Multi-host bookings: every assigned co-host (excluding the organizer) is
  // notified too. Round-robin bookings have no booking_host rows → empty.
  const coHostRows = await db.all<{ member_id: string; name: string | null; email: string | null }>(
    sql`SELECT bh.member_id, m.display_name AS name, m.email AS email
        FROM booking_host bh LEFT JOIN member m ON m.id = bh.member_id
        WHERE bh.booking_id = ${row.id} AND bh.member_id <> ${row.host_member_id ?? ''}`,
  );
  return {
    accountId: row.account_id,
    uid: row.uid,
    title: row.title,
    startUtc: new Date(Number(row.start_ms)).toISOString(),
    endUtc: new Date(Number(row.end_ms)).toISOString(),
    status: row.status,
    location: row.location,
    host: { name: row.host_name, email: row.host_email },
    attendee: {
      name: row.att_name ?? '',
      email: row.att_email,
      timeZone: row.att_tz ?? 'UTC',
    },
    coHosts: coHostRows.map((h) => ({ name: h.name, email: h.email })),
    hostLocale: row.host_locale,
    bookAgain:
      row.account_code && row.host_handle && row.event_slug
        ? { accountCode: row.account_code, handle: row.host_handle, slug: row.event_slug }
        : null,
  };
}

// --- Host bookings list ---------------------------------------------------

export interface BookingListItem {
  uid: string;
  status: string;
  title: string;
  startUtc: string;
  endUtc: string;
  hostMemberId: string | null;
}

export async function listBookings(
  db: Db,
  args: {
    accountId: string;
    memberId?: string;
    from?: number;
    to?: number;
    status?: string;
    limit?: number;
    /**
     * Machine resource allowlist: when non-null, restrict to these event types
     * (an event-type-scoped API key must not read the whole account). An empty
     * array allows nothing; null/undefined means no event-type restriction.
     */
    eventTypeIds?: string[] | null;
    /** Opaque keyset cursor from a prior page's `nextCursor` (P1-3). */
    cursor?: string;
  },
): Promise<{ items: BookingListItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const conds = [sql`account_id = ${args.accountId}`];
  if (args.memberId) conds.push(sql`host_member_id = ${args.memberId}`);
  if (args.from != null) conds.push(sql`start_ms >= ${args.from}`);
  if (args.to != null) conds.push(sql`start_ms < ${args.to}`);
  if (args.status) conds.push(sql`status = ${args.status}`);
  if (args.eventTypeIds != null) {
    if (args.eventTypeIds.length === 0) {
      conds.push(sql`1 = 0`); // scoped key with an empty allowlist → nothing
    } else {
      const idExprs = args.eventTypeIds.map((id) => sql`${id}`);
      const inList = idExprs.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`));
      conds.push(sql`event_type_id IN (${inList})`);
    }
  }
  // Keyset pagination on the stable sort key (start_ms DESC, then uid DESC to
  // break ties deterministically). The cursor encodes the last row of the prior
  // page, so paging never skips or repeats rows even as new bookings arrive.
  const cursor = decodeBookingCursor(args.cursor);
  if (cursor) {
    conds.push(
      sql`(start_ms < ${cursor.startMs} OR (start_ms = ${cursor.startMs} AND uid < ${cursor.uid}))`,
    );
  }
  const where = conds.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc} AND ${cur}`));
  // Fetch one extra row to know whether a further page exists.
  const rows = await db.all<{
    uid: string;
    status: string;
    title: string;
    start_ms: number;
    end_ms: number;
    host_member_id: string | null;
  }>(
    sql`SELECT uid, status, title, start_ms, end_ms, host_member_id FROM booking
        WHERE ${where} ORDER BY start_ms DESC, uid DESC LIMIT ${limit + 1}`,
  );
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      uid: r.uid,
      status: r.status,
      title: r.title,
      startUtc: new Date(Number(r.start_ms)).toISOString(),
      endUtc: new Date(Number(r.end_ms)).toISOString(),
      hostMemberId: r.host_member_id,
    })),
    nextCursor: hasMore && last ? encodeBookingCursor(Number(last.start_ms), last.uid) : null,
  };
}

/** Opaque, URL-safe cursor = base64url("<startMs>:<uid>"). */
function encodeBookingCursor(startMs: number, uid: string): string {
  return Buffer.from(`${startMs}:${uid}`, 'utf8').toString('base64url');
}

function decodeBookingCursor(cursor?: string): { startMs: number; uid: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = raw.indexOf(':');
    if (idx <= 0) return null;
    const startMs = Number(raw.slice(0, idx));
    const uid = raw.slice(idx + 1);
    if (!Number.isFinite(startMs) || !uid) return null;
    return { startMs, uid };
  } catch {
    return null;
  }
}

// --- Connections (behind the CalendarProvider port — generic, no vendor) --

export interface ConnectionView {
  id: string;
  provider: string;
  externalId: string;
  primaryEmail: string | null;
  isDestination: boolean;
  checkConflicts: boolean;
  /** Persisted health from the last probe; null lastCheckAt = never checked. */
  lastCheckAt: number | null;
  lastCheckOk: boolean | null;
  lastCheckDetail: string | null;
}

export async function listConnections(db: Db, memberId: string): Promise<ConnectionView[]> {
  const rows = await db.all<{
    id: string;
    provider: string;
    external_id: string;
    primary_email: string | null;
    is_destination: number;
    check_conflicts: number;
    last_check_at: number | null;
    last_check_ok: number | null;
    last_check_detail: string | null;
  }>(
    sql`SELECT id, provider, external_id, primary_email, is_destination, check_conflicts,
               last_check_at, last_check_ok, last_check_detail
        FROM connected_calendar WHERE member_id = ${memberId}`,
  );
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    externalId: r.external_id,
    primaryEmail: r.primary_email,
    isDestination: !!r.is_destination,
    checkConflicts: !!r.check_conflicts,
    lastCheckAt: r.last_check_at == null ? null : Number(r.last_check_at),
    lastCheckOk: r.last_check_ok == null ? null : !!r.last_check_ok,
    lastCheckDetail: r.last_check_detail,
  }));
}

/** Persist the outcome of a health probe so the UI can show it with last-checked info. */
export async function recordConnectionHealth(
  db: Db,
  memberId: string,
  id: string,
  health: { ok: boolean; detail?: string | null },
): Promise<void> {
  await db.run(
    sql`UPDATE connected_calendar
        SET last_check_at = ${Date.now()}, last_check_ok = ${health.ok ? 1 : 0},
            last_check_detail = ${health.detail ?? null}
        WHERE id = ${id} AND member_id = ${memberId}`,
  );
}

export async function createConnection(
  db: Db,
  args: {
    accountId: string;
    memberId: string;
    provider: string;
    externalId: string;
    primaryEmail?: string;
    isDestination?: boolean;
    checkConflicts?: boolean;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO connected_calendar (id, account_id, member_id, provider, external_id,
          primary_email, is_destination, check_conflicts, created_at)
        VALUES (${id}, ${args.accountId}, ${args.memberId}, ${args.provider}, ${args.externalId},
          ${args.primaryEmail ?? null}, ${args.isDestination ? 1 : 0},
          ${args.checkConflicts === false ? 0 : 1}, ${Date.now()})`,
  );
  return { id };
}

export async function deleteConnection(
  db: Db,
  memberId: string,
  id: string,
): Promise<{ ok: boolean; reason?: 'LAST_DESTINATION_REQUIRED' }> {
  const conn = await db.get<{ is_destination: number }>(
    sql`SELECT is_destination FROM connected_calendar WHERE id = ${id} AND member_id = ${memberId} LIMIT 1`,
  );
  if (!conn) return { ok: true }; // already gone — idempotent
  // R20 guard: don't strand bookings with nowhere to write — a host that has a
  // destination calendar must keep at least one. Unset `isDestination` first.
  if (conn.is_destination) {
    const others = await db.get<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM connected_calendar
          WHERE member_id = ${memberId} AND is_destination = 1 AND id <> ${id}`,
    );
    if (Number(others?.n ?? 0) === 0) return { ok: false, reason: 'LAST_DESTINATION_REQUIRED' };
  }
  await db.run(sql`DELETE FROM connected_calendar WHERE id = ${id} AND member_id = ${memberId}`);
  return { ok: true };
}

/**
 * Toggle a connection's destination / conflict-check flags. Destination is
 * EXCLUSIVE per member (R20): setting one as destination clears the others.
 * This is connection-record management only — it does not call the external
 * calendar provider.
 */
export async function updateConnection(
  db: Db,
  memberId: string,
  id: string,
  patch: { isDestination?: boolean; checkConflicts?: boolean },
): Promise<void> {
  if (patch.isDestination === true) {
    await db.run(sql`UPDATE connected_calendar SET is_destination = 0 WHERE member_id = ${memberId}`);
  }
  const sets: ReturnType<typeof sql>[] = [];
  if (patch.isDestination !== undefined) sets.push(sql`is_destination = ${patch.isDestination ? 1 : 0}`);
  if (patch.checkConflicts !== undefined) sets.push(sql`check_conflicts = ${patch.checkConflicts ? 1 : 0}`);
  if (sets.length === 0) return;
  const assign = sets.reduce((a, c, i) => (i === 0 ? c : sql`${a}, ${c}`));
  await db.run(sql`UPDATE connected_calendar SET ${assign} WHERE id = ${id} AND member_id = ${memberId}`);
}

/** The opaque provider ref (external_id) + provider for one connection, or null. */
export async function getConnectionRef(
  db: Db,
  memberId: string,
  id: string,
): Promise<{ externalId: string; provider: string } | null> {
  const row = await db.get<{ external_id: string; provider: string }>(
    sql`SELECT external_id, provider FROM connected_calendar
        WHERE id = ${id} AND member_id = ${memberId} LIMIT 1`,
  );
  return row ? { externalId: row.external_id, provider: row.provider } : null;
}

/** True when this member already has a connection for the given opaque ref. */
export async function connectionExists(db: Db, memberId: string, externalId: string): Promise<boolean> {
  const row = await db.get<{ id: string }>(
    sql`SELECT id FROM connected_calendar
        WHERE member_id = ${memberId} AND external_id = ${externalId} LIMIT 1`,
  );
  return !!row;
}

// --- API keys -------------------------------------------------------------

export interface CreatedApiKey {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  plaintext: string;
  scopes: string[];
}

export async function createApiKey(
  db: Db,
  args: { accountId: string; name: string; scopes: string[]; eventTypeIds?: string[]; expiresAtMs?: number },
): Promise<CreatedApiKey> {
  const id = randomUUID();
  const secret = randomBytes(24).toString('base64url');
  const prefix = `dcl_${randomBytes(4).toString('hex')}`;
  const plaintext = `${prefix}_${secret}`;
  const keyHash = createHash('sha256').update(plaintext).digest('hex');
  const last4 = plaintext.slice(-4);
  await db.run(
    sql`INSERT INTO api_key (id, account_id, name, prefix, last4, key_hash, scopes, event_type_ids,
          expires_at_ms, created_at)
        VALUES (${id}, ${args.accountId}, ${args.name}, ${prefix}, ${last4}, ${keyHash},
          ${jsonParam(db, args.scopes)}, ${jsonParam(db, args.eventTypeIds ?? null)},
          ${args.expiresAtMs ?? null}, ${Date.now()})`,
  );
  return { id, name: args.name, prefix, last4, plaintext, scopes: args.scopes };
}

export interface ApiKeyPrincipal {
  accountId: string;
  scopes: string[];
  eventTypeIds: string[] | null;
}

/** Verify a presented plaintext key: hash → lookup → not revoked/expired. */
export async function verifyApiKey(db: Db, plaintext: string): Promise<ApiKeyPrincipal | null> {
  if (!plaintext) return null;
  const keyHash = createHash('sha256').update(plaintext).digest('hex');
  const row = await db.get<{
    id: string;
    account_id: string;
    scopes: unknown;
    event_type_ids: unknown;
    revoked_at_ms: number | null;
    expires_at_ms: number | null;
  }>(
    sql`SELECT id, account_id, scopes, event_type_ids, revoked_at_ms, expires_at_ms
        FROM api_key WHERE key_hash = ${keyHash} LIMIT 1`,
  );
  if (!row) return null;
  const now = Date.now();
  if (row.revoked_at_ms != null) return null;
  if (row.expires_at_ms != null && Number(row.expires_at_ms) <= now) return null;
  await db.run(sql`UPDATE api_key SET last_used_at_ms = ${now} WHERE id = ${row.id}`);
  return {
    accountId: row.account_id,
    scopes: parseJsonColumn<string[]>(row.scopes, []),
    eventTypeIds: parseJsonColumn<string[] | null>(row.event_type_ids, null),
  };
}

export async function listApiKeys(db: Db, accountId: string) {
  return db.all<{ id: string; name: string; prefix: string; last4: string; revoked_at_ms: number | null }>(
    sql`SELECT id, name, prefix, last4, revoked_at_ms FROM api_key WHERE account_id = ${accountId}
        ORDER BY created_at DESC`,
  );
}

export async function revokeApiKey(db: Db, accountId: string, id: string): Promise<void> {
  await db.run(
    sql`UPDATE api_key SET revoked_at_ms = ${Date.now()} WHERE id = ${id} AND account_id = ${accountId}`,
  );
}

// --- Webhooks -------------------------------------------------------------

export async function listWebhooks(db: Db, accountId: string) {
  return db.all<{
    id: string;
    subscriber_url: string;
    event_triggers: unknown;
    active: number;
  }>(
    sql`SELECT id, subscriber_url, event_triggers, active FROM webhook WHERE account_id = ${accountId}`,
  );
}

export async function createWebhook(
  db: Db,
  args: {
    accountId: string;
    subscriberUrl: string;
    eventTriggers: string[];
    secret?: string;
    memberId?: string;
    teamId?: string;
    eventTypeId?: string;
  },
): Promise<{ id: string; secret: string }> {
  const id = randomUUID();
  // Always store a signing secret so payloads are never unsigned. If the caller
  // didn't supply one we mint it and return it once (subscribers verify the
  // X-Slate-Signature HMAC with it — see dispatchWebhooks).
  const secret = args.secret ?? `whsec_${randomBytes(24).toString('base64url')}`;
  await db.run(
    sql`INSERT INTO webhook (id, account_id, member_id, team_id, event_type_id, subscriber_url,
          secret, event_triggers, active, created_at)
        VALUES (${id}, ${args.accountId}, ${args.memberId ?? null}, ${args.teamId ?? null},
          ${args.eventTypeId ?? null}, ${args.subscriberUrl}, ${secret},
          ${jsonParam(db, args.eventTriggers)}, 1, ${Date.now()})`,
  );
  return { id, secret };
}

export async function deleteWebhook(db: Db, accountId: string, id: string): Promise<void> {
  await db.run(sql`DELETE FROM webhook WHERE id = ${id} AND account_id = ${accountId}`);
}

/** Enable/disable a webhook (D17). Account-scoped. */
export async function updateWebhook(
  db: Db,
  accountId: string,
  id: string,
  patch: { active?: boolean },
): Promise<void> {
  if (patch.active === undefined) return;
  await db.run(
    sql`UPDATE webhook SET active = ${patch.active ? 1 : 0} WHERE id = ${id} AND account_id = ${accountId}`,
  );
}

/**
 * Send a signed test `ping` event to a webhook (D17). Re-validates the URL at
 * egress (SSRF guard) and signs like a real dispatch. Returns the delivery
 * result — never throws.
 */
export async function pingWebhook(
  db: Db,
  accountId: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status?: number; message?: string }> {
  const h = await db.get<{ subscriber_url: string; secret: string | null }>(
    sql`SELECT subscriber_url, secret FROM webhook WHERE id = ${id} AND account_id = ${accountId} LIMIT 1`,
  );
  if (!h) return { ok: false, message: 'Webhook not found.' };
  if (!(await checkWebhookUrl(h.subscriber_url)).ok) return { ok: false, message: 'URL is not allowed.' };
  const body = JSON.stringify({ event: 'ping', data: { ok: true } });
  const headers: Record<string, string> = { 'content-type': 'application/json', 'X-Slate-Event': 'ping' };
  if (h.secret) headers['X-Slate-Signature'] = `sha256=${createHmac('sha256', h.secret).update(body).digest('hex')}`;
  try {
    const res = await fetchImpl(h.subscriber_url, { method: 'POST', headers, body });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, message: 'Subscriber unreachable.' };
  }
}

/**
 * Fire matching webhooks for a lifecycle event (best-effort, fire-and-forget).
 * Each dispatch signs the JSON body with HMAC-SHA256 over the webhook's secret
 * and sends it as `X-Slate-Signature: sha256=<hex>` (D17). One dispatch per
 * subscription per event. Never throws — a failed webhook must not affect the
 * booking. `fetchImpl` is injectable for tests.
 */
export async function dispatchWebhooks(
  db: Db,
  accountId: string,
  event: string,
  payload: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const hooks = await db.all<{
    id: string;
    subscriber_url: string;
    secret: string | null;
    event_triggers: unknown;
    active: number;
  }>(
    sql`SELECT id, subscriber_url, secret, event_triggers, active FROM webhook
        WHERE account_id = ${accountId} AND active = 1`,
  );
  const body = JSON.stringify({ event, data: payload });
  let sent = 0;
  await Promise.all(
    hooks.map(async (h) => {
      const triggers = parseJsonColumn<string[]>(h.event_triggers, []);
      if (!triggers.includes(event)) return;
      // Re-validate at egress (defends against a URL that resolved public at
      // creation but was later re-pointed at a private address — DNS rebinding).
      if (!(await checkWebhookUrl(h.subscriber_url)).ok) return;
      const headers: Record<string, string> = { 'content-type': 'application/json', 'X-Slate-Event': event };
      if (h.secret) {
        headers['X-Slate-Signature'] = `sha256=${createHmac('sha256', h.secret).update(body).digest('hex')}`;
      }
      try {
        await fetchImpl(h.subscriber_url, { method: 'POST', headers, body });
        sent++;
      } catch {
        /* best-effort — swallow */
      }
    }),
  );
  return sent;
}

// --- Durable webhook delivery via the outbox (B7 / audit DM1) --------------
//
// `dispatchWebhooks` above is the legacy best-effort fan-out (kept for tests and
// any direct caller). The lifecycle now goes through the OUTBOX instead: one
// durable row PER SUBSCRIBER, drained by the worker with retry+backoff. That
// gives per-subscriber isolation (a slow/broken subscriber can't starve the
// others), per-subscriber retry, and a delivery log.

export interface MatchingWebhook {
  id: string;
  subscriberUrl: string;
  secret: string | null;
}

/** Active webhooks in the account whose triggers include `event`. */
export async function loadMatchingWebhooks(
  db: Db,
  accountId: string,
  event: string,
): Promise<MatchingWebhook[]> {
  const hooks = await db.all<{
    id: string;
    subscriber_url: string;
    secret: string | null;
    event_triggers: unknown;
  }>(
    sql`SELECT id, subscriber_url, secret, event_triggers FROM webhook
        WHERE account_id = ${accountId} AND active = 1`,
  );
  return hooks
    .filter((h) => parseJsonColumn<string[]>(h.event_triggers, []).includes(event))
    .map((h) => ({ id: h.id, subscriberUrl: h.subscriber_url, secret: h.secret }));
}

/**
 * Enqueue one outbox row per matching subscriber. Returns how many were queued.
 * On a bare clone-and-run (no webhooks configured) this enqueues nothing, so the
 * outbox stays empty and behavior is unchanged.
 */
export async function enqueueWebhookDeliveries(
  db: Db,
  accountId: string,
  event: string,
  payload: unknown,
  now = Date.now(),
): Promise<number> {
  const hooks = await loadMatchingWebhooks(db, accountId, event);
  const body = JSON.stringify({ event, data: payload });
  for (const h of hooks) {
    await enqueueOutbox(db, {
      kind: 'webhook',
      action: event,
      accountId,
      webhookId: h.id,
      payload: body,
      now,
    });
  }
  return hooks.length;
}

/**
 * Deliver ONE webhook (the worker's per-row executor). Loads the subscriber by
 * id (so a delete/rotate between enqueue and delivery is honored), re-validates
 * the URL at egress (DNS-rebinding defense), signs with the CURRENT secret, and
 * POSTs. THROWS on any failure (missing hook, blocked URL, network error, or a
 * non-2xx response) so the worker retries; a 2xx resolves the row.
 */
export async function deliverWebhookEvent(
  db: Db,
  args: { webhookId: string; body: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const hook = await db.get<{ subscriber_url: string; secret: string | null; active: number }>(
    sql`SELECT subscriber_url, secret, active FROM webhook WHERE id = ${args.webhookId} LIMIT 1`,
  );
  if (!hook || hook.active !== 1) {
    // Subscriber gone/disabled since enqueue — nothing to deliver, don't retry.
    return;
  }
  if (!(await checkWebhookUrl(hook.subscriber_url)).ok) {
    throw new Error(`webhook URL blocked at egress: ${hook.subscriber_url}`);
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'X-Slate-Event': (JSON.parse(args.body) as { event?: string }).event ?? '',
  };
  if (hook.secret) {
    headers['X-Slate-Signature'] = `sha256=${createHmac('sha256', hook.secret).update(args.body).digest('hex')}`;
  }
  const res = await fetchImpl(hook.subscriber_url, { method: 'POST', headers, body: args.body });
  // A Response-like result must be 2xx; a thrown fetch already propagates.
  if (res && typeof (res as Response).ok === 'boolean' && !(res as Response).ok) {
    throw new Error(`webhook delivery failed: HTTP ${(res as Response).status}`);
  }
}
