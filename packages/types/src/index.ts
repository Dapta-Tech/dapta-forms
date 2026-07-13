/**
 * @quill/types — the typed contract shared by the API and the web app.
 * Zod schemas are the single source of truth: the API re-validates every
 * request against them, and the web forms derive their client-side validation
 * from the same schema (never trust the client; validate on both sides).
 */
import { z } from 'zod';
import { FORM_FIELD_TYPES } from '@quill/engine';

// --- Identity enums (kept from the platform, portable across SQLite & PG) ----

export const membershipRole = ['member', 'admin', 'owner'] as const;
export type MembershipRole = (typeof membershipRole)[number];

/**
 * Account-level role (on `member`). `owner` administers the whole workspace
 * (+ transfer/delete), `admin` manages members and everyone's resources,
 * `member` is staff scoped to their own resources.
 */
export const accountRole = ['owner', 'admin', 'member'] as const;
export type AccountRole = (typeof accountRole)[number];

/** Member lifecycle within a workspace. */
export const memberStatus = ['active', 'invited', 'disabled'] as const;
export type MemberStatus = (typeof memberStatus)[number];

/** API-key scopes for the machine surface. */
export const apiScope = ['forms:read', 'submissions:read', 'submissions:write'] as const;
export type ApiScope = (typeof apiScope)[number];

// --- Form field kinds --------------------------------------------------------

/** The step/field kinds a form may ask (mirrors @quill/engine FORM_FIELD_TYPES). */
export const formFieldType = FORM_FIELD_TYPES;
export type FormFieldType = (typeof formFieldType)[number];

// --- Form config (versioned JSON blob that drives the whole public flow) ------

const optionSchema = z.object({
  label: z.string().min(1).max(200),
  value: z.string().min(1).max(200),
  points: z.number().int().optional(),
  icon: z.string().max(64).nullable().optional(),
});

const conditionSchema = z.object({
  field: z.string().min(1),
  values: z.array(z.string()),
});

const sliderScoringSchema = z.object({
  min: z.number(),
  max: z.number(),
  points: z.number().int(),
});

export const formStepSchema = z.object({
  key: z.string().min(1).max(64),
  type: z.enum(formFieldType),
  question: z.string().max(500).optional(),
  helper: z.string().max(1000).nullable().optional(),
  placeholder: z.string().max(200).nullable().optional(),
  required: z.boolean().optional(),
  buttonText: z.string().max(80).nullable().optional(),
  options: z.array(optionSchema).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  default: z.number().optional(),
  sliderScoring: z.array(sliderScoringSchema).optional(),
  showWhen: conditionSchema.nullable().optional(),
  hideWhen: conditionSchema.nullable().optional(),
  points: z.number().int().optional(),
  flowGroup: z.enum(['qualification', 'lead_capture']).optional(),
  corporateEmailOnly: z.boolean().optional(),
  phoneMinDigits: z.number().int().positive().optional(),
  /** Dynamic question: pick the text from the answer to this earlier field. */
  questionField: z.string().min(1).nullable().optional(),
  /** value → question text (a `*` key is the fallback); `[field]` interpolated. */
  questionVariants: z.record(z.string(), z.string().max(500)).optional(),
});
export type FormStepInput = z.infer<typeof formStepSchema>;

export const formCoverSchema = z.object({
  enabled: z.boolean().optional(),
  /** A sticky banner line shown above the form throughout the flow. */
  bannerText: z.string().max(200).nullable().optional(),
  eyebrow: z.string().max(200).nullable().optional(),
  headline: z.string().max(300).nullable().optional(),
  subheadline: z.string().max(500).nullable().optional(),
  ctaText: z.string().max(80).nullable().optional(),
  trustBadge: z.string().max(200).nullable().optional(),
});

/** Per-form branding — the single accent color drives the public surface. */
export const formBrandingSchema = z.object({
  primaryColor: z.string().max(32).nullable().optional(),
});

export const formOutcomeSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  minScore: z.number().int().optional(),
  redirectUrl: z.string().url().nullable().optional(),
});

// --- Submission destinations (pluggable CRM / webhook sync) ------------------

/** The configurable destination kinds a form may deliver submissions to. */
export const destinationType = ['webhook', 'hubspot'] as const;
export type DestinationType = (typeof destinationType)[number];

/** A property map: form stepKey / utmKey -> external property name. */
const propertyMapSchema = z.record(z.string().min(1).max(200), z.string().min(1).max(200));

/**
 * Webhook destination — POST each submission as JSON to a URL, optionally HMAC
 * signed. The secret is server-side config, never leaked to the public renderer
 * (the API strips `destinations` before serving a public form).
 */
export const webhookDestinationSchema = z.object({
  type: z.literal('webhook'),
  enabled: z.boolean().default(false),
  settings: z.object({
    // https-only, with ONE exception: plain http for localhost/127.0.0.1 (local
    // dev catcher). Mirrors the admin UI validation — keep the two in sync.
    url: z
      .string()
      .url()
      .refine(
        // Already a valid URL per .url(); prefix checks avoid the URL global
        // (not in this package's lib set).
        (v) => v.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)([:/?#]|$)/.test(v),
        { message: 'Webhook URL must use https (plain http is allowed only for localhost).' },
      ),
    /** HMAC-SHA256 signing secret (optional). */
    secret: z.string().max(500).nullable().optional(),
    /** Header the signature is sent in (defaults to `X-Quill-Signature`). */
    signatureHeader: z.string().max(128).nullable().optional(),
    /** Per-request timeout in ms (defaults to 10s). */
    timeoutMs: z.number().int().positive().max(60_000).optional(),
  }),
});
export type WebhookDestination = z.infer<typeof webhookDestinationSchema>;

/**
 * HubSpot destination — upsert the respondent as a contact and (on complete)
 * attach a Note. The private-app token is a server-side env secret
 * (`HUBSPOT_PRIVATE_APP_TOKEN`), NOT stored in the form config.
 */
export const hubspotDestinationSchema = z.object({
  type: z.literal('hubspot'),
  enabled: z.boolean().default(false),
  settings: z.object({ note: z.boolean().optional() }).default({}),
  /** stepKey -> contact property (one property SHOULD be `email`). */
  fieldMappings: propertyMapSchema.default({}),
  /** utm_source/medium/campaign/term/content -> contact property. */
  utmMappings: propertyMapSchema.default({}),
  /** Contact property to receive the score (complete submissions). */
  scoreProperty: z.string().max(200).nullable().optional(),
  /** Contact date property to receive the submitted date. */
  dateProperty: z.string().max(200).nullable().optional(),
});
export type HubspotDestination = z.infer<typeof hubspotDestinationSchema>;

export const formDestinationSchema = z.discriminatedUnion('type', [
  webhookDestinationSchema,
  hubspotDestinationSchema,
]);
export type FormDestination = z.infer<typeof formDestinationSchema>;

/** The versioned config blob. `version` gates future migrations of the shape. */
export const formConfigSchema = z.object({
  version: z.literal(1),
  cover: formCoverSchema.nullable().optional(),
  branding: formBrandingSchema.nullable().optional(),
  steps: z.array(formStepSchema).default([]),
  scoring: z.object({ enabled: z.boolean().optional() }).nullable().optional(),
  outcomes: z.array(formOutcomeSchema).optional(),
  /**
   * Pluggable submission destinations (CRM/webhook sync via the durable outbox).
   * ADDITIVE — absent on every legacy config; the renderer never receives it.
   */
  destinations: z.array(formDestinationSchema).optional(),
});
export type FormConfig = z.infer<typeof formConfigSchema>;

/** An empty but valid v1 config — the shape a freshly-created form starts with. */
export const EMPTY_FORM_CONFIG: FormConfig = { version: 1, steps: [] };

// --- Form CRUD (admin) -------------------------------------------------------

export const formInputSchema = z.object({
  name: z.string().min(1).max(200),
  /** Optional; auto-slugified from name (unique per account) when omitted. */
  slug: z.string().min(1).max(80).optional(),
  config: formConfigSchema.optional(),
});
export type FormInput = z.infer<typeof formInputSchema>;

export const formViewSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  slug: z.string(),
  config: formConfigSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type FormView = z.infer<typeof formViewSchema>;

/** Public shape of a published form (no internal ids leaked beyond the slug). */
export const publicFormSchema = z.object({
  slug: z.string(),
  name: z.string(),
  config: formConfigSchema,
});
export type PublicForm = z.infer<typeof publicFormSchema>;

// --- Submissions -------------------------------------------------------------

/** One submission's answers: fieldName -> value. */
export const submissionAnswersSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
);
export type SubmissionAnswers = z.infer<typeof submissionAnswersSchema>;

export const submissionSchema = z.object({
  /** Per-session id (sessionStorage) tying events + the submission together. */
  sessionId: z.string().min(1).max(200),
  data: submissionAnswersSchema,
  /** True for an intermediate (partial) save; false/absent = final submit. */
  partial: z.boolean().optional(),
});
export type SubmissionInput = z.infer<typeof submissionSchema>;

export const submissionViewSchema = z.object({
  id: z.string(),
  formId: z.string(),
  sessionId: z.string(),
  data: submissionAnswersSchema,
  score: z.number().int(),
  startedAt: z.number(),
  completedAt: z.number().nullable(),
  partialAt: z.number().nullable(),
});
export type SubmissionView = z.infer<typeof submissionViewSchema>;

// --- Funnel events -----------------------------------------------------------

export const formEventType = [
  'view',
  'start',
  'step_view',
  'step_complete',
  'partial_submit',
  'submit',
] as const;
export type FormEventType = (typeof formEventType)[number];

export const formEventSchema = z.object({
  sessionId: z.string().min(1).max(200),
  type: z.enum(formEventType),
  stepIndex: z.number().int().min(0).nullable().optional(),
});
export type FormEventInput = z.infer<typeof formEventSchema>;

// --- Analytics (funnel + per-step drop-off) ----------------------------------
// ADDITIVE: new exports only. These describe the admin analytics dashboard
// response (GET /v1/forms/:id/analytics) — a funnel summary plus a
// question-by-question drop-off table (a cover row + one row per configured
// step). Computed server-side from form_event + submission; works identically
// on SQLite and Postgres.

/** One row of the question-by-question drop-off table. */
export const dropoffRowSchema = z.object({
  /** -1 for the synthetic cover/landing row, otherwise the 0-based step index. */
  stepIndex: z.number().int(),
  /** The step's field key (null for the cover row). */
  key: z.string().nullable(),
  /** Human label for the row (the step question, or the cover title). */
  question: z.string(),
  /** True for the synthetic cover/landing row. */
  isCover: z.boolean(),
  /** Sessions that viewed this step (form views for the cover row). */
  views: z.number().int(),
  /** Sessions lost between this row and the next (never negative). */
  dropoff: z.number().int(),
  /** Drop-off as a percentage of this row's views (1 decimal). */
  dropoffPercent: z.number(),
});
export type DropoffRow = z.infer<typeof dropoffRowSchema>;

/** The funnel summary + drop-off table for a form over an optional date range. */
export const analyticsResponseSchema = z.object({
  /** Count of `view` events. */
  views: z.number().int(),
  /** Count of `start` events. */
  starts: z.number().int(),
  /** Count of completed submissions (completedAt set). */
  submissions: z.number().int(),
  /** submissions / starts as a percentage (1 decimal); 0 when starts=0. */
  completionRate: z.number(),
  /** Average seconds from startedAt→completedAt over completed submissions. */
  avgTimeToComplete: z.number().int(),
  /** Partial-only submissions (partialAt set, completedAt null). */
  partialSubmits: z.number().int(),
  /** Cover row + one row per configured step. */
  dropoff: z.array(dropoffRowSchema),
  /** Echoes the resolved range (epoch ms) so the client can render it. */
  range: z.object({ from: z.number().nullable(), to: z.number().nullable() }),
});
export type AnalyticsResponse = z.infer<typeof analyticsResponseSchema>;

// --- Submissions listing (paginated + filtered) ------------------------------
// ADDITIVE: the admin submissions table response. `status` narrows to complete
// or partial; `from`/`to` bound by startedAt; `limit`/`offset` paginate.

export const submissionStatusFilter = ['all', 'completed', 'partial'] as const;
export type SubmissionStatusFilter = (typeof submissionStatusFilter)[number];

export const submissionsPageSchema = z.object({
  items: z.array(submissionViewSchema),
  /** Total rows matching the filter (before pagination). */
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type SubmissionsPage = z.infer<typeof submissionsPageSchema>;

// --- Member management (workspace roster) ------------------------------------

export const memberInviteSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(['admin', 'member']).optional(),
  displayName: z.string().max(200).nullable().optional(),
});
export type MemberInvite = z.infer<typeof memberInviteSchema>;

export const memberPatchSchema = z
  .object({
    role: z.enum(accountRole).optional(),
    status: z.enum(memberStatus).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: 'Provide a role or status to change.',
  });
export type MemberPatch = z.infer<typeof memberPatchSchema>;

export const meResponseSchema = z.object({
  accountId: z.string(),
  accountCode: z.string(),
  memberId: z.string(),
  handle: z.string().nullable(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  role: z.enum(accountRole),
  status: z.enum(memberStatus),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** Problem-details error body (RFC 7807-ish) the API returns. */
export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
