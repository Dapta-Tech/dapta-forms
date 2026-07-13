/**
 * The forms data layer — accounts (public-code lookup), forms CRUD (slug
 * generation + duplicate), submissions (one per session, partial→complete), and
 * funnel events. Same portable/Postgres-first shape as the rest of the platform
 * repository: everything goes through the `Db` port and portable `sql` templates,
 * so the identical code runs on SQLite (clone-and-run) and Postgres (prod).
 */
import { randomUUID } from 'node:crypto';
import { sql, type Db } from './client';
import { canonicalPublicCode } from './short-links';
import type { CrudResult } from './crud';

export type { CrudResult } from './crud';

// --- JSON column helpers (portable across jsonb / TEXT) ----------------------

/** Parse a JSON column value (string on SQLite, object on PG) with a fallback. */
export function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/** Serialize a value for a JSON column (both dialects accept a JSON string). */
export function jsonParam(value: unknown): string {
  return JSON.stringify(value ?? null);
}

// --- Accounts ----------------------------------------------------------------

export interface AccountRow {
  id: string;
  code: string;
  name: string;
  vanity_slug: string | null;
  external_id: string | null;
}

/**
 * Resolve an account by any public code: its canonical `code`, its `vanity_slug`,
 * or a retired `account_alias`. Callers 308-redirect alias hits to the canonical
 * code so no shared link ever breaks.
 */
export async function getAccountByCode(db: Db, code: string): Promise<AccountRow | undefined> {
  const direct = await db.get<AccountRow>(
    sql`SELECT id, code, name, vanity_slug, external_id FROM account
        WHERE code = ${code} OR vanity_slug = ${code} LIMIT 1`,
  );
  if (direct) return direct;
  const alias = await db.get<{ account_id: string }>(
    sql`SELECT account_id FROM account_alias WHERE alias = ${code} LIMIT 1`,
  );
  if (!alias) return undefined;
  return db.get<AccountRow>(
    sql`SELECT id, code, name, vanity_slug, external_id FROM account WHERE id = ${alias.account_id} LIMIT 1`,
  );
}

export interface MeView {
  accountId: string;
  accountCode: string;
  accountShortCode: string;
  vanitySlug: string | null;
  memberId: string;
  handle: string | null;
  displayName: string | null;
  email: string | null;
  role: string;
  status: string;
}

/** The authenticated host's identity for the dashboard header + settings. */
export async function getMe(db: Db, accountId: string, memberId: string): Promise<MeView | null> {
  const row = await db.get<{
    code: string;
    vanity_slug: string | null;
    handle: string | null;
    display_name: string | null;
    email: string | null;
    role: string;
    status: string;
  }>(
    sql`SELECT a.code, a.vanity_slug, m.handle, m.display_name, m.email, m.role, m.status
        FROM account a JOIN member m ON m.account_id = a.id
        WHERE a.id = ${accountId} AND m.id = ${memberId} LIMIT 1`,
  );
  if (!row) return null;
  return {
    accountId,
    accountCode: canonicalPublicCode({ code: row.code, vanity_slug: row.vanity_slug }),
    accountShortCode: row.code,
    vanitySlug: row.vanity_slug,
    memberId,
    handle: row.handle,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    status: row.status,
  };
}

// --- Forms -------------------------------------------------------------------

export interface FormRow {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  config: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface FormSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
}

function mapForm(r: Record<string, unknown>): FormRow {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    name: String(r.name),
    slug: String(r.slug),
    config: parseJsonColumn(r.config, { version: 1, steps: [] }),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** URL-safe slug from a form name. */
export function slugify(raw: string): string {
  return (
    raw
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'form'
  );
}

/** A slug unique within the account: `base`, then `base-2`, `base-3`… */
export async function uniqueFormSlug(db: Db, accountId: string, base: string): Promise<string> {
  const root = slugify(base);
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    const clash = await db.get<{ id: string }>(
      sql`SELECT id FROM form WHERE account_id = ${accountId} AND slug = ${candidate} LIMIT 1`,
    );
    if (!clash) return candidate;
  }
  return `${root}-${randomUUID().slice(0, 6)}`;
}

export async function listForms(db: Db, accountId: string): Promise<FormSummary[]> {
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT id, name, slug, created_at, updated_at FROM form
        WHERE account_id = ${accountId} ORDER BY updated_at DESC, created_at DESC`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));
}

export async function getFormById(db: Db, accountId: string, id: string): Promise<FormRow | null> {
  const r = await db.get<Record<string, unknown>>(
    sql`SELECT * FROM form WHERE account_id = ${accountId} AND id = ${id} LIMIT 1`,
  );
  return r ? mapForm(r) : null;
}

export async function createForm(
  db: Db,
  accountId: string,
  input: { name: string; slug?: string; config?: unknown },
): Promise<CrudResult<FormRow>> {
  const slug = await uniqueFormSlug(db, accountId, input.slug ?? input.name);
  const id = randomUUID();
  const now = Date.now();
  const config = input.config ?? { version: 1, steps: [] };
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
        VALUES (${id}, ${accountId}, ${input.name}, ${slug}, ${jsonParam(config)}, ${now}, ${now})`,
  );
  const created = await getFormById(db, accountId, id);
  return created ? { ok: true, value: created } : { ok: false, reason: 'CONFLICT' };
}

export async function updateForm(
  db: Db,
  accountId: string,
  id: string,
  patch: { name?: string; slug?: string; config?: unknown },
): Promise<CrudResult<FormRow>> {
  const existing = await getFormById(db, accountId, id);
  if (!existing) return { ok: false, reason: 'NOT_FOUND' };

  const sets = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.slug !== undefined) {
    const slug = slugify(patch.slug);
    const clash = await db.get<{ id: string }>(
      sql`SELECT id FROM form WHERE account_id = ${accountId} AND slug = ${slug} AND id <> ${id} LIMIT 1`,
    );
    if (clash) return { ok: false, reason: 'SLUG_TAKEN', message: 'That slug is already in use.' };
    sets.push(sql`slug = ${slug}`);
  }
  if (patch.config !== undefined) sets.push(sql`config = ${jsonParam(patch.config)}`);
  if (sets.length > 0) {
    sets.push(sql`updated_at = ${Date.now()}`);
    await db.run(
      sql`UPDATE form SET ${sql.join(sets, sql`, `)} WHERE account_id = ${accountId} AND id = ${id}`,
    );
  }
  return { ok: true, value: (await getFormById(db, accountId, id))! };
}

/**
 * Replace ONLY the `destinations` key of a form's config, merging against the
 * row's FRESH config in one server-side call — so the integrations screen never
 * clobbers steps/cover/scoring saved by a concurrent editor session (the web
 * tier no longer does its own read-then-write across two requests).
 *
 * NOTE (optimistic locking): without a config version / compare-and-set, a
 * concurrent FULL-config save can still interleave between this read and write.
 * That general problem applies to every config writer and is out of scope here;
 * full config versioning is tracked separately.
 */
export async function updateFormDestinations(
  db: Db,
  accountId: string,
  id: string,
  destinations: unknown[],
): Promise<CrudResult<FormRow>> {
  const existing = await getFormById(db, accountId, id);
  if (!existing) return { ok: false, reason: 'NOT_FOUND' };
  const config = { ...(existing.config as Record<string, unknown>), destinations };
  await db.run(
    sql`UPDATE form SET config = ${jsonParam(config)}, updated_at = ${Date.now()}
        WHERE account_id = ${accountId} AND id = ${id}`,
  );
  return { ok: true, value: (await getFormById(db, accountId, id))! };
}

export async function duplicateForm(
  db: Db,
  accountId: string,
  id: string,
): Promise<CrudResult<FormRow>> {
  const src = await getFormById(db, accountId, id);
  if (!src) return { ok: false, reason: 'NOT_FOUND' };
  return createForm(db, accountId, {
    name: `${src.name} (copy)`,
    slug: src.slug,
    config: src.config,
  });
}

export async function deleteForm(db: Db, accountId: string, id: string): Promise<void> {
  // Cascade the form's submissions + events, then the form.
  await db.run(
    sql`DELETE FROM submission WHERE form_id IN (SELECT id FROM form WHERE account_id = ${accountId} AND id = ${id})`,
  );
  await db.run(
    sql`DELETE FROM form_event WHERE form_id IN (SELECT id FROM form WHERE account_id = ${accountId} AND id = ${id})`,
  );
  await db.run(sql`DELETE FROM form WHERE account_id = ${accountId} AND id = ${id}`);
}

/** The published form for a public code + slug (no account scope leaked). */
export async function getPublishedForm(
  db: Db,
  accountCode: string,
  slug: string,
): Promise<{ id: string; accountId: string; name: string; slug: string; config: unknown } | null> {
  const account = await getAccountByCode(db, accountCode);
  if (!account) return null;
  const r = await db.get<Record<string, unknown>>(
    sql`SELECT id, account_id, name, slug, config FROM form
        WHERE account_id = ${account.id} AND slug = ${slug} LIMIT 1`,
  );
  if (!r) return null;
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    name: String(r.name),
    slug: String(r.slug),
    config: parseJsonColumn(r.config, { version: 1, steps: [] }),
  };
}

// --- Submissions -------------------------------------------------------------

export interface SubmissionRow {
  id: string;
  formId: string;
  sessionId: string;
  data: unknown;
  score: number;
  startedAt: number;
  completedAt: number | null;
  partialAt: number | null;
}

function mapSubmission(r: Record<string, unknown>): SubmissionRow {
  return {
    id: String(r.id),
    formId: String(r.form_id),
    sessionId: String(r.session_id),
    data: parseJsonColumn(r.data, {}),
    score: Number(r.score),
    startedAt: Number(r.started_at),
    completedAt: r.completed_at == null ? null : Number(r.completed_at),
    partialAt: r.partial_at == null ? null : Number(r.partial_at),
  };
}

/**
 * Upsert THE submission for a session (one row per session). A partial save sets
 * `partial_at`; a final submit sets `completed_at`. Re-submitting the same
 * session updates the same row (idempotent per session) rather than duplicating.
 */
export async function upsertSubmission(
  db: Db,
  input: {
    formId: string;
    sessionId: string;
    data: unknown;
    score: number;
    partial?: boolean;
    now?: number;
  },
): Promise<SubmissionRow> {
  const now = input.now ?? Date.now();
  const existing = await db.get<{ id: string; started_at: number }>(
    sql`SELECT id, started_at FROM submission
        WHERE form_id = ${input.formId} AND session_id = ${input.sessionId} LIMIT 1`,
  );
  const completedAt = input.partial ? null : now;
  const partialAt = input.partial ? now : null;
  if (existing) {
    await db.run(
      sql`UPDATE submission
          SET data = ${jsonParam(input.data)}, score = ${input.score},
              completed_at = COALESCE(${completedAt}, completed_at),
              partial_at = COALESCE(${partialAt}, partial_at)
          WHERE id = ${existing.id}`,
    );
    return (await getSubmissionById(db, existing.id))!;
  }
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO submission (id, form_id, session_id, data, score, started_at, completed_at, partial_at)
        VALUES (${id}, ${input.formId}, ${input.sessionId}, ${jsonParam(input.data)}, ${input.score},
          ${now}, ${completedAt}, ${partialAt})`,
  );
  return (await getSubmissionById(db, id))!;
}

export async function getSubmissionById(db: Db, id: string): Promise<SubmissionRow | null> {
  const r = await db.get<Record<string, unknown>>(sql`SELECT * FROM submission WHERE id = ${id} LIMIT 1`);
  return r ? mapSubmission(r) : null;
}

export async function listSubmissions(
  db: Db,
  formId: string,
  limit = 200,
): Promise<SubmissionRow[]> {
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT * FROM submission WHERE form_id = ${formId}
        ORDER BY started_at DESC LIMIT ${limit}`,
  );
  return rows.map(mapSubmission);
}

// --- Funnel events -----------------------------------------------------------

export async function recordFormEvent(
  db: Db,
  input: { formId: string; sessionId: string; type: string; stepIndex?: number | null; now?: number },
): Promise<void> {
  await db.run(
    sql`INSERT INTO form_event (id, form_id, session_id, type, step_index, created_at)
        VALUES (${randomUUID()}, ${input.formId}, ${input.sessionId}, ${input.type},
          ${input.stepIndex ?? null}, ${input.now ?? Date.now()})`,
  );
}

// --- API keys (machine surface) ----------------------------------------------

export interface MachinePrincipal {
  accountId: string;
  scopes: string[];
  eventTypeIds: string[] | null;
}

/** Hash an API key the same way it was stored (SHA-256 hex). */
async function hashApiKey(key: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(key).digest('hex');
}

/** Validate a presented API key; returns the machine principal or null. */
export async function verifyApiKey(db: Db, key: string): Promise<MachinePrincipal | null> {
  if (!key) return null;
  const keyHash = await hashApiKey(key);
  const row = await db.get<{ account_id: string; scopes: string | null; revoked_at_ms: number | null; expires_at_ms: number | null }>(
    sql`SELECT account_id, scopes, revoked_at_ms, expires_at_ms FROM api_key WHERE key_hash = ${keyHash} LIMIT 1`,
  );
  if (!row) return null;
  if (row.revoked_at_ms) return null;
  if (row.expires_at_ms && Number(row.expires_at_ms) < Date.now()) return null;
  await db.run(sql`UPDATE api_key SET last_used_at_ms = ${Date.now()} WHERE key_hash = ${keyHash}`);
  return {
    accountId: row.account_id,
    scopes: parseJsonColumn<string[]>(row.scopes, []),
    eventTypeIds: null,
  };
}
