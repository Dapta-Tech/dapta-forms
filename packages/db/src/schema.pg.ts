/**
 * Postgres schema — the SOURCE OF TRUTH for the data model. SQLite
 * (schema.sqlite.ts) is a portable subset that tracks this 1:1 on table/column
 * names so the repository stays dialect-agnostic. Postgres uses `jsonb` for the
 * config/answers blobs and `bigint` epoch-ms instants; production runs here.
 */
import { pgTable, text, bigint, integer, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';

// --- Platform (identity / delivery) — kept from the shared platform ----------

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  externalId: text('external_id').unique(),
  vanitySlug: text('vanity_slug').unique(),
  daptaEntitlement: text('dapta_entitlement'),
  entitlementCheckedAt: bigint('entitlement_checked_at', { mode: 'number' }),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const accountAlias = pgTable('account_alias', {
  alias: text('alias').primaryKey(),
  accountId: text('account_id').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const member = pgTable(
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
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    memberAccountExternalUq: uniqueIndex('member_account_external_uq').on(t.accountId, t.externalId),
  }),
);

export const apiKey = pgTable('api_key', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull().unique(),
  last4: text('last4').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  scopes: text('scopes'),
  lastUsedAtMs: bigint('last_used_at_ms', { mode: 'number' }),
  expiresAtMs: bigint('expires_at_ms', { mode: 'number' }),
  revokedAtMs: bigint('revoked_at_ms', { mode: 'number' }),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const outbox = pgTable('outbox', {
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
  nextAttemptAt: bigint('next_attempt_at', { mode: 'number' }).notNull(),
  lastError: text('last_error'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  // Worker claim/lease (H2): set atomically when a row is claimed for delivery.
  claimedAt: bigint('claimed_at', { mode: 'number' }),
  claimedBy: text('claimed_by'),
});

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

// --- Forms domain ------------------------------------------------------------

export const form = pgTable(
  'form',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    config: jsonb('config').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    formAccountSlugUq: uniqueIndex('form_account_slug_uq').on(t.accountId, t.slug),
  }),
);

export const submission = pgTable(
  'submission',
  {
    id: text('id').primaryKey(),
    formId: text('form_id').notNull(),
    sessionId: text('session_id').notNull(),
    data: jsonb('data').notNull(),
    score: integer('score').notNull().default(0),
    startedAt: bigint('started_at', { mode: 'number' }).notNull(),
    completedAt: bigint('completed_at', { mode: 'number' }),
    partialAt: bigint('partial_at', { mode: 'number' }),
  },
  (t) => ({
    // One persisted submission per (form, session) — the upsert relies on this.
    submissionFormSessionUq: uniqueIndex('submission_form_session_uq').on(t.formId, t.sessionId),
    // Analytics windows completed submissions by completed_at.
    submissionFormCompletedIdx: index('submission_form_completed_idx').on(t.formId, t.completedAt),
  }),
);

export const formEvent = pgTable(
  'form_event',
  {
    id: text('id').primaryKey(),
    formId: text('form_id').notNull(),
    sessionId: text('session_id').notNull(),
    type: text('type').notNull(),
    stepIndex: integer('step_index'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    // Funnel aggregates scan a form's events over a date window.
    formEventFormIdx: index('form_event_form_idx').on(t.formId, t.createdAt),
    // Per-session lookups: unique-session counts + the first `view` (open time).
    formEventSessionIdx: index('form_event_session_idx').on(t.formId, t.sessionId, t.type),
  }),
);

export const pgSchema = {
  account,
  accountAlias,
  member,
  apiKey,
  outbox,
  notificationSetting,
  form,
  submission,
  formEvent,
};
