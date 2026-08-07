/**
 * ONBOARDING — the first-run wizard's persistence.
 *
 * Two writes, and the difference between them is the whole design:
 *
 *   - `saveOnboardingProgress` runs on EVERY step advance. It is what makes an
 *     ABANDONED onboarding leave a trace. Storing only the finished result would
 *     mean the people who quit — the only ones a funnel is really about — write
 *     nothing at all, and "where do they quit" would be unanswerable from the
 *     database.
 *   - `claimOnboardingComplete` runs once, as a write-once CLAIM in the same
 *     sense as `claimAccountMilestone` (see milestones.ts): exactly one caller
 *     wins, so the first form is created once and the completion event fires
 *     once, even on a double-click or a replayed request.
 *
 * Both guard on `onboarding_completed_at IS NULL`. That guard is not decoration:
 * without it a PATCH arriving after completion — a stale tab, a retried request —
 * would rewrite the answers of a finished onboarding, and the record of what the
 * person actually chose would be lost.
 */
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { jsonParam, parseJsonColumn } from './forms';
import {
  accountOnboardingSchema,
  type AccountOnboarding,
  type FormTemplateId,
  type OnboardingProgressInput,
  type OnboardingStep,
} from '@quill/types';

/** `account.onboarding` + `account.onboarding_completed_at`, as the API reports them. */
export interface OnboardingState {
  /** The wizard's answers so far; null when it was never opened. */
  onboarding: AccountOnboarding | null;
  /** Epoch-ms of completion; null = still owed the wizard. */
  completedAt: number | null;
}

/** An empty, well-formed blob — the shape a first write starts from. */
function emptyOnboarding(now: number): AccountOnboarding {
  return { version: 1, stepsSeen: [], startedAt: now };
}

/**
 * Read the stored blob, defensively.
 *
 * `safeParse` rather than a cast: this column can hold a blob written by an
 * OLDER build of the product, and one unknown enum value must not throw inside
 * a dashboard request. A blob that does not parse is treated as absent — the
 * wizard restarts, which is recoverable; a 500 on every page load is not.
 */
function readOnboarding(raw: unknown): AccountOnboarding | null {
  if (raw == null) return null;
  const parsed = accountOnboardingSchema.safeParse(parseJsonColumn(raw, null));
  return parsed.success ? parsed.data : null;
}

/** Append `step` to the trail unless it is already there (back-navigation repeats). */
function withStepSeen(seen: readonly OnboardingStep[], step: OnboardingStep | null | undefined) {
  if (!step || seen.includes(step)) return [...seen];
  return [...seen, step];
}

/** The onboarding state for one account, or null when the account does not exist. */
export async function getAccountOnboarding(
  db: Db,
  accountId: string,
): Promise<OnboardingState | null> {
  const row = await db.get<{ onboarding: unknown; onboarding_completed_at: number | null }>(
    sql`SELECT onboarding, onboarding_completed_at FROM account WHERE id = ${accountId} LIMIT 1`,
  );
  if (!row) return null;
  return {
    onboarding: readOnboarding(row.onboarding),
    // BIGINT, which node-postgres returns as a STRING while SQLite returns a
    // number. Coerce at the read site or a Postgres deployment hands the API a
    // string where its own type says number, and every consumer downstream
    // compares timestamps as text.
    completedAt: row.onboarding_completed_at == null ? null : Number(row.onboarding_completed_at),
  };
}

/**
 * Merge one step's worth of progress into `account.onboarding`.
 *
 * Returns the stored blob, or null when the account does not exist or its
 * onboarding is already complete (the guarded UPDATE matched nothing).
 *
 * Read-modify-write rather than a SQL-side merge, because there is no jsonb
 * concatenation SQLite also understands and the dual-dialect rule is not
 * negotiable. The lost-update window is real but bounded to a SINGLE person
 * advancing their OWN wizard one screen at a time: two overlapping PATCHes can
 * drop one entry from `stepsSeen`. The answers themselves survive — each screen
 * patches a different field — and `lastStep` self-heals on the next advance. A
 * missing breadcrumb is an acceptable price; a non-portable write is not.
 */
export async function saveOnboardingProgress(
  db: Db,
  accountId: string,
  patch: OnboardingProgressInput,
  now: number = Date.now(),
): Promise<AccountOnboarding | null> {
  const current = await getAccountOnboarding(db, accountId);
  if (!current || current.completedAt != null) return null;

  const base = current.onboarding ?? emptyOnboarding(now);
  const next: AccountOnboarding = {
    ...base,
    version: 1,
    // Only fields the client actually sent overwrite. Spreading `patch` wholesale
    // would let an omitted key arrive as `undefined` and blank an earlier answer,
    // so a back-navigation that re-patches only `lastStep` would erase the role.
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.industry !== undefined ? { industry: patch.industry } : {}),
    ...(patch.useCase !== undefined ? { useCase: patch.useCase } : {}),
    ...(patch.template !== undefined ? { template: patch.template } : {}),
    ...(patch.lastStep !== undefined ? { lastStep: patch.lastStep } : {}),
    stepsSeen: withStepSeen(base.stepsSeen ?? [], patch.lastStep),
    startedAt: base.startedAt ?? now,
  };

  const written = await db.get<{ id: string }>(
    sql`UPDATE account SET onboarding = ${jsonParam(next)}
        WHERE id = ${accountId} AND onboarding_completed_at IS NULL
        RETURNING id`,
  );
  return written ? next : null;
}

/**
 * Claim COMPLETION for an account: the wizard was finished and the first form is
 * about to be created from `template`.
 *
 * True for exactly one caller, ever. The caller that wins is the one that may
 * create the form and emit the completion event — everyone else (a double-click,
 * a retried request, a second tab) gets false and must do neither, or the
 * account ends up with two "first" forms and the funnel counts one person twice.
 *
 * Writes the answers and the timestamp in ONE statement so the two can never
 * disagree: an account is never left marked complete with no record of what was
 * chosen, nor with a template recorded and no completion.
 */
export async function claimOnboardingComplete(
  db: Db,
  accountId: string,
  template: FormTemplateId,
  now: number = Date.now(),
): Promise<boolean> {
  const current = await getAccountOnboarding(db, accountId);
  if (!current) return false;

  const base = current.onboarding ?? emptyOnboarding(now);
  const next: AccountOnboarding = {
    ...base,
    version: 1,
    template,
    lastStep: 'template',
    stepsSeen: withStepSeen(base.stepsSeen ?? [], 'template'),
    startedAt: base.startedAt ?? now,
  };

  // The guard, not the read above, is what makes this single-winner: a caller
  // that lost a race between the read and this statement finds the column
  // already set and matches no row.
  const claimed = await db.get<{ id: string }>(
    sql`UPDATE account
        SET onboarding = ${jsonParam(next)}, onboarding_completed_at = ${now}
        WHERE id = ${accountId} AND onboarding_completed_at IS NULL
        RETURNING id`,
  );
  return Boolean(claimed);
}
