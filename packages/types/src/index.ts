/**
 * @quill/types — the typed contract shared by the API and the web app.
 * Zod schemas are the single source of truth: the API re-validates every
 * request against them, and the web forms derive their client-side validation
 * from the same schema (never trust the client; validate on both sides).
 */
import { z } from 'zod';
import { CONDITION_OPS, FORM_FIELD_TYPES, isSafeHttpUrl, isSafeImageUrl } from '@quill/engine';

/** A URL rendered into `<img src>` — reject script protocols (XSS defense-in-depth). */
const safeImageUrl = z
  .string()
  .max(2048)
  .refine(isSafeImageUrl, { message: 'Image URL protocol not allowed.' });

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

/**
 * Visibility-condition operators (mirrors the engine's `CONDITION_OPS`). Absent
 * on a stored condition = `in`, so every pre-operator config still parses.
 */
export const conditionOp = z.enum(CONDITION_OPS);
export type ConditionOp = z.infer<typeof conditionOp>;

/**
 * A show/hide condition. ADDITIVE, back-compat: `op`/`value`/`min`/`max` are all
 * optional and a bare `{field, values}` keeps its original `in` ("matches any
 * of") meaning. `values` is optional (numeric ops eq/gt/lt/between omit it); the
 * engine's `conditionHolds` treats an absent `values` as an empty match. Kept
 * optional (not `.default([])`) so the inferred type matches the engine's
 * `StepCondition.values?: string[]` — otherwise FormConfig fails to assign.
 */
const conditionSchema = z.object({
  field: z.string().min(1),
  values: z.array(z.string()).optional(),
  /** Comparison operator; absent = `in`. Numeric ops apply to slider/number fields. */
  op: conditionOp.optional(),
  /** Operand for `eq` / `gt` / `lt`. */
  value: z.number().optional(),
  /** Lower bound for `between` (inclusive). */
  min: z.number().optional(),
  /** Upper bound for `between` (inclusive). */
  max: z.number().optional(),
});

/**
 * A forward branching rule (additive, back-compat): when the owning step's
 * answer intersects `values`, jump to `target` (a step key) or skip to the end
 * (`target: null`). The engine only honors forward jumps, so a config can never
 * loop; unknown/backward targets are ignored at runtime.
 */
const gotoRuleSchema = z.object({
  values: z.array(z.string()).min(1),
  target: z.string().min(1).max(64).nullable(),
});

const sliderScoringSchema = z.object({
  min: z.number(),
  max: z.number(),
  points: z.number().int(),
});

const clientLogoSchema = z.object({
  name: z.string().min(1).max(80),
  src: safeImageUrl.nullable().optional(),
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
  /** Forward branching rules on this step's answer (jump to a step / skip to end). */
  goto: z.array(gotoRuleSchema).optional(),
  /** Choice select mode (`multiple_choice` only): 'multiple' = checkboxes, else single. */
  selectionMode: z.enum(['single', 'multiple']).optional(),
  points: z.number().int().optional(),
  flowGroup: z.enum(['qualification', 'lead_capture']).optional(),
  corporateEmailOnly: z.boolean().optional(),
  phoneMinDigits: z.number().int().positive().optional(),
  // --- Builder + runtime extensions (all optional; back-compat) -------------
  /** Dynamic question: pick the text from the answer to this earlier field. */
  questionField: z.string().min(1).max(64).nullable().optional(),
  /** value → question text (a `*` key is the fallback); `[field]` interpolated. */
  questionVariants: z.record(z.string(), z.string().max(500)).optional(),
  fields: z.array(z.string().min(1).max(64)).max(4).optional(),
  placeholders: z.record(z.string(), z.string().max(200)).optional(),
  sliderLabelVariants: z.record(z.string(), z.string().max(80)).optional(),
  sliderUnitLabel: z.string().max(80).nullable().optional(),
  showIcons: z.boolean().optional(),
  showForPersonalEmailOnly: z.boolean().optional(),
  terminal: z.boolean().optional(),
  triggersReveal: z.boolean().optional(),
  /**
   * Hidden step (ADDITIVE): never rendered as a visible question — the engine's
   * `visibleSteps` skips it — but its answer can be supplied via a matching URL
   * parameter and carried into the submission. Not shown for `message` steps.
   */
  hidden: z.boolean().optional(),
  /**
   * `phone` step: ISO 3166-1 alpha-2 the public country picker defaults to
   * (e.g. "CO"). ADDITIVE — absent = the locale-based default. Two-char cap so a
   * bad value can only fall back, never break the lookup.
   */
  phoneDefaultCountry: z.string().max(2).nullable().optional(),
});
export type FormStepInput = z.infer<typeof formStepSchema>;

export const formCoverSchema = z.object({
  enabled: z.boolean().optional(),
  /** A sticky banner line shown above the form throughout the flow. */
  bannerText: z.string().max(200).nullable().optional(),
  eyebrow: z.string().max(200).nullable().optional(),
  badge: z.string().max(200).nullable().optional(),
  headline: z.string().max(300).nullable().optional(),
  subheadline: z.string().max(500).nullable().optional(),
  ctaText: z.string().max(80).nullable().optional(),
  trustBadge: z.string().max(200).nullable().optional(),
  logo: safeImageUrl.nullable().optional(),
  clientLogos: z.array(clientLogoSchema).max(24).optional(),
});

/**
 * A CSS color value flowing into an inline custom property (`--pf-primary`) on
 * the public renderer. Constrain the format (hex / rgb(a) / hsl(a) / named) so a
 * value like `red;} body{...` can't break out of the color context — CSS-
 * injection defense-in-depth on top of the 32-char cap (L2).
 */
const cssColor = z
  .string()
  .max(32)
  .refine(
    (v) =>
      /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ||
      /^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/-]+\)$/.test(v) ||
      /^[a-zA-Z]+$/.test(v),
    { message: 'primaryColor must be a hex, rgb(a)/hsl(a), or named CSS color.' },
  );

export const formBrandingSchema = z.object({
  primaryColor: cssColor.nullable().optional(),
  logo: safeImageUrl.nullable().optional(),
  clientLogos: z.array(clientLogoSchema).max(24).optional(),
});

export const formRevealSchema = z.object({
  enabled: z.boolean().optional(),
  headline: z.string().max(300).nullable().optional(),
  subtitle: z.string().max(500).nullable().optional(),
  // --- Reveal extensions (all optional; back-compat) -------------------------
  /** How long the processing interstitial plays before the result (ms). */
  durationMs: z.number().int().min(500).max(30_000).optional(),
  /** Outcome subtitle template; `[key]` tokens interpolate from the answers. */
  subtitleTemplate: z.string().max(200).nullable().optional(),
  /** Pre-warm the booking embed while the interstitial plays. */
  prewarm: z.boolean().optional(),
});

// --- Outcome extensions (booking + answer-forced overrides) ------------------

/** Scheduling providers an outcome can hand off to after the form completes. */
export const bookingProvider = ['hubspot_meetings', 'calendly'] as const;
export type BookingProvider = (typeof bookingProvider)[number];

/**
 * Scheduling handoff for an outcome: the renderer embeds/links the provider's
 * booking page after this outcome resolves. Same http(s)-only guard as
 * `redirectUrl` — the URL flows into navigation/an embed (XSS defense-in-depth).
 */
export const outcomeBookingSchema = z.object({
  provider: z.enum(bookingProvider),
  url: z
    .string()
    .url()
    .refine(isSafeHttpUrl, { message: 'booking url must use http(s).' }),
  /** Prefill the booking form from collected answers (name/email). */
  prefill: z.boolean().optional(),
});
export type OutcomeBooking = z.infer<typeof outcomeBookingSchema>;

/**
 * An answer-forced outcome rule: when the answer to `field` matches, this
 * outcome wins REGARDLESS of score (e.g. a slider answer <= 0 forces the P0
 * outcome). All specified clauses must hold; at least one clause is required.
 */
export const outcomeOverrideSchema = z
  .object({
    field: z.string().min(1).max(64),
    /** Match when the (string/array) answer intersects these values. */
    values: z.array(z.string().max(200)).optional(),
    /** Match when the numeric answer is <= this bound. */
    maxValue: z.number().optional(),
    /** Match when the numeric answer is >= this bound. */
    minValue: z.number().optional(),
  })
  .refine((r) => r.values !== undefined || r.maxValue !== undefined || r.minValue !== undefined, {
    message: 'An override rule needs values, maxValue, or minValue.',
  });
export type OutcomeOverride = z.infer<typeof outcomeOverrideSchema>;

export const formOutcomeSchema = z.object({
  id: z.string().min(1).max(64),
  // Empty label is allowed: the builder creates a range before the user names it,
  // and the renderer/ScoreBar fall back to `#<n>`. Relaxing min(1) is a superset
  // (every previously-valid config still parses) and keeps autosave from 400-ing
  // the moment "Add a range" is clicked.
  label: z.string().max(200),
  minScore: z.number().int().optional(),
  // http(s) only: the renderer navigates here (`window.location`), so a
  // `javascript:`/`data:` URL — which `.url()` alone would accept — is a stored
  // XSS vector. Guarded again at the sink in the renderer (belt-and-braces).
  redirectUrl: z
    .string()
    .url()
    .refine(isSafeHttpUrl, { message: 'redirectUrl must use http(s).' })
    .nullable()
    .optional(),
  // --- Outcome extensions (all optional; back-compat) ------------------------
  /**
   * Per-outcome thank-you body (V4-16). Rendered as the done-screen body when
   * set (falling back to the shared thank-you body); `label` stays the heading.
   * Plain text with `[field]` tokens interpolated by the renderer.
   */
  message: z.string().max(2000).nullable().optional(),
  /** Scheduling handoff (HubSpot Meetings / Calendly) shown for this outcome. */
  booking: outcomeBookingSchema.nullable().optional(),
  /**
   * Answer-forced rules: when ANY rule matches the answers, this outcome wins
   * over score bucketing (outcomes are scanned in declared order).
   */
  overrides: z.array(outcomeOverrideSchema).optional(),
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
  /**
   * Stable per-destination id (additive). Minted on first save and round-tripped
   * by the admin UI so `mergeWebhookSecrets` can match a masked-secret write to
   * its stored counterpart by IDENTITY, not array position — correct even when
   * multiple webhooks are reordered or one is deleted. Optional for back-compat
   * (legacy configs have none; the merge self-heals by minting one on save).
   */
  id: z.string().max(64).optional(),
  enabled: z.boolean().default(false),
  /**
   * Which submission phases fire this webhook (additive; default = both).
   * `partial` = a partial submission past the lead-capture threshold;
   * `complete` = a finished submission. Absent/empty is treated as BOTH for
   * back-compat with configs saved before per-event triggers existed.
   */
  events: z.array(z.enum(['partial', 'complete'])).optional(),
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
    /** Header the signature is sent in (defaults to `X-Forms-Signature`). */
    signatureHeader: z.string().max(128).nullable().optional(),
    /** Per-request timeout in ms (defaults to 10s). */
    timeoutMs: z.number().int().positive().max(60_000).optional(),
  }),
});
export type WebhookDestination = z.infer<typeof webhookDestinationSchema>;

/** Submission phases a destination can subscribe to. */
export const destinationEvents = ['partial', 'complete'] as const;
export type DestinationEvent = (typeof destinationEvents)[number];

/**
 * Resolve whether a destination should fire for a given phase. Absent/empty
 * `events` = both phases (back-compat). Only webhook destinations carry an
 * `events` filter today; others always fire (their adapters gate internally).
 */
export function destinationFiresForPhase(
  destination: { type: string; events?: DestinationEvent[] | undefined },
  phase: DestinationEvent,
): boolean {
  const events = destination.events;
  if (!events || events.length === 0) return true;
  return events.includes(phase);
}

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
  // --- HubSpot extensions (all optional; back-compat) ------------------------
  /** stepKey -> (answer value -> property value): translate answers on the way out. */
  valueMaps: z
    .record(z.string().min(1).max(200), z.record(z.string().max(200), z.string().max(200)))
    .optional(),
  /** Contact property to receive the resolved outcome id/label. */
  outcomeProperty: z.string().max(200).nullable().optional(),
  /** Fixed property values stamped on every synced contact. */
  staticProperties: z.record(z.string().min(1).max(200), z.string().max(500)).optional(),
  /** Derive the company name from the respondent's email domain. */
  inferCompanyFromEmail: z.boolean().optional(),
  /**
   * Booking sync — which contact properties receive the booking facts when a
   * visitor books a meeting through an outcome's scheduling handoff (the
   * `booking_sync` outbox flow). All optional; absent = booking sync is a
   * no-op for this destination.
   *  - `stageProperty` is set to `stageValue` verbatim (e.g. a sales-stage
   *    enum internal value) — the "demo booked" stage stamp.
   *  - `dateProperty` receives the meeting-start CALENDAR DAY as UTC-midnight
   *    epoch-ms (HubSpot `date`-type properties require midnight UTC).
   *  - `hoursProperty` receives the exact meeting start as epoch-ms (a
   *    HubSpot `datetime`-type property).
   */
  bookingSync: z
    .object({
      stageProperty: z.string().max(200).optional(),
      stageValue: z.string().max(200).optional(),
      dateProperty: z.string().max(200).optional(),
      hoursProperty: z.string().max(200).optional(),
    })
    .optional(),
});
export type HubspotDestination = z.infer<typeof hubspotDestinationSchema>;

export const formDestinationSchema = z.discriminatedUnion('type', [
  webhookDestinationSchema,
  hubspotDestinationSchema,
]);
export type FormDestination = z.infer<typeof formDestinationSchema>;

/**
 * Sentinel returned in place of a stored webhook signing secret on every ADMIN
 * READ (GET /v1/forms/:id and the create/update/duplicate/destinations
 * responses) so the plaintext secret never leaves the server. It doubles as the
 * "unchanged" marker on WRITE: when the integrations UI submits this value back
 * (the operator left the field untouched), the server keeps the stored secret —
 * see `mergeWebhookSecrets`. Distinctive so a real secret can never collide.
 */
export const WEBHOOK_SECRET_MASK = '__DAPTA_FORMS_SECRET_KEEP__';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Isomorphic UUID (Web Crypto in Node 20+ and modern browsers) with a fallback. */
function newDestinationId(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  return (
    g.crypto?.randomUUID?.() ??
    `wh_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  );
}

/**
 * Return a copy of a destinations array with every non-empty webhook signing
 * secret replaced by `WEBHOOK_SECRET_MASK` (so a READ never exposes plaintext).
 * Destinations with no secret are returned untouched. Defensive against loosely
 * typed stored JSON — non-webhook / malformed entries pass through unchanged.
 */
export function maskDestinationSecrets(destinations: unknown): unknown {
  if (!Array.isArray(destinations)) return destinations;
  return destinations.map((d) => {
    if (!isRecord(d) || d.type !== 'webhook' || !isRecord(d.settings)) return d;
    const secret = d.settings.secret;
    if (typeof secret === 'string' && secret.length > 0) {
      return { ...d, settings: { ...d.settings, secret: WEBHOOK_SECRET_MASK } };
    }
    return d;
  });
}

/** Return a copy of a form config with its destinations' webhook secrets masked. */
export function maskConfigSecrets(config: unknown): unknown {
  if (!isRecord(config) || !('destinations' in config)) return config;
  return { ...config, destinations: maskDestinationSecrets(config.destinations) };
}

/**
 * Merge an incoming destinations array against the currently-stored one: any
 * webhook whose incoming secret is `WEBHOOK_SECRET_MASK` keeps the stored secret
 * (the UI left the field untouched). A real string overwrites it; an empty
 * string / null clears it.
 *
 * Matching is by STABLE ID (M3): each webhook carries an `id` (minted here on
 * first save and round-tripped by the admin UI), so a masked-secret write is
 * paired with its stored counterpart by identity — correct even when multiple
 * webhooks are reordered or one is deleted. Legacy configs with no ids fall back
 * to positional matching among webhook entries and self-heal (an id is minted
 * and persisted on this write).
 */
export function mergeWebhookSecrets(incoming: unknown[], existing: unknown): unknown[] {
  const storedWebhooks = (Array.isArray(existing) ? existing : []).filter(
    (d): d is Record<string, unknown> => isRecord(d) && d.type === 'webhook',
  );
  const storedById = new Map<string, Record<string, unknown>>();
  for (const w of storedWebhooks) {
    if (typeof w.id === 'string' && w.id.length > 0) storedById.set(w.id, w);
  }
  let positional = 0; // fallback cursor for legacy (id-less) configs
  return incoming.map((d) => {
    if (!isRecord(d) || d.type !== 'webhook') return d;
    const id = typeof d.id === 'string' && d.id.length > 0 ? d.id : newDestinationId();
    const settings = isRecord(d.settings) ? d.settings : {};
    // Prefer a stable-id match; fall back to positional for id-less legacy configs.
    const prev =
      (typeof d.id === 'string' ? storedById.get(d.id) : undefined) ?? storedWebhooks[positional];
    positional += 1;
    if (settings.secret === WEBHOOK_SECRET_MASK) {
      const prevSecret = isRecord(prev?.settings) ? prev!.settings.secret : undefined;
      return { ...d, id, settings: { ...settings, secret: prevSecret ?? null } };
    }
    return { ...d, id };
  });
}

// --- Analytics / marketing tag ids (rendered by the public page) -------------

/**
 * Third-party tracking ids for the public form page. All optional, loosely
 * validated strings (each vendor has its own id format; the renderer only ever
 * interpolates them into vendor snippets, never executes them as markup).
 */
export const formTrackingSchema = z.object({
  /** Google Tag Manager container id (e.g. GTM-XXXXXXX). */
  gtmId: z.string().max(32).nullable().optional(),
  /** Meta (Facebook) Pixel id. */
  metaPixelId: z.string().max(32).nullable().optional(),
  /** PostHog project API key. */
  posthogKey: z.string().max(128).nullable().optional(),
  /** PostHog host override (self-hosted / EU cloud). */
  posthogHost: z
    .string()
    .max(256)
    .url()
    .refine(isSafeHttpUrl, 'must be an http(s) URL')
    .nullable()
    .optional(),
  /** HubSpot tracking code portal id. */
  hubspotTrackingId: z.string().max(32).nullable().optional(),
});
export type FormTracking = z.infer<typeof formTrackingSchema>;

/** The versioned config blob. `version` gates future migrations of the shape. */
export const formConfigSchema = z.object({
  version: z.literal(1),
  branding: formBrandingSchema.nullable().optional(),
  cover: formCoverSchema.nullable().optional(),
  steps: z.array(formStepSchema).default([]),
  scoring: z.object({ enabled: z.boolean().optional() }).nullable().optional(),
  outcomes: z.array(formOutcomeSchema).optional(),
  /**
   * Pluggable submission destinations (CRM/webhook sync via the durable outbox).
   * ADDITIVE — absent on every legacy config; the renderer never receives it.
   */
  destinations: z.array(formDestinationSchema).optional(),
  reveal: formRevealSchema.nullable().optional(),
  /** Third-party tracking ids (ADDITIVE — absent on every legacy config). */
  tracking: formTrackingSchema.nullable().optional(),
  partialSubmitAfterStep: z.number().int().positive().optional(),
  /**
   * WHERE the reveal interstitial plays (1-based over `steps`; ADDITIVE —
   * mirrors partialSubmitAfterStep). Absent = the engine falls back to the
   * legacy `triggersReveal`, then defaults to after the last step. See
   * `revealAfterKey` in @quill/engine.
   */
  revealAfterStep: z.number().int().positive().optional(),
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
  /** Unpublished working copy (ADDITIVE; null when no draft is pending). */
  draftConfig: formConfigSchema.nullable().optional(),
  /** Epoch-ms of the last publish (ADDITIVE; null when never published). */
  publishedAt: z.number().nullable().optional(),
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

/**
 * One submission's answers: fieldName -> value. Most values are scalars (or a
 * string[] for multi-select); the reserved `utm` key carries a flat string map
 * of the URL's `utm_*` params (additive — captured from the public URL, never a
 * new column: it rides inside the free-form answers JSON).
 */
export const submissionAnswersSchema = z.record(
  z.string(),
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.record(z.string(), z.string()),
    z.null(),
  ]),
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

// --- Booking callbacks (scheduling handoff on the public surface) ------------

/**
 * The public booking callback: the renderer reports a meeting booked through an
 * outcome's scheduling embed (HubSpot Meetings / Calendly) so it can be tied to
 * the session's submission. Persisted as a `booking_event` row; delivery to
 * destinations is a later, outbox-driven concern.
 */
export const bookingCallbackSchema = z.object({
  /** Per-session id (sessionStorage) tying the booking to its submission. */
  sessionId: z.string().min(1).max(200),
  provider: z.enum(bookingProvider),
  /** Provider URI of the scheduled event (Calendly event / HubSpot meeting). */
  eventUri: z.string().url().max(2048).optional(),
  /** Provider URI of the invitee record. */
  inviteeUri: z.string().url().max(2048).optional(),
  /** Scheduled start as an ISO 8601 datetime. */
  startTime: z.string().datetime({ offset: true }).optional(),
});
export type BookingCallbackInput = z.infer<typeof bookingCallbackSchema>;

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

// --- Notification settings (Settings → Notifications) ------------------------

/**
 * The write body for a notification email's per-account settings: toggle it on/
 * off and/or override the subject/body. `subject`/`body` are PLAIN TEXT with
 * `{{token}}` markers; passing `null` resets that field to the shipped default,
 * `undefined` (absent) leaves it untouched. The `emailKey` itself is a path
 * param the API validates against the notifications catalog (kept out of this
 * contract so the package boundary stays one-directional). Every field is
 * optional — an empty patch is a harmless no-op.
 */
export const notificationSettingPatchSchema = z.object({
  enabled: z.boolean().optional(),
  subject: z.string().max(300).nullable().optional(),
  body: z.string().max(8000).nullable().optional(),
});
export type NotificationSettingPatchInput = z.infer<typeof notificationSettingPatchSchema>;

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
