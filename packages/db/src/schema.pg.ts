/**
 * Postgres schema — THE SOURCE OF TRUTH. Postgres is what we trust: CI runs the
 * Postgres path first-class and production is managed Postgres. Full power: jsonb for
 * structured columns, the `booking_no_overlap` GiST EXCLUDE constraint (in the
 * migration). schema.sqlite.ts is a portable subset for zero-infra dev and never
 * limits this schema. Column names mirror it 1:1 so the repository is
 * dialect-agnostic; JSON columns are read through parseJsonColumn (object on PG,
 * string on SQLite) and written with a ::jsonb cast on PG.
 *
 * Booleans are INTEGER 0/1 on both engines (uniform reads); instants are BIGINT
 * epoch-ms (the int8range EXCLUDE operates over them).
 */
import { pgTable, text, bigint, integer, jsonb } from 'drizzle-orm/pg-core';

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  // The canonical public code: a 6-char unambiguous short code for new
  // accounts (see @slate/engine short-links); legacy `acct-…`/`dev-…` codes
  // are re-coded by the migrate() data fixup and kept alive in account_alias.
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  // Stable id of this account in an upstream identity service, used by the
  // `workos` auth provider to project the external tenant onto a local account.
  // Nullable + unique (NULLs distinct): seeded/local accounts have none.
  externalId: text('external_id'),
  // Premium vanity slug (globally unique, [a-z0-9-]{3,30}); when set it is the
  // canonical public code and `code` stays as a permanent alias.
  vanitySlug: text('vanity_slug'),
  // Cached IAM verdict ('paid' | 'free'; NULL = never checked) + check time.
  // IAM is the source of truth — this is never a Calendars-side billing state.
  daptaEntitlement: text('dapta_entitlement'),
  entitlementCheckedAt: bigint('entitlement_checked_at', { mode: 'number' }),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

/**
 * Retired public codes (legacy `acct-…`/`dev-…`, re-coded short codes): each
 * alias permanently resolves to its account so no shared link ever breaks —
 * the web layer 308-redirects alias URLs to the canonical code.
 */
export const accountAlias = pgTable('account_alias', {
  alias: text('alias').primaryKey(),
  accountId: text('account_id').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const member = pgTable('member', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  // Stable id of this member's user in an upstream identity service (the JWT
  // `sub`). Unique per account; the `workos` provider resolves/creates the
  // member projection by it. Nullable: seeded/local members have none.
  externalId: text('external_id'),
  handle: text('handle'),
  displayName: text('display_name'),
  email: text('email'),
  // Account-level role (distinct from team_membership.role): `owner` | `admin` |
  // `member`. Every account keeps ≥1 owner (last-owner guard). Default `member`;
  // the first member of an account is promoted to `owner` (seed + migration backfill).
  role: text('role').notNull().default('member'),
  // Lifecycle: `active` | `invited` (invited-by-email, not yet signed in) |
  // `disabled` (revoked access, row kept for history). Default `active`.
  status: text('status').notNull().default('active'),
  avatarUrl: text('avatar_url'),
  coverUrl: text('cover_url'),
  brandColor: text('brand_color'),
  layout: text('layout'),
  bookingPageStyle: jsonb('booking_page_style'),
  timeZone: text('time_zone').notNull().default('UTC'),
  weekStart: text('week_start').notNull().default('sunday'),
  locale: text('locale'),
  timeFormat: integer('time_format').notNull().default(12),
  defaultScheduleId: text('default_schedule_id'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const schedule = pgTable('schedule', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  memberId: text('member_id').notNull(),
  name: text('name').notNull(),
  timeZone: text('time_zone').notNull().default('UTC'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const availability = pgTable('availability', {
  id: text('id').primaryKey(),
  scheduleId: text('schedule_id').notNull(),
  days: text('days'),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  date: text('date'),
});

export const team = pgTable('team', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug'),
  bio: text('bio'),
  logoUrl: text('logo_url'),
  timeZone: text('time_zone').notNull().default('UTC'),
  hideBranding: integer('hide_branding').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const teamMembership = pgTable('team_membership', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  teamId: text('team_id').notNull(),
  memberId: text('member_id').notNull(),
  role: text('role').notNull().default('member'),
  accepted: integer('accepted').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const eventType = pgTable('event_type', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  memberId: text('member_id'),
  teamId: text('team_id'),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  lengthMinutes: integer('length_minutes').notNull(),
  scheduleId: text('schedule_id'),
  hidden: integer('hidden').notNull().default(0),
  schedulingType: text('scheduling_type'),
  locations: jsonb('locations'),
  bookingFields: jsonb('booking_fields'),
  metadata: jsonb('metadata'),
  minimumBookingNotice: integer('minimum_booking_notice').notNull().default(120),
  beforeEventBuffer: integer('before_event_buffer').notNull().default(0),
  afterEventBuffer: integer('after_event_buffer').notNull().default(0),
  slotInterval: integer('slot_interval'),
  requiresConfirmation: integer('requires_confirmation').notNull().default(0),
  seatsPerTimeSlot: integer('seats_per_time_slot'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const eventTypeHost = pgTable('event_type_host', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  eventTypeId: text('event_type_id').notNull(),
  memberId: text('member_id').notNull(),
  isFixed: integer('is_fixed').notNull().default(0),
  priority: integer('priority'),
  weight: integer('weight'),
  scheduleId: text('schedule_id'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const booking = pgTable('booking', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  uid: text('uid').notNull().unique(),
  eventTypeId: text('event_type_id'),
  hostMemberId: text('host_member_id'),
  teamId: text('team_id'),
  title: text('title').notNull(),
  startMs: bigint('start_ms', { mode: 'number' }).notNull(),
  endMs: bigint('end_ms', { mode: 'number' }).notNull(),
  status: text('status').notNull().default('accepted'),
  location: text('location'),
  meetingUrl: text('meeting_url'),
  attendeeTimeZone: text('attendee_time_zone'),
  responses: jsonb('responses'),
  metadata: jsonb('metadata'),
  cancellationReason: text('cancellation_reason'),
  cancelledBy: text('cancelled_by'),
  rescheduled: integer('rescheduled'),
  fromReschedule: text('from_reschedule'),
  recurringEventId: text('recurring_event_id'),
  idempotencyKey: text('idempotency_key').unique(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const bookingAttendee = pgTable('booking_attendee', {
  id: text('id').primaryKey(),
  bookingId: text('booking_id').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  timeZone: text('time_zone'),
  phone: text('phone'),
  notes: text('notes'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

/** Assigned host set for multi-host bookings (collective / fixed_round_robin). */
export const bookingHost = pgTable('booking_host', {
  id: text('id').primaryKey(),
  bookingId: text('booking_id').notNull(),
  memberId: text('member_id').notNull(),
  isFixed: integer('is_fixed').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const slotReservation = pgTable('slot_reservation', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  eventTypeId: text('event_type_id').notNull(),
  memberId: text('member_id').notNull(),
  slotStartMs: bigint('slot_start_ms', { mode: 'number' }).notNull(),
  slotEndMs: bigint('slot_end_ms', { mode: 'number' }).notNull(),
  uid: text('uid').notNull(),
  releaseAtMs: bigint('release_at_ms', { mode: 'number' }).notNull(),
  isSeat: integer('is_seat').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const connectedCalendar = pgTable('connected_calendar', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  memberId: text('member_id').notNull(),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  primaryEmail: text('primary_email'),
  isDestination: integer('is_destination').notNull().default(0),
  checkConflicts: integer('check_conflicts').notNull().default(1),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  /** Persisted health (last explicit probe): NULL last_check_at = never checked. */
  lastCheckAt: bigint('last_check_at', { mode: 'number' }),
  lastCheckOk: integer('last_check_ok'),
  lastCheckDetail: text('last_check_detail'),
});

export const apiKey = pgTable('api_key', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull().unique(),
  last4: text('last4').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  scopes: jsonb('scopes'),
  eventTypeIds: jsonb('event_type_ids'),
  lastUsedAtMs: bigint('last_used_at_ms', { mode: 'number' }),
  expiresAtMs: bigint('expires_at_ms', { mode: 'number' }),
  revokedAtMs: bigint('revoked_at_ms', { mode: 'number' }),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const webhook = pgTable('webhook', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  memberId: text('member_id'),
  teamId: text('team_id'),
  eventTypeId: text('event_type_id'),
  subscriberUrl: text('subscriber_url').notNull(),
  secret: text('secret'),
  eventTriggers: jsonb('event_triggers'),
  active: integer('active').notNull().default(1),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const bookingReference = pgTable('booking_reference', {
  id: text('id').primaryKey(),
  bookingId: text('booking_id').notNull(),
  /** DH1: destination (connection ref) this event was written to; UNIQUE with booking_id. */
  destination: text('destination'),
  type: text('type').notNull(),
  externalEventId: text('external_event_id'),
  externalCalendarId: text('external_calendar_id'),
  meetingUrl: text('meeting_url'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

/** B7/DM1: durable side-effect queue (calendar write-out + webhook delivery). */
export const outbox = pgTable('outbox', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  action: text('action').notNull(),
  bookingUid: text('booking_uid'),
  accountId: text('account_id'),
  webhookId: text('webhook_id'),
  payload: text('payload'),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  nextAttemptAt: bigint('next_attempt_at', { mode: 'number' }).notNull(),
  lastError: text('last_error'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

/**
 * Per-account notification controls (toggles + template overrides). Absent row
 * = shipped default (enabled, stock template); subject/body NULL = stock
 * template; reminder_lead_minutes = TEXT JSON array (reminder key only).
 */
export const notificationSetting = pgTable('notification_setting', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  emailKey: text('email_key').notNull(),
  enabled: integer('enabled').notNull().default(1),
  subject: text('subject'),
  body: text('body'),
  reminderLeadMinutes: text('reminder_lead_minutes'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const pgSchema = {
  account,
  member,
  schedule,
  availability,
  team,
  teamMembership,
  eventType,
  eventTypeHost,
  booking,
  bookingAttendee,
  bookingHost,
  slotReservation,
  connectedCalendar,
  apiKey,
  webhook,
  bookingReference,
  outbox,
  notificationSetting,
};
