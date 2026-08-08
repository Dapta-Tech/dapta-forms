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
  ONBOARDING_STEPS,
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

/**
 * The furthest of two steps, in wizard order.
 *
 * `lastStep` documents itself as "the furthest screen REACHED — the drop-off
 * bucket", and a bucket that can move BACKWARDS is not a bucket. The wizard is
 * pure client state, so a refresh or a return visit remounts at index 0 and its
 * arrival patch would write `role` over a stored `template` — recording someone
 * who reached the template picker as having quit on question one. That does not
 * lose a breadcrumb, it inverts the metric the whole feature was built to
 * produce, and it does it hardest for the people who came back to try again.
 *
 * Advancing only is also what makes an out-of-order PATCH harmless: two writes
 * racing can no longer disagree about which is later.
 */
function furthestStep(
  a: OnboardingStep | null | undefined,
  b: OnboardingStep | null | undefined,
): OnboardingStep | null | undefined {
  if (!a) return b;
  if (!b) return a;
  return ONBOARDING_STEPS.indexOf(b) > ONBOARDING_STEPS.indexOf(a) ? b : a;
}

/**
 * Merge one patch of answers into a blob.
 *
 * `!= null`, not `!== undefined`. Every answer field is `.nullable().optional()`
 * in `onboardingProgressSchema`, so `{"role": null}` is a VALID body that used to
 * pass an `undefined` check and blank an answer already given. Nothing in the
 * product ever needs to un-answer a question — the wizard has no clear button —
 * so "absent" and "explicitly null" mean the same thing here: do not write.
 */
function mergeAnswers(base: AccountOnboarding, patch: OnboardingProgressInput): AccountOnboarding {
  return {
    ...base,
    ...(patch.role != null ? { role: patch.role } : {}),
    ...(patch.industry != null ? { industry: patch.industry } : {}),
    ...(patch.useCase != null ? { useCase: patch.useCase } : {}),
    ...(patch.template != null ? { template: patch.template } : {}),
  };
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
 * negotiable. What makes that safe is that the merge is MONOTONIC in every
 * field: an answer is never blanked (see `mergeAnswers`), `lastStep` only ever
 * advances (see `furthestStep`), `stepsSeen` only grows, and `startedAt` keeps
 * the earliest. Two writes can therefore arrive in either order and settle on
 * the same result, so the ordering the network happens to pick stops mattering.
 *
 * The callers close the rest: the wizard sends its FULL accumulated answers on
 * every advance rather than a one-field delta — so a patch that never landed is
 * repaired by the next one — and it serializes them, so its own two writers
 * cannot interleave. The final answers do not depend on any of this at all:
 * `claimOnboardingComplete` writes them itself, in one statement.
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
  const lastStep = furthestStep(base.lastStep, patch.lastStep);
  const next: AccountOnboarding = {
    ...mergeAnswers(base, patch),
    version: 1,
    ...(lastStep != null ? { lastStep } : {}),
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
 *
 * `answers` comes from the wizard's own state, not from what happened to reach
 * the database first. The template screen arms its CTA as soon as question three
 * is answered, so that answer's PATCH and this claim are routinely in flight
 * together — and whichever read the row first would have written a blob without
 * the other's field. Taking the answers here removes the dependency: the winning
 * statement writes the complete set, and a PATCH that lands afterwards is
 * correctly refused by the `IS NULL` guard.
 */
export async function claimOnboardingComplete(
  db: Db,
  accountId: string,
  template: FormTemplateId,
  answers: OnboardingProgressInput = {},
  now: number = Date.now(),
): Promise<boolean> {
  const current = await getAccountOnboarding(db, accountId);
  if (!current) return false;

  const base = current.onboarding ?? emptyOnboarding(now);
  const next: AccountOnboarding = {
    ...mergeAnswers(base, answers),
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

/**
 * Record the form the winning claim created, so a LOSING claim can be sent to
 * that exact form.
 *
 * A second write rather than part of the claim, because the ordering is not
 * negotiable: only the claim's winner may create anything, so the form does not
 * exist yet when the claim is made. It is uncontended all the same —
 * `onboarding_completed_at` is set by the time this runs, which is precisely the
 * condition under which `saveOnboardingProgress` refuses to write.
 *
 * Guarded on the field still being empty so a retry cannot repoint a workspace's
 * recorded first form at something built later.
 */
export async function recordOnboardingFormId(
  db: Db,
  accountId: string,
  formId: string,
): Promise<void> {
  const current = await getAccountOnboarding(db, accountId);
  if (!current?.onboarding || current.onboarding.formId) return;
  const next: AccountOnboarding = { ...current.onboarding, formId };
  await db.run(
    sql`UPDATE account SET onboarding = ${jsonParam(next)} WHERE id = ${accountId}`,
  );
}
