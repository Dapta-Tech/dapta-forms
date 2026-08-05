/**
 * ACCOUNT MILESTONES — "is this the first time X ever happened for this
 * account?"
 *
 * Product-analytics funnels count PEOPLE reaching a stage, not actions. An
 * account that publishes six forms published once; an account whose form is
 * answered a thousand times activated once. Without these guards every repeat
 * is counted as a fresh conversion and the funnel inflates itself — the more a
 * happy customer uses the product, the better the funnel looks, which is the
 * exact opposite of what it should measure.
 *
 * These read the durable tables rather than any analytics-side state, so the
 * answer survives a vendor outage, a dropped event, and a replayed outbox row.
 */
import { sql } from 'drizzle-orm';
import type { Db } from './client';

/**
 * True when `submissionId` is the FIRST completed submission across every form
 * this account owns — the activation moment.
 *
 * Excludes the submission itself so it can be called after the row is written
 * (which it must be: activation is only real once the answer is durable).
 * Partials never count — `completed_at IS NULL` is someone who started and left.
 */
export async function isFirstAccountCompletion(
  db: Db,
  accountId: string,
  submissionId: string,
): Promise<boolean> {
  const earlier = await db.get<{ one: number }>(
    sql`SELECT 1 AS one
        FROM submission s JOIN form f ON f.id = s.form_id
        WHERE f.account_id = ${accountId}
          AND s.completed_at IS NOT NULL
          AND s.id <> ${submissionId}
        LIMIT 1`,
  );
  return !earlier;
}

/**
 * True when this account has never had a form VIEWED before — its first taste
 * of real traffic.
 *
 * Two-step on purpose. The per-form check runs first because it is served by
 * `form_event_form_idx (form_id, created_at)` and answers the overwhelmingly
 * common case — a form that already has views — without touching the join. Only
 * a form receiving its very first view pays for the account-wide scan, which
 * happens at most once per form, ever.
 *
 * Call BEFORE inserting the view being recorded, or it will find itself.
 */
export async function isFirstAccountFormView(
  db: Db,
  accountId: string,
  formId: string,
): Promise<boolean> {
  const onThisForm = await db.get<{ one: number }>(
    sql`SELECT 1 AS one FROM form_event
        WHERE form_id = ${formId} AND type = 'view' LIMIT 1`,
  );
  if (onThisForm) return false;

  const onAnyForm = await db.get<{ one: number }>(
    sql`SELECT 1 AS one
        FROM form_event e JOIN form f ON f.id = e.form_id
        WHERE f.account_id = ${accountId} AND e.type = 'view'
        LIMIT 1`,
  );
  return !onAnyForm;
}

/**
 * The account's owner — who a workspace-level milestone is ABOUT.
 *
 * Needed because activation happens on the public submission path, where the
 * only person present is the respondent (who is not a user of this product and
 * must never be captured). The owner is the stable stand-in for the workspace:
 * `owner` is the account's first member and the role cannot be handed out, only
 * transferred, so there is exactly one at a time.
 *
 * Oldest-first so a transferred ownership still resolves deterministically, and
 * active-only so a deactivated owner does not anchor new events.
 */
export async function getAccountOwner(
  db: Db,
  accountId: string,
): Promise<{ id: string; email: string | null } | null> {
  const row = await db.get<{ id: string; email: string | null }>(
    sql`SELECT id, email FROM member
        WHERE account_id = ${accountId} AND role = 'owner' AND status = 'active'
        ORDER BY created_at ASC LIMIT 1`,
  );
  return row ?? null;
}

/**
 * Record that a member was seen, at most once per `throttleMs`.
 *
 * `last_seen_at` is what turns "N members exist" into "N exist, M came back",
 * but the honest trigger for it — every authenticated request — would mean a
 * row UPDATE on `member` on every single API call. The throttle keeps the
 * signal (day-level activity is all anyone asks of it) while making the write
 * rare: at a 15-minute window an active session writes ~4 times an hour instead
 * of hundreds.
 *
 * The window is enforced in the WHERE clause, not read-then-write, so
 * concurrent requests cannot both decide they are the one to write.
 *
 * Reading this column back: it is a BIGINT, which node-postgres returns as a
 * STRING while SQLite returns a number. Coerce with `Number()` at every read
 * site, or a Postgres deployment silently compares timestamps as text.
 */
export async function touchMemberLastSeen(
  db: Db,
  memberId: string,
  now: number = Date.now(),
  throttleMs: number = 15 * 60_000,
): Promise<void> {
  await db.run(
    sql`UPDATE member SET last_seen_at = ${now}
        WHERE id = ${memberId}
          AND (last_seen_at IS NULL OR last_seen_at < ${now - throttleMs})`,
  );
}
