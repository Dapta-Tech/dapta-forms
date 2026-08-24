/**
 * SQLite schema — a PORTABLE SUBSET of the Postgres source-of-truth
 * (schema.pg.ts), for zero-infra local dev only. Mirrors Postgres 1:1 on
 * table/column names (so the repository is dialect-agnostic). Where Postgres
 * uses jsonb, SQLite uses text JSON. SQLite never dictates the schema — Postgres
 * does; this only tracks it.
 *
 * Portable column choices: text UUID PKs (crypto.randomUUID()), instants as
 * INTEGER epoch-ms, booleans as INTEGER 0/1, config/answers as TEXT JSON.
 *
 * NOTE: the numbered SQL files in migrations/ are the SOLE source of applied DDL
 * (see migrate.ts). These drizzle schema objects document the shape and are kept
 * in parity with the migrations + schema.pg.ts, including UNIQUE constraints —
 * so anything regenerated from them does not silently drop a uniqueness guard.
 */
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// --- Platform (identity / delivery) — kept from the shared platform ----------

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  externalId: text('external_id').unique(),
  vanitySlug: text('vanity_slug').unique(),
  daptaEntitlement: text('dapta_entitlement'),
  entitlementCheckedAt: integer('entitlement_checked_at'),
  /** First-touch acquisition context (TEXT JSON, see 0010). Written once by `claimAccountAttribution`. */
  attribution: text('attribution'),
  /** Milestone CLAIM: epoch-ms of the first completed submission. Written once, via UPDATE…WHERE IS NULL. */
  activatedAt: integer('activated_at'),
  /** Milestone CLAIM: epoch-ms of the first form view. Same write-once discipline. */
  firstViewedAt: integer('first_viewed_at'),
  /**
   * Onboarding wizard state AND result (TEXT JSON, see 0011) —
   * `accountOnboardingSchema` in @quill/types. Written on every step advance, so
   * a row with a `lastStep` and no `onboardingCompletedAt` IS the drop-off record.
   */
  onboarding: text('onboarding'),
  /**
   * Milestone CLAIM: epoch-ms the wizard was finished. Also the dashboard gate —
   * NULL means "send them to the wizard".
   */
  onboardingCompletedAt: integer('onboarding_completed_at'),
  /**
   * The identity service's ACCOUNT this workspace hangs from (see 0015).
   * `external_id` is the upstream WORKSPACE id; this is the billing layer above
   * it. NULL for purely local accounts (seed, dev stub).
   */
  iamAccountId: text('iam_account_id'),
  /** Epoch-ms of the last successful projection refresh from the identity service; NULL = never. */
  syncedAt: integer('synced_at'),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  accountIamAccountIdx: index('account_iam_account_idx').on(t.iamAccountId),
}));

/** Retired public codes — each alias permanently resolves to its account. */
export const accountAlias = sqliteTable('account_alias', {
  alias: text('alias').primaryKey(),
  accountId: text('account_id').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const member = sqliteTable(
  'member',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    externalId: text('external_id'),
    handle: text('handle'),
    displayName: text('display_name'),
    email: text('email'),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('active'),
    avatarUrl: text('avatar_url'),
    locale: text('locale'),
    /** The public member page, or NULL when there is none (see 0008). */
    profile: text('profile'),
    /** Epoch-ms of the member's last authenticated request; NULL = never seen (see 0010). */
    lastSeenAt: integer('last_seen_at'),
    /** The upstream `workspace_users.id` for this membership (see 0015); NULL when the identity service does not know it. */
    iamWorkspaceUserId: text('iam_workspace_user_id'),
    /** NULL for a real membership; 'staff' for a domain-based access grant (0016). */
    accessGrant: text('access_grant'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    memberAccountExternalUq: uniqueIndex('member_account_external_uq').on(t.accountId, t.externalId),
  }),
);

export const apiKey = sqliteTable('api_key', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull().unique(),
  last4: text('last4').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  scopes: text('scopes'),
  lastUsedAtMs: integer('last_used_at_ms'),
  expiresAtMs: integer('expires_at_ms'),
  revokedAtMs: integer('revoked_at_ms'),
  createdAt: integer('created_at').notNull(),
});

/** Durable side-effect queue (submission emails, future webhooks). */
export const outbox = sqliteTable('outbox', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  action: text('action').notNull(),
  subjectUid: text('subject_uid'),
  accountId: text('account_id'),
  webhookId: text('webhook_id'),
  payload: text('payload'),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  nextAttemptAt: integer('next_attempt_at').notNull(),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  // Worker claim/lease (H2): set atomically when a row is claimed for delivery.
  claimedAt: integer('claimed_at'),
  claimedBy: text('claimed_by'),
  // The delivery transcript — what we actually sent and what came back. NULL
  // for every row written before this shipped, and for kinds whose adapter does
  // not report one. See `schema.pg.ts` for the full rationale.
  requestBody: text('request_body'),
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
});

/** Per-account (and per-form override) notification controls. */
export const notificationSetting = sqliteTable(
  'notification_setting',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    emailKey: text('email_key').notNull(),
    /** NULL = the account-level row; a form id = a per-form override row. */
    formId: text('form_id'),
    enabled: integer('enabled').notNull().default(1),
    subject: text('subject'),
    body: text('body'),
    reminderLeadMinutes: text('reminder_lead_minutes'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    // Scope-split uniqueness (0001 + 0005): one account row and one per-form row
    // per (account, email_key) — partial indexes so the scopes never collide.
    notificationSettingAccountKeyUq: uniqueIndex('notification_setting_account_key_uq')
      .on(t.accountId, t.emailKey)
      .where(sql`${t.formId} IS NULL`),
    notificationSettingAccountFormKeyUq: uniqueIndex('notification_setting_account_form_key_uq')
      .on(t.accountId, t.formId, t.emailKey)
      .where(sql`${t.formId} IS NOT NULL`),
    notificationSettingFormIdx: index('notification_setting_form_idx')
      .on(t.formId)
      .where(sql`${t.formId} IS NOT NULL`),
  }),
);

// --- Forms domain ------------------------------------------------------------

/** A form: one versioned JSON `config` blob drives the whole public flow. */
export const form = sqliteTable(
  'form',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    name: text('name').notNull(),
    /** Unique per account (app-enforced + composite UNIQUE index). */
    slug: text('slug').notNull(),
    /** Versioned form config as TEXT JSON. */
    config: text('config').notNull(),
    /** Unpublished working copy (TEXT JSON); NULL when no draft is pending. */
    draftConfig: text('draft_config'),
    /** Epoch-ms of the last publish; NULL = never published via the draft flow. */
    publishedAt: integer('published_at'),
    /** The form's `branding` (live + draft, TEXT JSON) before the last brand-kit apply; NULL = nothing to revert. */
    brandBackup: text('brand_backup'),
    /** Epoch-ms of the last brand-kit apply; NULL when never applied or reverted. */
    brandAppliedAt: integer('brand_applied_at'),
    /** member.id of the author; NULL for pre-0010 forms and API-key creates. Authorship, never authorization. */
    createdBy: text('created_by'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    formAccountSlugUq: uniqueIndex('form_account_slug_uq').on(t.accountId, t.slug),
  }),
);

/**
 * Slugs a form used to answer to (see 0017) — the ledger that keeps every
 * already-published link resolving after its form's public URL is renamed.
 * Keyed by (account_id, alias) because a form slug is unique per account, not
 * globally like `account_alias`.
 */
export const formAlias = sqliteTable(
  'form_alias',
  {
    accountId: text('account_id').notNull(),
    alias: text('alias').notNull(),
    formId: text('form_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.accountId, t.alias] }),
    formAliasFormIdx: index('form_alias_form_idx').on(t.formId),
  }),
);

/**
 * Workspace brand kit — one row per account. `config` (TEXT JSON) is the brand
 * kit blob (validated by `brandKitSchema` in @quill/types). Forms snapshot it at
 * creation / on explicit apply; the public renderer never reads this table.
 */
export const accountBranding = sqliteTable('account_branding', {
  accountId: text('account_id').primaryKey(),
  config: text('config').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** One persisted submission (partial or complete) per session. */
export const submission = sqliteTable(
  'submission',
  {
    id: text('id').primaryKey(),
    formId: text('form_id').notNull(),
    sessionId: text('session_id').notNull(),
    /** Answers as TEXT JSON. */
    data: text('data').notNull(),
    score: integer('score').notNull().default(0),
    startedAt: integer('started_at').notNull(),
    completedAt: integer('completed_at'),
    partialAt: integer('partial_at'),
  },
  (t) => ({
    // One persisted submission per (form, session) — the upsert relies on this.
    submissionFormSessionUq: uniqueIndex('submission_form_session_uq').on(t.formId, t.sessionId),
    // Analytics windows completed submissions by completed_at.
    submissionFormCompletedIdx: index('submission_form_completed_idx').on(t.formId, t.completedAt),
  }),
);

/** Funnel telemetry — one row per tracked step in the public flow. */
export const formEvent = sqliteTable(
  'form_event',
  {
    id: text('id').primaryKey(),
    formId: text('form_id').notNull(),
    sessionId: text('session_id').notNull(),
    type: text('type').notNull(),
    stepIndex: integer('step_index'),
    /** The step's authored key (nullable — absent on rows recorded before this
     *  column existed). Lets the drop-off table attribute a view to the actual
     *  question shown instead of to whichever config step sits at `stepIndex`'s
     *  position, which shifts under show/hide/goto logic (V5-D3). */
    stepKey: text('step_key'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    // Funnel aggregates scan a form's events over a date window.
    formEventFormIdx: index('form_event_form_idx').on(t.formId, t.createdAt),
    // Per-session lookups: unique-session counts + the first `view` (open time).
    formEventSessionIdx: index('form_event_session_idx').on(t.formId, t.sessionId, t.type),
  }),
);

/** One scheduling callback (HubSpot Meetings / Calendly) per booked meeting. */
export const bookingEvent = sqliteTable(
  'booking_event',
  {
    id: text('id').primaryKey(),
    formId: text('form_id').notNull(),
    sessionId: text('session_id').notNull(),
    provider: text('provider').notNull(),
    eventUri: text('event_uri'),
    inviteeUri: text('invitee_uri'),
    startTime: integer('start_time'),
    /** Raw callback payload as TEXT JSON. */
    payload: text('payload'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    bookingEventFormSessionIdx: index('booking_event_form_session_idx').on(t.formId, t.sessionId),
  }),
);

export const accountIntegration = sqliteTable(
  'account_integration',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    provider: text('provider').notNull(),
    encryptedToken: text('encrypted_token').notNull(),
    /** Display-only, non-secret hints as TEXT JSON (last4, connected label). */
    meta: text('meta'),
    connectedAt: integer('connected_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    accountIntegrationAccountProviderUq: uniqueIndex('account_integration_account_provider_uq').on(
      t.accountId,
      t.provider,
    ),
    accountIntegrationAccountIdx: index('account_integration_account_idx').on(t.accountId),
  }),
);

export const sqliteSchema = {
  account,
  accountAlias,
  member,
  apiKey,
  outbox,
  notificationSetting,
  form,
  formAlias,
  submission,
  formEvent,
  bookingEvent,
  accountIntegration,
};
