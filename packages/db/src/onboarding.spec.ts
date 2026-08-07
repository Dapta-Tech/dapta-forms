/**
 * Onboarding persistence — the incremental progress write and the write-once
 * completion claim. Runs on whatever DATABASE_URL is set, so the same assertions
 * cover SQLite and Postgres.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, migrate, sql, type Db } from './index';
import {
  getAccountOnboarding,
  saveOnboardingProgress,
  claimOnboardingComplete,
} from './onboarding';

let db: Db;

/**
 * Fresh ids per test. On Postgres the suite shares ONE database with every other
 * spec and with the seeded demo data, so this file must never clear a table to
 * isolate itself. Unique ids give the same isolation and touch nothing else.
 */
let ACCOUNT: string;
let OTHER_ACCOUNT: string;
let n = 0;

/**
 * A brand-new account: `onboarding_completed_at` unset, which is what "still
 * owed the wizard" means. Migration 0011's backfill has already run by now, so
 * it cannot touch this row — the INSERT simply leaves the column NULL, exactly
 * as it does for an account the running app creates at signup.
 */
async function seedAccount(accountId: string, code: string): Promise<void> {
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${code}, ${code}, 1000)`,
  );
}

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  const run = `${Date.now()}_${n++}`;
  ACCOUNT = `acc_ob_a_${run}`;
  OTHER_ACCOUNT = `acc_ob_b_${run}`;
  await seedAccount(ACCOUNT, `oa${run}`.slice(0, 20));
  await seedAccount(OTHER_ACCOUNT, `ob${run}`.slice(0, 20));
});

afterEach(() => {
  db.close?.();
});

describe('getAccountOnboarding', () => {
  it('reports an untouched account as owed the wizard', async () => {
    expect(await getAccountOnboarding(db, ACCOUNT)).toEqual({
      onboarding: null,
      completedAt: null,
    });
  });

  it('returns null for an account that does not exist', async () => {
    expect(await getAccountOnboarding(db, 'acc_nope')).toBeNull();
  });

  it('treats an UNPARSEABLE blob as absent rather than throwing', async () => {
    // An older build could have written a shape this one no longer understands.
    // A dashboard request must not 500 over it.
    await db.run(sql`UPDATE account SET onboarding = ${'{"version":99}'} WHERE id = ${ACCOUNT}`);
    const state = await getAccountOnboarding(db, ACCOUNT);
    expect(state?.onboarding).toBeNull();
  });
});

describe('saveOnboardingProgress', () => {
  it('stamps version and startedAt on the first write', async () => {
    const saved = await saveOnboardingProgress(db, ACCOUNT, { role: 'sales', lastStep: 'role' }, 5000);
    expect(saved).toMatchObject({ version: 1, role: 'sales', lastStep: 'role', startedAt: 5000 });
  });

  it('keeps the ORIGINAL startedAt across later writes', async () => {
    await saveOnboardingProgress(db, ACCOUNT, { role: 'sales', lastStep: 'role' }, 5000);
    const saved = await saveOnboardingProgress(db, ACCOUNT, { industry: 'software', lastStep: 'industry' }, 9000);
    expect(saved?.startedAt).toBe(5000);
  });

  it('merges answers instead of replacing them', async () => {
    await saveOnboardingProgress(db, ACCOUNT, { role: 'sales', lastStep: 'role' }, 5000);
    const saved = await saveOnboardingProgress(db, ACCOUNT, { industry: 'software', lastStep: 'industry' }, 6000);
    expect(saved).toMatchObject({ role: 'sales', industry: 'software' });
  });

  it('does NOT blank an earlier answer when a later patch omits it', async () => {
    // The bug this pins: spreading the patch wholesale lets an omitted key
    // arrive as `undefined` and overwrite a stored answer — so navigating back,
    // which re-patches only `lastStep`, would erase the role.
    await saveOnboardingProgress(db, ACCOUNT, { role: 'founder', lastStep: 'role' }, 5000);
    const saved = await saveOnboardingProgress(db, ACCOUNT, { lastStep: 'role' }, 6000);
    expect(saved?.role).toBe('founder');
  });

  it('accumulates the step trail in order, without repeats', async () => {
    await saveOnboardingProgress(db, ACCOUNT, { lastStep: 'role' }, 1);
    await saveOnboardingProgress(db, ACCOUNT, { lastStep: 'industry' }, 2);
    // Back-navigation revisits a screen; the trail must not grow a duplicate.
    await saveOnboardingProgress(db, ACCOUNT, { lastStep: 'role' }, 3);
    const saved = await saveOnboardingProgress(db, ACCOUNT, { lastStep: 'use_case' }, 4);
    expect(saved?.stepsSeen).toEqual(['role', 'industry', 'use_case']);
  });

  it('persists — a reread returns what was written', async () => {
    await saveOnboardingProgress(db, ACCOUNT, { role: 'marketing', lastStep: 'role' }, 5000);
    const state = await getAccountOnboarding(db, ACCOUNT);
    expect(state?.onboarding).toMatchObject({ role: 'marketing' });
    expect(state?.completedAt).toBeNull();
  });

  it('is account-scoped — one account cannot write another', async () => {
    await saveOnboardingProgress(db, ACCOUNT, { role: 'sales', lastStep: 'role' }, 5000);
    const other = await getAccountOnboarding(db, OTHER_ACCOUNT);
    expect(other?.onboarding).toBeNull();
  });

  it('refuses to write once onboarding is COMPLETE', async () => {
    // A stale tab or a retried request must not rewrite the answers of a
    // finished onboarding — the record of what was actually chosen is the point.
    await claimOnboardingComplete(db, ACCOUNT, 'lead-qualifier', 7000);
    expect(await saveOnboardingProgress(db, ACCOUNT, { role: 'hr', lastStep: 'role' }, 8000)).toBeNull();
    const state = await getAccountOnboarding(db, ACCOUNT);
    expect(state?.onboarding?.template).toBe('lead-qualifier');
    expect(state?.onboarding?.role).toBeUndefined();
  });

  it('returns null for an account that does not exist', async () => {
    expect(await saveOnboardingProgress(db, 'acc_nope', { lastStep: 'role' }, 1)).toBeNull();
  });
});

describe('claimOnboardingComplete — exactly once, ever', () => {
  it('the first caller wins', async () => {
    expect(await claimOnboardingComplete(db, ACCOUNT, 'customer-feedback', 7000)).toBe(true);
  });

  it('every later caller loses', async () => {
    await claimOnboardingComplete(db, ACCOUNT, 'customer-feedback', 7000);
    expect(await claimOnboardingComplete(db, ACCOUNT, 'blank', 8000)).toBe(false);
    expect(await claimOnboardingComplete(db, ACCOUNT, 'blank', 9000)).toBe(false);
  });

  it('the LOSER does not overwrite the winner’s template', async () => {
    // Losing must be inert. If the second call still wrote, the account would
    // report a template it never created a form from.
    await claimOnboardingComplete(db, ACCOUNT, 'customer-feedback', 7000);
    await claimOnboardingComplete(db, ACCOUNT, 'blank', 8000);
    const state = await getAccountOnboarding(db, ACCOUNT);
    expect(state?.onboarding?.template).toBe('customer-feedback');
    expect(state?.completedAt).toBe(7000);
  });

  it('CONCURRENT callers produce exactly one winner', async () => {
    // This assertion only has teeth on POSTGRES — better-sqlite3 is synchronous,
    // so the two calls serialize there regardless. It is the guarded UPDATE, not
    // the read before it, that makes this single-winner.
    const results = await Promise.all([
      claimOnboardingComplete(db, ACCOUNT, 'lead-qualifier', 7000),
      claimOnboardingComplete(db, ACCOUNT, 'application', 7000),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('preserves the answers gathered along the way', async () => {
    await saveOnboardingProgress(db, ACCOUNT, { role: 'founder', lastStep: 'role' }, 1000);
    await saveOnboardingProgress(db, ACCOUNT, { industry: 'ecommerce', lastStep: 'industry' }, 2000);
    await saveOnboardingProgress(db, ACCOUNT, { useCase: 'leads', lastStep: 'use_case' }, 3000);
    await claimOnboardingComplete(db, ACCOUNT, 'lead-qualifier', 4000);

    const state = await getAccountOnboarding(db, ACCOUNT);
    expect(state?.onboarding).toMatchObject({
      version: 1,
      role: 'founder',
      industry: 'ecommerce',
      useCase: 'leads',
      template: 'lead-qualifier',
      lastStep: 'template',
      startedAt: 1000,
    });
    expect(state?.onboarding?.stepsSeen).toEqual(['role', 'industry', 'use_case', 'template']);
    expect(state?.completedAt).toBe(4000);
  });

  it('completes even when the wizard was never patched', async () => {
    // Someone who lands on the last screen via a restored session still has to
    // be able to finish; a missing blob is not an error state.
    expect(await claimOnboardingComplete(db, ACCOUNT, 'blank', 7000)).toBe(true);
    const state = await getAccountOnboarding(db, ACCOUNT);
    expect(state?.onboarding).toMatchObject({ version: 1, template: 'blank', startedAt: 7000 });
  });

  it('returns false for an account that does not exist', async () => {
    expect(await claimOnboardingComplete(db, 'acc_nope', 'blank', 1)).toBe(false);
  });
});

describe('the 0011 backfill statement', () => {
  it('stamps a pre-existing account with its own created_at, not the deploy time', async () => {
    // What a row that predates the wizard experiences when the migration runs.
    // Without it the gate reads NULL for every existing user and bounces them
    // out of their dashboard into a wizard they never asked for. `created_at`
    // rather than "now" keeps "completed before we shipped this" legible instead
    // of inventing a spike of completions on deploy day.
    const run = `${Date.now()}_${n++}`;
    const id = `acc_ob_legacy_${run}`;
    // `code` is UNIQUE account-wide and Postgres shares ONE database across the
    // whole suite, so the code has to carry the per-run suffix. Slicing the id's
    // PREFIX would hand every test in the same second the same 20 characters.
    const code = `ol${run}`.slice(0, 20);
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at)
          VALUES (${id}, ${code}, ${'legacy'}, 4242)`,
    );
    await db.run(
      sql`UPDATE account SET onboarding_completed_at = created_at
          WHERE onboarding_completed_at IS NULL AND id = ${id}`,
    );
    const state = await getAccountOnboarding(db, id);
    expect(state?.completedAt).toBe(4242);
  });
});
