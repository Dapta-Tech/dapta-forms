/**
 * The forms data layer — accounts (public-code lookup), forms CRUD (slug
 * generation + duplicate), submissions (one per session, partial→complete), and
 * funnel events. Same portable/Postgres-first shape as the rest of the platform
 * repository: everything goes through the `Db` port and portable `sql` templates,
 * so the identical code runs on SQLite (clone-and-run) and Postgres (prod).
 */
import { randomUUID } from 'node:crypto';
import { validateFormSlug } from '@quill/engine';
import { attributionSchema, mergeWebhookSecrets, type Attribution } from '@quill/types';
import { sql, type Db } from './client';
import { canonicalPublicCode } from './short-links';
import type { CrudResult } from './crud';

export type { CrudResult } from './crud';

/**
 * `publishForm`'s result. `published` is true ONLY on the call that actually
 * copied the draft over the live config — false on the no-op (no draft pending)
 * and false for the loser of two concurrent publishes. Callers that count
 * publishes as conversions must read this, never guess from the returned row.
 */
export type PublishResult =
  | { ok: true; value: FormRow; published: boolean }
  | Extract<CrudResult<FormRow>, { ok: false }>;

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
  /** The workspace's display name (renameable in Settings). */
  accountName: string;
  accountCode: string;
  accountShortCode: string;
  vanitySlug: string | null;
  memberId: string;
  handle: string | null;
  displayName: string | null;
  email: string | null;
  role: string;
  status: string;
  /**
   * Onboarding completion (0011): epoch-ms, or null when the wizard is still
   * owed. Read on EVERY dashboard request — the layout's redirect gate is the
   * one consumer — so it rides along on this query rather than costing a second
   * round trip per page load.
   */
  onboardingCompletedAt: number | null;
  /**
   * First-touch acquisition tags (0010), so the browser can attach them as
   * analytics GROUP properties. Without them every onboarding funnel is
   * un-sliceable by campaign, which is most of the reason to measure it.
   */
  attribution: Attribution | null;
  /** `'staff'` when the caller is in this workspace by access grant, not by membership (0016). */
  accessGrant: 'staff' | null;
  /**
   * The language this person chose for the admin, or null when they never did.
   *
   * Rides along on this query rather than costing its own round trip, for one
   * consumer: the login callback, which seeds the render-time cookie from it so
   * a choice made on one machine is not lost on the next. Pages do NOT read it
   * per request - they read the cookie (see apps/web/lib/locale.ts).
   */
  locale: 'en' | 'es' | null;
}

/** The authenticated host's identity for the dashboard header + settings. */
export async function getMe(db: Db, accountId: string, memberId: string): Promise<MeView | null> {
  const row = await db.get<{
    code: string;
    name: string;
    vanity_slug: string | null;
    handle: string | null;
    display_name: string | null;
    email: string | null;
    role: string;
    status: string;
    onboarding_completed_at: number | null;
    attribution: unknown;
    access_grant: string | null;
    locale: string | null;
  }>(
    sql`SELECT a.code, a.name, a.vanity_slug, a.onboarding_completed_at, a.attribution,
               m.handle, m.display_name, m.email, m.role, m.status, m.access_grant, m.locale
        FROM account a JOIN member m ON m.account_id = a.id
        WHERE a.id = ${accountId} AND m.id = ${memberId} LIMIT 1`,
  );
  if (!row) return null;
  return {
    accountId,
    accountName: row.name,
    accountCode: canonicalPublicCode({ code: row.code, vanity_slug: row.vanity_slug }),
    accountShortCode: row.code,
    vanitySlug: row.vanity_slug,
    memberId,
    handle: row.handle,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    status: row.status,
    // BIGINT — node-postgres returns it as a STRING, SQLite as a number. Coerce
    // here or `/v1/me` ships a string behind a `number | null` contract.
    onboardingCompletedAt:
      row.onboarding_completed_at == null ? null : Number(row.onboarding_completed_at),
    // `safeParse`, not a cast: this column predates several shapes of writer and
    // a stale blob must not throw inside the request that renders every
    // dashboard page. Unreadable tags degrade to "not known", never to a 500.
    attribution: parseAttributionColumn(row.attribution),
    accessGrant: row.access_grant === 'staff' ? 'staff' : null,
    // Narrowed here, not trusted: the column is plain text and predates this
    // field, so an unrecognised value reads as "never chose" instead of
    // reaching a catalog that has no such locale.
    locale: row.locale === 'en' || row.locale === 'es' ? row.locale : null,
  };
}

/** Read `account.attribution` defensively — an unparseable blob reads as absent. */
function parseAttributionColumn(raw: unknown): Attribution | null {
  if (raw == null) return null;
  const parsed = attributionSchema.safeParse(parseJsonColumn(raw, null));
  return parsed.success ? parsed.data : null;
}

// --- Forms -------------------------------------------------------------------

export interface FormRow {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  config: unknown;
  /** Unpublished working copy of the config; null when no draft is pending. */
  draftConfig: unknown | null;
  /** Epoch-ms of the last publish; null = never published via the draft flow. */
  publishedAt: number | null;
  /** Epoch-ms of the last brand-kit apply; null when never applied or reverted. */
  brandAppliedAt: number | null;
  /**
   * `member.id` of the author; null for forms created before 0010 and for any
   * path with no member principal. AUTHORSHIP ONLY — access is decided by
   * `accountId`, never by this.
   */
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FormSummary {
  id: string;
  name: string;
  slug: string;
  /** Epoch-ms of the last brand-kit apply; null when never applied or reverted. */
  brandAppliedAt: number | null;
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
    draftConfig: r.draft_config == null ? null : parseJsonColumn(r.draft_config, null),
    publishedAt: r.published_at == null ? null : Number(r.published_at),
    brandAppliedAt: r.brand_applied_at == null ? null : Number(r.brand_applied_at),
    createdBy: r.created_by == null ? null : String(r.created_by),
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

/**
 * A slug unique within the account: `base`, then `base-2`, `base-3`…
 *
 * "Unique" means free of BOTH live slugs and retired ones (`form_alias`). A
 * retired slug still answers requests, so handing it to a new form would make
 * the direct match win and silently redirect every already-published link for
 * the form that retired it onto a stranger's form. Skipping the candidate costs
 * a suffix; not skipping it costs someone else's traffic.
 */
export async function uniqueFormSlug(db: Db, accountId: string, base: string): Promise<string> {
  const root = slugify(base);
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    if (!(await formSlugInUse(db, accountId, candidate))) return candidate;
  }
  // 1000 collisions on one root. Unreachable in practice, but the fallback is
  // the one candidate that would otherwise skip the check above, so it gets a
  // fresh suffix until it clears rather than being trusted blind.
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `${root}-${randomUUID().slice(0, 6)}`;
    if (!(await formSlugInUse(db, accountId, candidate))) return candidate;
  }
  return `${root}-${randomUUID()}`;
}

/**
 * Is `slug` spoken for inside this account, as a live slug or a retired alias?
 * `excludeFormId` lets a form re-claim one of its OWN old slugs (and ignore its
 * own current one) without reporting a clash against itself.
 */
export async function formSlugInUse(
  db: Db,
  accountId: string,
  slug: string,
  excludeFormId?: string,
): Promise<boolean> {
  const live = await db.get<{ id: string }>(
    sql`SELECT id FROM form WHERE account_id = ${accountId} AND slug = ${slug} LIMIT 1`,
  );
  if (live) return String(live.id) !== excludeFormId;
  const retired = await db.get<{ form_id: string }>(
    sql`SELECT form_id FROM form_alias WHERE account_id = ${accountId} AND alias = ${slug} LIMIT 1`,
  );
  if (retired) return String(retired.form_id) !== excludeFormId;
  return false;
}

const FORM_SLUG_INSERT_ATTEMPTS = 3;
const SQLITE_FORM_SLUG_UNIQUE_MESSAGE = 'UNIQUE constraint failed: form.account_id, form.slug';

type DatabaseError = {
  code?: unknown;
  constraint?: unknown;
  constraint_name?: unknown;
  message?: unknown;
  cause?: unknown;
  driverError?: unknown;
};

function asDatabaseError(error: unknown): DatabaseError | undefined {
  return error && typeof error === 'object' ? (error as DatabaseError) : undefined;
}

/** True only for the account-scoped `form(account_id, slug)` unique index. */
function isFormAccountSlugUniqueViolation(error: unknown): boolean {
  const candidate = asDatabaseError(error);
  if (!candidate) return false;

  if (
    candidate.code === '23505' &&
    (candidate.constraint === 'form_account_slug_uq' || candidate.constraint_name === 'form_account_slug_uq')
  ) {
    return true;
  }

  return (
    candidate.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    typeof candidate.message === 'string' &&
    candidate.message.includes(SQLITE_FORM_SLUG_UNIQUE_MESSAGE)
  );
}

/** Drizzle wraps driver errors; inspect the immediate driver shape without widening retries. */
function isFormAccountSlugConflict(error: unknown): boolean {
  const wrapped = asDatabaseError(error);
  return (
    isFormAccountSlugUniqueViolation(error) ||
    isFormAccountSlugUniqueViolation(wrapped?.cause) ||
    isFormAccountSlugUniqueViolation(wrapped?.driverError)
  );
}

export async function listForms(db: Db, accountId: string): Promise<FormSummary[]> {
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT id, name, slug, brand_applied_at, created_at, updated_at FROM form
        WHERE account_id = ${accountId} ORDER BY updated_at DESC, created_at DESC`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    brandAppliedAt: r.brand_applied_at == null ? null : Number(r.brand_applied_at),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));
}

/** One webhook destination, located in the form that owns it. */
export interface AccountWebhook {
  formId: string;
  formName: string;
  /** The destination's stable id; null on configs written before ids existed. */
  webhookId: string | null;
  url: string;
  enabled: boolean;
  /** Stored verbatim. Null when absent or empty — the back-compat "both phases". */
  events: string[] | null;
  /** Whether a signing secret is configured. The secret itself is never read out. */
  hasSecret: boolean;
}

/**
 * Every webhook destination in an account, as an inventory rather than as config.
 *
 * Destinations live inside each form's config JSON, so "which of my forms POST
 * somewhere, and where?" was a question only answerable by opening every form one
 * at a time. This answers it in one query, and returns a PROJECTION rather than
 * the configs themselves: the account page needs a URL and two booleans, not
 * every step, rule and field map of every form.
 *
 * One entry per webhook, not per form. Several webhooks on one form is a legal
 * configuration (only HubSpot is capped at one), so collapsing them here would
 * make the inventory disagree with what is actually stored.
 *
 * **The secret never leaves this function.** It is read only inside the
 * expression that decides `hasSecret`, and `AccountWebhook` has no field it could
 * occupy — so unlike the form-returning endpoints there is no masking step that
 * could be forgotten, and `WEBHOOK_SECRET_MASK` never appears either.
 */
export async function listAccountWebhooks(db: Db, accountId: string): Promise<AccountWebhook[]> {
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT id, name, config FROM form
        WHERE account_id = ${accountId} ORDER BY updated_at DESC, created_at DESC`,
  );

  const out: AccountWebhook[] = [];
  for (const r of rows) {
    const config = parseJsonColumn<{ destinations?: unknown }>(r.config, {});
    const destinations = Array.isArray(config.destinations) ? config.destinations : [];
    for (const entry of destinations) {
      // Duck-typed on purpose, the same way the delivery path and the masker read
      // this array. Parsing with `webhookDestinationSchema` would drop a stored
      // webhook whose URL fails the https refinement — which is precisely the
      // misconfiguration an inventory exists to reveal, not to hide.
      if (!entry || typeof entry !== 'object') continue;
      const d = entry as {
        type?: unknown;
        id?: unknown;
        enabled?: unknown;
        events?: unknown;
        settings?: { url?: unknown; secret?: unknown };
      };
      if (d.type !== 'webhook') continue;
      const url = d.settings?.url;
      if (typeof url !== 'string' || url === '') continue;

      const events = Array.isArray(d.events)
        ? d.events.filter((e): e is string => typeof e === 'string')
        : [];
      const secret = d.settings?.secret;

      out.push({
        formId: String(r.id),
        formName: String(r.name),
        webhookId: typeof d.id === 'string' ? d.id : null,
        url,
        // `enabled` defaults to false in the schema, so an absent value is off.
        enabled: d.enabled === true,
        events: events.length ? events : null,
        hasSecret: typeof secret === 'string' && secret.length > 0,
      });
    }
  }
  return out;
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
  /**
   * `member.id` of the author, for per-user analytics (migration 0010).
   * MUST come from the resolved principal, never from request input — this is
   * authorship, and a caller-supplied value would let anyone forge it. Omitted
   * on the paths with no member principal (API key, seeding), leaving it NULL.
   */
  createdBy?: string | null,
): Promise<CrudResult<FormRow>> {
  const config = input.config ?? { version: 1, steps: [] };

  for (let attempt = 0; attempt < FORM_SLUG_INSERT_ATTEMPTS; attempt++) {
    const slug = await uniqueFormSlug(db, accountId, input.slug ?? input.name);
    const id = randomUUID();
    const now = Date.now();
    try {
      await db.run(
        sql`INSERT INTO form (id, account_id, name, slug, config, created_by, created_at, updated_at)
            VALUES (${id}, ${accountId}, ${input.name}, ${slug}, ${jsonParam(config)},
                    ${createdBy ?? null}, ${now}, ${now})`,
      );
    } catch (error) {
      if (attempt + 1 < FORM_SLUG_INSERT_ATTEMPTS && isFormAccountSlugConflict(error)) continue;
      throw error;
    }

    const created = await getFormById(db, accountId, id);
    return created ? { ok: true, value: created } : { ok: false, reason: 'CONFLICT' };
  }

  throw new Error('unreachable: form slug insert retries must return or rethrow');
}

/**
 * Patch a form's name and/or config.
 *
 * `slug` is deliberately NOT here. It used to be, as a plain UPDATE that
 * checked for a clash and overwrote the column, which is exactly the wrong
 * shape for a value that is a public URL: it dropped the previous slug on the
 * floor and broke every link already published for the form. Renaming a slug is
 * `setFormSlug`, which retires the old value into `form_alias` instead. One
 * implementation, so no caller can pick the lossy one by accident.
 */
export async function updateForm(
  db: Db,
  accountId: string,
  id: string,
  patch: { name?: string; config?: unknown },
): Promise<CrudResult<FormRow>> {
  const existing = await getFormById(db, accountId, id);
  if (!existing) return { ok: false, reason: 'NOT_FOUND' };

  const sets = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.config !== undefined) {
    // Preserve masked webhook secrets: a full-config write that round-trips the
    // READ-masked config (WEBHOOK_SECRET_MASK) must not clobber the stored
    // secret with the sentinel. Real secrets pass through unchanged.
    let nextConfig = patch.config;
    if (
      nextConfig &&
      typeof nextConfig === 'object' &&
      Array.isArray((nextConfig as Record<string, unknown>).destinations)
    ) {
      const cfg = nextConfig as Record<string, unknown>;
      nextConfig = {
        ...cfg,
        destinations: mergeWebhookSecrets(
          cfg.destinations as unknown[],
          (existing.config as Record<string, unknown> | null)?.destinations,
        ),
      };
    }
    sets.push(sql`config = ${jsonParam(nextConfig)}`);
  }
  if (sets.length > 0) {
    sets.push(sql`updated_at = ${Date.now()}`);
    await db.run(
      sql`UPDATE form SET ${sql.join(sets, sql`, `)} WHERE account_id = ${accountId} AND id = ${id}`,
    );
  }
  return { ok: true, value: (await getFormById(db, accountId, id))! };
}

// --- Form slug (the public URL's third segment) ------------------------------

/**
 * Record a slug this form used to answer to. Idempotent: the composite primary
 * key (account_id, alias) makes a repeat a no-op rather than an error, which is
 * what a re-rename back and forth produces.
 */
async function addFormAlias(
  db: Db,
  accountId: string,
  formId: string,
  alias: string,
): Promise<void> {
  try {
    await db.run(
      sql`INSERT INTO form_alias (account_id, alias, form_id, created_at)
          VALUES (${accountId}, ${alias}, ${formId}, ${Date.now()})`,
    );
  } catch {
    // Already recorded (PK). Idempotent no-op, same as `addAccountAlias`.
  }
}

/**
 * Follow a renamed slug into every member's public-page selection.
 *
 * BEST EFFORT, and the distinction matters. A member profile records its form
 * selection BY SLUG (`profile.formSlugs`, see 0008), so a rename leaves those
 * entries naming a slug no form currently has. What keeps the form ON the page
 * is the READ path: `publicProfile` matches a selection against each form's
 * retired slugs as well as its live one. That is the correctness fix, it needs
 * no write, and it heals profiles saved before this shipped.
 *
 * This function exists only so the public-page EDITOR shows a checked box
 * rather than an entry it no longer recognizes. It is a read-modify-write on a
 * JSON blob with no compare-and-set, so a concurrent profile save can lose it
 * (the same shape as `attachOnboardingForm`). Losing it costs a stale checkbox
 * until the author saves that screen again, never a form vanishing from a page,
 * which is why it is allowed to be lossy and why the read path must never
 * depend on it having run.
 */
async function renameSlugInMemberProfiles(
  db: Db,
  accountId: string,
  from: string,
  to: string,
): Promise<void> {
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT id, profile FROM member WHERE account_id = ${accountId} AND profile IS NOT NULL`,
  );
  for (const row of rows) {
    const profile = parseJsonColumn<Record<string, unknown> | null>(row.profile, null);
    if (!profile || typeof profile !== 'object') continue;
    const slugs = profile.formSlugs;
    if (!Array.isArray(slugs) || !slugs.includes(from)) continue;
    // Dedupe: a selection holding BOTH the old and the new slug (possible after
    // a rename round-trip) must not end up listing the same form twice.
    const next = [...new Set(slugs.map((s) => (s === from ? to : s)))];
    await db.run(
      sql`UPDATE member SET profile = ${JSON.stringify({ ...profile, formSlugs: next })}
          WHERE id = ${row.id} AND account_id = ${accountId}`,
    );
  }
}

/**
 * Rename a form's public URL, keeping every link ever published for it alive.
 *
 * Separate from `updateForm` on purpose. That one is the builder's AUTOSAVE,
 * fired on a debounce as the author types, and rotating a public URL from a
 * keystroke is not a thing anyone asks for: a typo in the form's name would
 * retire a slug that is printed on a QR code. Renaming a URL is an explicit,
 * confirmed act, so it gets an explicit call.
 *
 * Order matters. The UPDATE lands first, so a lost uniqueness race leaves the
 * ledger untouched; only once the new slug is really ours does the old one get
 * retired and the reclaimed alias dropped.
 */
export async function setFormSlug(
  db: Db,
  accountId: string,
  id: string,
  requested: string,
): Promise<CrudResult<FormRow>> {
  const existing = await getFormById(db, accountId, id);
  if (!existing) return { ok: false, reason: 'NOT_FOUND' };

  const slug = requested.trim().toLowerCase();
  if (validateFormSlug(slug)) {
    return { ok: false, reason: 'SLUG_INVALID', message: 'That link is not a valid slug.' };
  }
  // A no-op rename is a success, not a clash against itself.
  if (slug === existing.slug) return { ok: true, value: existing };

  if (await formSlugInUse(db, accountId, slug, id)) {
    return { ok: false, reason: 'SLUG_TAKEN', message: 'That slug is already in use.' };
  }

  // RETIRE FIRST, then move. The order is the whole safety argument, and the
  // obvious order is the wrong one.
  //
  // Retiring after a successful UPDATE leaves a window in which the old slug is
  // held by nobody: gone from `form`, not yet in `form_alias`. A second rename
  // arriving inside that window asks `formSlugInUse` about it, is told it is
  // free, and takes it. Both writes succeed, the unique index sees no conflict,
  // and the account ends up with one form LIVE on the slug and the alias
  // pointing at a different one. A direct match beats an alias, so every link
  // ever published for the first form now serves the second one, permanently
  // and silently. The same window loses the slug outright if the process dies
  // inside it, which is the one promise this feature makes.
  //
  // Retiring first closes it: the slug is continuously either live on this form
  // or retired to it, so a concurrent claim is refused at every instant. If the
  // UPDATE then fails, the leftover alias row names the form that still holds
  // the slug live, where the direct match wins and the row is never consulted.
  // Untidy, never wrong. `setVanitySlug` orders itself the same way for the
  // same reason, and like it, this runs without a transaction: the portable
  // `Db` port has no cross-dialect one, and every intermediate state this
  // ordering can leave behind is inert.
  await addFormAlias(db, accountId, id, existing.slug);
  // Re-claiming one of this form's own retired slugs: it is about to be
  // canonical again, so the alias row would be dead weight nothing consults.
  await db.run(
    sql`DELETE FROM form_alias
        WHERE account_id = ${accountId} AND alias = ${slug} AND form_id = ${id}`,
  );

  try {
    await db.run(
      sql`UPDATE form SET slug = ${slug}, updated_at = ${Date.now()}
          WHERE account_id = ${accountId} AND id = ${id}`,
    );
  } catch (error) {
    // A concurrent claim of the same slug lost the race to `form_account_slug_uq`.
    // The check above cannot see it; the index can. Same answer either way, never a 500.
    if (isFormAccountSlugConflict(error)) {
      return { ok: false, reason: 'SLUG_TAKEN', message: 'That slug is already in use.' };
    }
    throw error;
  }

  await renameSlugInMemberProfiles(db, accountId, existing.slug, slug);

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
  // Preserve masked webhook secrets: when the integrations UI leaves the secret
  // field untouched it submits WEBHOOK_SECRET_MASK; keep the stored secret.
  const merged = mergeWebhookSecrets(
    destinations,
    (existing.config as Record<string, unknown> | null)?.destinations,
  );
  const config = { ...(existing.config as Record<string, unknown>), destinations: merged };
  await db.run(
    sql`UPDATE form SET config = ${jsonParam(config)}, updated_at = ${Date.now()}
        WHERE account_id = ${accountId} AND id = ${id}`,
  );
  return { ok: true, value: (await getFormById(db, accountId, id))! };
}

/**
 * Store an UNPUBLISHED working copy of a form's config (`draft_config`). The
 * live `config` — what the public renderer serves — is untouched; `publishForm`
 * later copies the draft over it. Masked webhook secrets round-tripped by the
 * admin UI are restored from the stored draft (falling back to the live config),
 * mirroring `updateForm`.
 */
export async function saveDraftConfig(
  db: Db,
  accountId: string,
  id: string,
  config: unknown,
): Promise<CrudResult<FormRow>> {
  const existing = await getFormById(db, accountId, id);
  if (!existing) return { ok: false, reason: 'NOT_FOUND' };

  let nextConfig = config;
  if (nextConfig && typeof nextConfig === 'object') {
    const cfg = { ...(nextConfig as Record<string, unknown>) };
    // Destinations are managed LIVE by the integrations screen and are never
    // staged in a draft — otherwise a stale editor snapshot would silently
    // revert integrations edits when the draft is published.
    delete cfg.destinations;
    nextConfig = cfg;
  }
  await db.run(
    sql`UPDATE form SET draft_config = ${jsonParam(nextConfig)}, updated_at = ${Date.now()}
        WHERE account_id = ${accountId} AND id = ${id}`,
  );
  return { ok: true, value: (await getFormById(db, accountId, id))! };
}

/**
 * Publish a form's pending draft: copy `draft_config` into the live `config`,
 * stamp `published_at`, and clear the draft — one atomic UPDATE guarded by
 * `draft_config IS NOT NULL`, identical on both dialects. A form with NO
 * pending draft is a no-op (the current row is returned unchanged) so publish
 * is idempotent.
 */
export async function publishForm(
  db: Db,
  accountId: string,
  id: string,
): Promise<PublishResult> {
  const existing = await getFormById(db, accountId, id);
  if (!existing) return { ok: false, reason: 'NOT_FOUND' };
  // No draft pending — a successful no-op. `published: false` is what stops a
  // caller counting this as a conversion.
  if (existing.draftConfig == null) return { ok: true, value: existing, published: false };
  // Drafts never stage `destinations` (see saveDraftConfig) — integrations are
  // edited live. Carry the live set over the draft on publish so publishing
  // can never revert them; everything else comes from the draft.
  const draft = existing.draftConfig as Record<string, unknown>;
  const live = existing.config as Record<string, unknown> | null;
  const next: Record<string, unknown> = { ...draft };
  if (live && live.destinations !== undefined) next.destinations = live.destinations;
  else delete next.destinations;
  const now = Date.now();
  // RETURNING, so the caller LEARNS whether this call is the one that published
  // rather than inferring it. `draft_config IS NOT NULL` in the WHERE already
  // makes the write exactly-once; without a row back, two concurrent publishes
  // both look like "a draft was pending" to a caller that pre-read the row, and
  // a single publish gets counted twice. `published_at` cannot substitute for
  // this either — it is Date.now(), so two publishes in the same millisecond are
  // indistinguishable.
  const fired = await db.get<{ id: string }>(
    sql`UPDATE form
        SET config = ${jsonParam(next)}, draft_config = NULL,
            published_at = ${now}, updated_at = ${now}
        WHERE account_id = ${accountId} AND id = ${id} AND draft_config IS NOT NULL
        RETURNING id`,
  );
  return { ok: true, value: (await getFormById(db, accountId, id))!, published: Boolean(fired) };
}

export async function duplicateForm(
  db: Db,
  accountId: string,
  id: string,
  /** Author of the COPY — whoever duplicated it, not whoever wrote the original. */
  createdBy?: string | null,
): Promise<CrudResult<FormRow>> {
  const src = await getFormById(db, accountId, id);
  if (!src) return { ok: false, reason: 'NOT_FOUND' };
  return createForm(
    db,
    accountId,
    {
      name: `${src.name} (copy)`,
      slug: src.slug,
      config: src.config,
    },
    createdBy,
  );
}

export async function deleteForm(db: Db, accountId: string, id: string): Promise<void> {
  // Cascade the form's submissions + events + booking events, then the form.
  await db.run(
    sql`DELETE FROM submission WHERE form_id IN (SELECT id FROM form WHERE account_id = ${accountId} AND id = ${id})`,
  );
  await db.run(
    sql`DELETE FROM form_event WHERE form_id IN (SELECT id FROM form WHERE account_id = ${accountId} AND id = ${id})`,
  );
  await db.run(
    sql`DELETE FROM booking_event WHERE form_id IN (SELECT id FROM form WHERE account_id = ${accountId} AND id = ${id})`,
  );
  // Per-form notification template overrides (account-level rows have form_id NULL).
  await db.run(
    sql`DELETE FROM notification_setting WHERE account_id = ${accountId} AND form_id = ${id}`,
  );
  // Retired slugs die with the form they pointed at: leaving them would keep a
  // deleted form's URLs reserved forever, and `formSlugInUse` reads this table.
  await db.run(sql`DELETE FROM form_alias WHERE account_id = ${accountId} AND form_id = ${id}`);
  await db.run(sql`DELETE FROM form WHERE account_id = ${accountId} AND id = ${id}`);
}

/**
 * The published form for a public code + slug (no account scope leaked).
 *
 * Falls back to the alias ledger when nothing matches directly, so a slug the
 * form used to answer to still resolves: the QR code already printed, the
 * campaign link already sent, the iframe already pasted into someone else's
 * site. This ONE fallback covers every public entry point at once, because the
 * page, the OG image, submissions, funnel events and the booking callback all
 * arrive through here.
 *
 * The returned `slug` is always the CANONICAL one, never what was asked for.
 * That is what lets the public page notice it was reached through a retired
 * slug and send the visitor to the real URL instead of serving two addresses
 * forever. Next resolves that redirect on the client rather than as a redirect
 * STATUS, so the page also emits a canonical link tag; see the notes in
 * `apps/web/app/[accountCode]/[handle]/[slug]/page.tsx`.
 *
 * A direct hit wins over an alias, always. `uniqueFormSlug` / `setFormSlug`
 * refuse to hand one form a slug another form retired, so the two can only
 * collide for the SAME form (it re-claimed its own old slug), where the direct
 * row is the right answer anyway.
 */
export async function getPublishedForm(
  db: Db,
  accountCode: string,
  slug: string,
): Promise<{ id: string; accountId: string; name: string; slug: string; config: unknown } | null> {
  const account = await getAccountByCode(db, accountCode);
  if (!account) return null;
  let r = await db.get<Record<string, unknown>>(
    sql`SELECT id, account_id, name, slug, config FROM form
        WHERE account_id = ${account.id} AND slug = ${slug} LIMIT 1`,
  );
  if (!r) {
    const retired = await db.get<{ form_id: string }>(
      sql`SELECT form_id FROM form_alias
          WHERE account_id = ${account.id} AND alias = ${slug} LIMIT 1`,
    );
    if (!retired) return null;
    r = await db.get<Record<string, unknown>>(
      sql`SELECT id, account_id, name, slug, config FROM form
          WHERE account_id = ${account.id} AND id = ${retired.form_id} LIMIT 1`,
    );
  }
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
 *
 * `wasCompletedBefore` reports whether the row was ALREADY completed when this
 * write arrived. The row itself is safely idempotent; its downstream EFFECTS
 * (emails, CRM deliveries) are not — a client-side transport retry whose first
 * attempt actually landed re-runs the service, and only this flag lets it tell
 * a first completion (fire the effects) from a re-landed one (row refreshed,
 * effects already owed by the first landing).
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
): Promise<SubmissionRow & { wasCompletedBefore: boolean }> {
  const now = input.now ?? Date.now();
  const completedAt = input.partial ? null : now;
  const partialAt = input.partial ? now : null;

  type ExistingRow = { id: string; started_at: number; completed_at: number | null };
  const selectExisting = (): Promise<ExistingRow | null | undefined> =>
    db.get<ExistingRow>(
      sql`SELECT id, started_at, completed_at FROM submission
          WHERE form_id = ${input.formId} AND session_id = ${input.sessionId} LIMIT 1`,
    );

  const applyUpdate = async (existing: ExistingRow): Promise<SubmissionRow & { wasCompletedBefore: boolean }> => {
    const wasCompletedBefore = existing.completed_at != null;
    // Reorder guard: a fire-and-forget partial can land AFTER the complete
    // submit. Once a row is completed, only a complete submit may update it —
    // a late partial must NOT overwrite the finalized data/score.
    if (input.partial && wasCompletedBefore) {
      return { ...(await getSubmissionById(db, existing.id))!, wasCompletedBefore };
    }
    if (!input.partial && !wasCompletedBefore) {
      // The SELECT above routes partials and retries, but cannot decide a
      // completion claim: another finalization may commit after it read NULL.
      const completed = await db.get<Record<string, unknown>>(
        sql`UPDATE submission
            SET data = ${jsonParam(input.data)}, score = ${input.score}, completed_at = ${completedAt}
            WHERE id = ${existing.id} AND completed_at IS NULL
            RETURNING *`,
      );
      if (completed) return { ...mapSubmission(completed), wasCompletedBefore: false };
      return { ...(await getSubmissionById(db, existing.id))!, wasCompletedBefore: true };
    }
    await db.run(
      sql`UPDATE submission
          SET data = ${jsonParam(input.data)}, score = ${input.score},
              completed_at = COALESCE(${completedAt}, completed_at),
              partial_at = COALESCE(${partialAt}, partial_at)
          WHERE id = ${existing.id}`,
    );
    return { ...(await getSubmissionById(db, existing.id))!, wasCompletedBefore };
  };

  const existing = await selectExisting();
  if (existing) return applyUpdate(existing);

  // First write for this session — INSERT. Two concurrent first writes (a
  // fire-and-forget partial racing the complete submit, or a double-click) both
  // SELECT null and both INSERT; the second hits the submission_form_session_uq
  // unique index. Catch that and retry as an UPDATE so the loser resolves
  // cleanly instead of surfacing a raw 500 (M2). A non-uniqueness error rethrows.
  const id = randomUUID();
  try {
    await db.run(
      sql`INSERT INTO submission (id, form_id, session_id, data, score, started_at, completed_at, partial_at)
          VALUES (${id}, ${input.formId}, ${input.sessionId}, ${jsonParam(input.data)}, ${input.score},
            ${now}, ${completedAt}, ${partialAt})`,
    );
    return { ...(await getSubmissionById(db, id))!, wasCompletedBefore: false };
  } catch (err) {
    const raced = await selectExisting();
    if (raced) return applyUpdate(raced);
    throw err;
  }
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
        ORDER BY started_at DESC, id DESC LIMIT ${limit}`,
  );
  return rows.map(mapSubmission);
}

// --- Funnel events -----------------------------------------------------------

export async function recordFormEvent(
  db: Db,
  input: {
    formId: string;
    sessionId: string;
    type: string;
    stepIndex?: number | null;
    stepKey?: string | null;
    now?: number;
  },
): Promise<void> {
  await db.run(
    sql`INSERT INTO form_event (id, form_id, session_id, type, step_index, step_key, created_at)
        VALUES (${randomUUID()}, ${input.formId}, ${input.sessionId}, ${input.type},
          ${input.stepIndex ?? null}, ${input.stepKey ?? null}, ${input.now ?? Date.now()})`,
  );
}
