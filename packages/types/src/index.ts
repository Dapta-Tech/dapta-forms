/**
 * @slate/types — the typed contract shared by the API and the web app.
 * Zod schemas are the single source of truth: the API re-validates every
 * request against them, and the web forms derive their client-side validation
 * from the same schema (never trust the client; validate on both sides).
 */
import { z } from 'zod';
import { AVAILABILITY_EMPTY_REASONS } from '@slate/engine';

// --- Enums (string unions — portable across SQLite & Postgres) -------------

export const bookingStatus = ['accepted', 'pending', 'cancelled', 'rejected'] as const;
export type BookingStatus = (typeof bookingStatus)[number];

export const schedulingType = ['round_robin', 'collective', 'fixed_round_robin'] as const;
export type SchedulingType = (typeof schedulingType)[number];

export const membershipRole = ['member', 'admin', 'owner'] as const;
export type MembershipRole = (typeof membershipRole)[number];

/**
 * Account-level role (on `member`), distinct from the per-team `membershipRole`
 * even though the value names line up. `owner` administers the whole workspace
 * (+ transfer/delete), `admin` manages members and everyone's resources, `member`
 * is staff scoped to their own resources.
 */
export const accountRole = ['owner', 'admin', 'member'] as const;
export type AccountRole = (typeof accountRole)[number];

/** Member lifecycle within a workspace. */
export const memberStatus = ['active', 'invited', 'disabled'] as const;
export type MemberStatus = (typeof memberStatus)[number];

export const apiScope = ['availability:read', 'bookings:read', 'bookings:write'] as const;
export type ApiScope = (typeof apiScope)[number];

/** Custom intake-field kinds a booking page may ask. */
export const bookingFieldType = [
  'text',
  'textarea',
  'email',
  'phone',
  'number',
  'select',
  'checkbox',
  'guests',
] as const;
export type BookingFieldType = (typeof bookingFieldType)[number];

/** IANA time zone string (light validation; the engine trusts the platform DB). */
export const timeZoneSchema = z.string().min(1).max(64);

/** A per-event custom intake field definition (declared early — referenced widely). */
export const bookingFieldSchema = z.object({
  name: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  type: z.enum(bookingFieldType),
  required: z.boolean().default(false),
  placeholder: z.string().max(200).optional(),
  /** Options for select/checkbox fields. */
  options: z.array(z.string()).optional(),
});
export type BookingField = z.infer<typeof bookingFieldSchema>;

/** ISO-8601 UTC instant. */
export const isoUtcSchema = z.string().datetime({ offset: true });

// --- Availability ---------------------------------------------------------

export const availabilityQuerySchema = z.object({
  /** Public account code (URL segment). */
  accountCode: z.string().min(1),
  /** Member public handle (URL segment). */
  handle: z.string().min(1),
  /** Event-type slug (URL segment). */
  slug: z.string().min(1),
  /** Inclusive window start (ISO-8601 UTC). */
  from: isoUtcSchema,
  /** Exclusive window end (ISO-8601 UTC); the engine caps the span. */
  to: isoUtcSchema,
  /** IANA tz to express slots against (display only; slots are absolute). */
  timeZone: timeZoneSchema.optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export const slotSchema = z.object({
  /** Slot start instant (ISO-8601 UTC). */
  startUtc: isoUtcSchema,
  /** Group events (R23): seats still available at this slot. */
  spotsLeft: z.number().int().optional(),
  /** Group events (R23): total seats per slot. */
  capacity: z.number().int().optional(),
});
export type Slot = z.infer<typeof slotSchema>;

/**
 * Why `slots` came back empty for a CONFIGURATION reason. Absent on a sound
 * config (empty then means genuinely fully-booked / out of range). Codes are
 * safe to expose publicly; human copy is the client's job (admin gets
 * actionable detail, public pages get generic wording).
 */
export const availabilityEmptyReasonSchema = z.enum(AVAILABILITY_EMPTY_REASONS);
export type AvailabilityEmptyReason = z.infer<typeof availabilityEmptyReasonSchema>;

export const availabilityResponseSchema = z.object({
  eventType: z.object({
    slug: z.string(),
    title: z.string(),
    lengthMinutes: z.number().int().positive(),
    /** Custom intake fields to render on the booking form. */
    bookingFields: z.array(bookingFieldSchema).default([]),
    /** Team scheduling method (null for personal events). */
    schedulingType: z.enum(schedulingType).nullable().default(null),
  }),
  timeZone: timeZoneSchema,
  slots: z.array(slotSchema),
  /** Present only when slots is empty because of a configuration error. */
  emptyReason: availabilityEmptyReasonSchema.optional(),
});
export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;

// --- Booking --------------------------------------------------------------

export const attendeeSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  timeZone: timeZoneSchema,
  notes: z.string().max(2000).optional(),
  /** E.164 phone (SMS/reminders). */
  phone: z.string().max(32).optional(),
  /** Drives notification/.ics language. */
  language: z.enum(['es', 'en']).optional(),
});
export type Attendee = z.infer<typeof attendeeSchema>;

/** Intake answers: fieldName -> value (string | boolean | string[]). */
export const intakeAnswersSchema = z.record(
  z.string(),
  z.union([z.string(), z.boolean(), z.array(z.string())]),
);
export type IntakeAnswers = z.infer<typeof intakeAnswersSchema>;

export const createBookingSchema = z.object({
  accountCode: z.string().min(1),
  handle: z.string().min(1),
  slug: z.string().min(1),
  /** Chosen slot start (ISO-8601 UTC). */
  startUtc: isoUtcSchema,
  attendee: attendeeSchema,
  /** Answers to the event type's custom intake fields. */
  answers: intakeAnswersSchema.optional(),
  /** Consume a held reservation (slot hold) if one exists. */
  reservationUid: z.string().max(200).optional(),
  /** Idempotency key to dedupe retries. */
  idempotencyKey: z.string().max(200).optional(),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

// --- Booking-page branding / studio ---------------------------------------

/** The 9 style axes of the booking-page studio (exact values from the prior version). */
export const bookingPageStyleSchema = z.object({
  template: z.enum(['classic', 'split', 'banded']).default('classic'),
  cardStyle: z.enum(['outline', 'elevated', 'filled']).default('outline'),
  corners: z.enum(['sharp', 'soft', 'round']).default('soft'),
  buttons: z.enum(['rounded', 'pill', 'square']).default('rounded'),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  font: z.enum(['sans', 'rounded', 'serif']).default('sans'),
  slotLayout: z.enum(['grid', 'list']).default('grid'),
  dayGroup: z.enum(['flat', 'boxed']).default('flat'),
  slotSelect: z.enum(['soft', 'solid']).default('soft'),
  landingEnabled: z.boolean().default(true),
  defaultEventSlug: z.string().nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
});
export type BookingPageStyle = z.infer<typeof bookingPageStyleSchema>;

export const brandingSchema = z.object({
  displayName: z.string().max(200).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  coverUrl: z.string().url().nullable().optional(),
  /** The single accent color (AA-clamped on render). */
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  style: bookingPageStyleSchema.partial().optional(),
});
export type Branding = z.infer<typeof brandingSchema>;

// --- Reschedule / cancel --------------------------------------------------

export const rescheduleBookingSchema = z.object({
  uid: z.string().min(1),
  newStartUtc: isoUtcSchema,
  /** Attendee manage token (required for public reschedule). */
  manageToken: z.string().optional(),
  idempotencyKey: z.string().max(200).optional(),
});
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingSchema>;

export const cancelBookingSchema = z.object({
  uid: z.string().min(1),
  reason: z.string().max(2000).optional(),
  manageToken: z.string().optional(),
});
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

// --- Reservation holds ----------------------------------------------------

export const reserveSlotSchema = z.object({
  accountCode: z.string().min(1),
  handle: z.string().min(1),
  slug: z.string().min(1),
  startUtc: isoUtcSchema,
});
export type ReserveSlotInput = z.infer<typeof reserveSlotSchema>;

export const bookingViewSchema = z.object({
  uid: z.string(),
  status: z.enum(['accepted', 'pending', 'cancelled', 'rejected']),
  title: z.string(),
  startUtc: isoUtcSchema,
  endUtc: isoUtcSchema,
  host: z.object({ name: z.string().nullable(), handle: z.string().nullable() }),
  attendee: z.object({ name: z.string(), email: z.string(), timeZone: z.string() }),
  /** Where the meeting happens (physical/phone/free-text) and, when generated,
   *  the meeting link — surfaced on the manage page. Both optional/nullable so
   *  existing responses stay valid. */
  location: z.string().nullable().optional(),
  meetingUrl: z.string().nullable().optional(),
  /** One-time manage token URL (cancel/reschedule) — returned only on create. */
  manageUrl: z.string().optional(),
  /** True when an idempotent replay returned the existing booking (B3). */
  deduplicated: z.boolean().optional(),
  /** Event context for the manage page's availability-backed reschedule picker. */
  reschedule: z
    .object({ accountCode: z.string(), handle: z.string(), slug: z.string() })
    .optional(),
});
export type BookingView = z.infer<typeof bookingViewSchema>;

// --- Public page metadata -------------------------------------------------

export const publicProfileSchema = z.object({
  account: z.object({ code: z.string(), name: z.string() }),
  member: z.object({
    handle: z.string(),
    displayName: z.string().nullable(),
    timeZone: z.string(),
    avatarUrl: z.string().nullable(),
    coverUrl: z.string().nullable(),
    brandColor: z.string().nullable(),
    layout: z.string().nullable(),
    style: bookingPageStyleSchema.partial().nullable(),
  }),
  eventTypes: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      lengthMinutes: z.number().int().positive(),
    }),
  ),
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;

// --- Teams (public team pages + round-robin) ------------------------------

export const teamProfileSchema = z.object({
  account: z.object({ code: z.string(), name: z.string() }),
  team: z.object({
    slug: z.string(),
    name: z.string(),
    logoUrl: z.string().nullable(),
    timeZone: z.string(),
  }),
  eventTypes: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      lengthMinutes: z.number().int().positive(),
      schedulingType: z.enum(schedulingType).nullable(),
    }),
  ),
});
export type TeamProfile = z.infer<typeof teamProfileSchema>;

// --- Account / identity ---------------------------------------------------

export const handleAvailableResponseSchema = z.object({
  handle: z.string(),
  available: z.boolean(),
  reason: z.string().nullable(),
});
export type HandleAvailableResponse = z.infer<typeof handleAvailableResponseSchema>;

export const meResponseSchema = z.object({
  accountId: z.string(),
  accountCode: z.string(),
  memberId: z.string(),
  handle: z.string().nullable(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  /** Account-level role + status — the FE gates admin-only surfaces on these. */
  role: z.enum(accountRole),
  status: z.enum(memberStatus),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// --- Member management (workspace roster) ---------------------------------

/** Invite a member by email. Owner can never be invited (transferred, not granted). */
export const memberInviteSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(['admin', 'member']).optional(),
  displayName: z.string().max(200).nullable().optional(),
});
export type MemberInvite = z.infer<typeof memberInviteSchema>;

/** Patch a member's role and/or status. At least one field must be present. */
export const memberPatchSchema = z
  .object({
    role: z.enum(accountRole).optional(),
    status: z.enum(memberStatus).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: 'Provide a role or status to change.',
  });
export type MemberPatch = z.infer<typeof memberPatchSchema>;

export const memberViewSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  handle: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: z.enum(accountRole),
  status: z.enum(memberStatus),
  createdAt: z.number(),
});
export type MemberViewDto = z.infer<typeof memberViewSchema>;

// --- Event-type CRUD ------------------------------------------------------

export const eventTypeInputSchema = z.object({
  slug: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  lengthMinutes: z.number().int().positive().max(1440),
  /** Where the meeting happens (free text: "Google Meet", "Phone", an address).
   *  Copied onto each booking's `location` so the manage page can show a Where. */
  location: z.string().max(500).nullable().optional(),
  scheduleId: z.string().nullable().optional(),
  hidden: z.boolean().optional(),
  schedulingType: z.enum(schedulingType).nullable().optional(),
  minimumBookingNotice: z.number().int().min(0).optional(),
  beforeEventBuffer: z.number().int().min(0).optional(),
  afterEventBuffer: z.number().int().min(0).optional(),
  slotInterval: z.number().int().positive().nullable().optional(),
  requiresConfirmation: z.boolean().optional(),
  seatsPerTimeSlot: z.number().int().positive().nullable().optional(),
  bookingFields: z.array(bookingFieldSchema).optional(),
  /** For team events: the host member ids (round-robin pool). */
  hostMemberIds: z.array(z.string()).optional(),
  /** For team events: per-host round-robin detail. Takes precedence over hostMemberIds. */
  hosts: z
    .array(
      z.object({
        memberId: z.string(),
        priority: z.number().int().nullable().optional(),
        weight: z.number().int().positive().nullable().optional(),
        isFixed: z.boolean().optional(),
      }),
    )
    .optional(),
  teamId: z.string().nullable().optional(),
});
export type EventTypeInput = z.infer<typeof eventTypeInputSchema>;

// --- Schedule CRUD --------------------------------------------------------

export const availabilityRuleInputSchema = z.object({
  /** Weekday numbers (0=Sun..6=Sat) for a recurring rule; null for an override. */
  days: z.array(z.number().int().min(0).max(6)).nullable(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  /** "YYYY-MM-DD" for a date override; null for recurring. */
  date: z.string().nullable(),
});
export type AvailabilityRuleInput = z.infer<typeof availabilityRuleInputSchema>;

export const scheduleInputSchema = z.object({
  name: z.string().min(1).max(200),
  timeZone: timeZoneSchema,
  rules: z.array(availabilityRuleInputSchema).optional(),
});
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

// --- Team CRUD ------------------------------------------------------------

export const teamInputSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80),
  bio: z.string().max(2000).nullable().optional(),
  // A https URL or a small data-URL logo. Capped server-side (~1MB image →
  // base64 overhead) so a non-UI caller can't push an unbounded TEXT value.
  logoUrl: z.string().max(1_500_000).nullable().optional(),
  timeZone: timeZoneSchema.optional(),
  hideBranding: z.boolean().optional(),
});
export type TeamInput = z.infer<typeof teamInputSchema>;

export const teamMemberInputSchema = z.object({
  memberId: z.string().min(1),
  role: z.enum(membershipRole).optional(),
});
export type TeamMemberInput = z.infer<typeof teamMemberInputSchema>;

/** Problem-details error body (RFC 7807-ish) the API returns. */
export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
