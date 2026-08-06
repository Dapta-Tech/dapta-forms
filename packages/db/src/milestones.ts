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
import { jsonParam } from './forms';

/**
 * Claim a write-once milestone on `account`, atomically.
 *
 * Returns true for EXACTLY ONE caller, ever — the one whose UPDATE found the
 * column still NULL. Everyone after gets false, including concurrent callers,
 * because the guard lives in the WHERE clause and the database serializes the
 * row write. `RETURNING id` is how the caller learns it won: `db.run` reports no
 * affected-row count on either dialect, so the claim has to hand back a row.
 *
 * This replaces the obvious "does an earlier one already exist?" query, which is
 * a read-then-act and fails BOTH ways — verified against the real service, not
 * reasoned about:
 *
 *   - Two answers committing at the same instant each SEE the other and both
 *     decline. The account now has completions forever, so every later check
 *     also declines: it can never activate. (Observed: 0 events.)
 *   - A re-submitted session upserts the SAME row, which the check excludes
 *     from itself, so the milestone fires again. (Observed: 2 events on a
 *     double-click.)
 *
 * A claim has neither failure mode and needs no exclusion, so it is also
 * idempotent against a replayed outbox row.
 */
async function claimAccountMilestone(
  db: Db,
  accountId: string,
  column: 'activated_at' | 'first_viewed_at',
  now: number,
): Promise<boolean> {
  // Interpolated, not parameterized: a column name cannot be a bind parameter,
  // and the value is a closed union chosen by this module — never user input.
  const col = sql.raw(column);
  const claimed = await db.get<{ id: string }>(
    sql`UPDATE account SET ${col} = ${now}
        WHERE id = ${accountId} AND ${col} IS NULL
        RETURNING id`,
  );
  return Boolean(claimed);
}

/**
 * Claim ACTIVATION for an account: its first completed submission ever.
 *
 * Call AFTER the submission row is durable — activation is only real once the
 * answer is stored — and only for a completed submission. A partial is someone
 * who started and left, which is not an answer.
 */
export function claimAccountActivation(
  db: Db,
  accountId: string,
  now: number = Date.now(),
): Promise<boolean> {
  return claimAccountMilestone(db, accountId, 'activated_at', now);
}

/**
 * Claim FIRST VIEW for an account: the first time any of its forms met a real
 * visitor. Same write-once discipline as activation — two people opening two
 * forms at the same instant produce one event, not two.
 */
export function claimAccountFirstView(
  db: Db,
  accountId: string,
  now: number = Date.now(),
): Promise<boolean> {
  return claimAccountMilestone(db, accountId, 'first_viewed_at', now);
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

/**
 * Claim FIRST-TOUCH ATTRIBUTION for an account: where it came from.
 *
 * Write-once for the same reason activation is, but the stakes are different:
 * a timestamp can be recomputed from the rows it summarizes, while acquisition
 * context exists only in the URL that brought the person here. Once that request
 * is over it is gone. So this claim is not an optimization — it is the only
 * chance to record the value at all.
 *
 * First touch, not last: overwriting on a later visit would credit whichever
 * link the customer happened to click most recently (usually a direct return
 * with no tags at all), which is how paid campaigns lose the signups they paid
 * for. Callers must pass `null`-free payloads — `parseAttribution` returns null
 * rather than `{}` precisely so an untagged direct visit cannot spend the claim.
 */
export async function claimAccountAttribution(
  db: Db,
  accountId: string,
  attribution: Record<string, string>,
): Promise<boolean> {
  // `jsonParam` is the repo's dialect-neutral JSON bind (jsonb on Postgres,
  // text on SQLite) — the same helper every other JSON column write uses.
  const claimed = await db.get<{ id: string }>(
    sql`UPDATE account SET attribution = ${jsonParam(attribution)}
        WHERE id = ${accountId} AND attribution IS NULL
        RETURNING id`,
  );
  return Boolean(claimed);
}
