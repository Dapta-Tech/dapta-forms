/**
 * Onboarding persistence — the incremental progress write and the write-once
 * completion claim. Runs on whatever DATABASE_URL is set, so the same assertions
 * cover SQLite and Postgres.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDb, migrate, sql, type Db } from './index';
import { jsonParam } from './forms';
import {
  getAccountOnboarding,
  saveOnboardingProgress,
  claimOnboardingComplete,
  recordOnboardingFormId,
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
    const saved = await saveOnboardingProgress(db, ACCOUNT, { industry: 'computer_software', lastStep: 'industry' }, 9000);
    expect(saved?.startedAt).toBe(5000);
  });

  it('merges answers instead of replacing them', async () => {
    await saveOnboardingProgress(db, ACCOUNT, { role: 'sales', lastStep: 'role' }, 5000);
    const saved = await saveOnboardingProgress(db, ACCOUNT, { industry: 'computer_software', lastStep: 'industry' }, 6000);
    expect(saved).toMatchObject({ role: 'sales', industry: 'computer_software' });
  });

  it('does NOT blank an earlier answer when a later patch omits it', async () => {
    // The bug this pins: spreading the patch wholesale lets an omitted key
    // arrive as `undefined` and overwrite a stored answer — so navigating back,
    // which re-patches only `lastStep`, would erase the role.
    await saveOnboardingProgress(db, ACCOUNT, { role: 'founder', lastStep: 'role' }, 5000);
    const saved = await saveOnboardingProgress(db, ACCOUNT, { lastStep: 'role' }, 6000);
    expect(saved?.role).toBe('founder');
  });

  it('does NOT blank an earlier answer when a later patch sends an explicit null', async () => {
    // `onboardingProgressSchema` declares every answer `.nullable()`, so
    // `{"role": null}` is a VALID body — and an `!== undefined` guard lets it
    // through and erases an answer already given. Nothing in the product ever
    // un-answers a question, so absent and null have to mean the same thing.
    await saveOnboardingProgress(db, ACCOUNT, { role: 'founder', lastStep: 'role' }, 5000);
    const saved = await saveOnboardingProgress(
      db,
      ACCOUNT,
      { role: null, industry: 'computer_software', lastStep: 'industry' },
      6000,
    );
    expect(saved?.role).toBe('founder');
    expect(saved?.industry).toBe('computer_software');
  });

  it('never moves lastStep BACKWARDS', async () => {
    // The wizard is pure client state, so a refresh or a return visit remounts
    // at index 0 and re-announces step one. `lastStep` documents itself as the
    // furthest screen REACHED — the drop-off bucket — so letting it regress
    // files someone who got to the template picker as a question-one quitter,
    // and inverts the metric the whole feature exists to produce.
    await saveOnboardingProgress(db, ACCOUNT, { lastStep: 'template' }, 5000);
    const saved = await saveOnboardingProgress(db, ACCOUNT, { lastStep: 'role' }, 6000);
    expect(saved?.lastStep).toBe('template');
    // The visit is still recorded — only the bucket is protected.
    expect(saved?.stepsSeen).toEqual(['template', 'role']);
  });

  it('settles on the same answers whichever order two patches land in', async () => {
    // The wizard has two writers — the arrival patch and every answer — and they
    // can overlap on the wire. The merge is monotonic in every field, so the
    // order the network happens to pick cannot change the result.
    await saveOnboardingProgress(db, ACCOUNT, { role: 'sales', lastStep: 'industry' }, 5000);
    await saveOnboardingProgress(db, ACCOUNT, { lastStep: 'role' }, 5001);

    const state = await getAccountOnboarding(db, ACCOUNT);
    expect(state?.onboarding).toMatchObject({ role: 'sales', lastStep: 'industry' });
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
    await claimOnboardingComplete(db, ACCOUNT, 'lead-qualifier', {}, undefined, 7000);
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
    expect(await claimOnboardingComplete(db, ACCOUNT, 'customer-feedback', {}, undefined, 7000)).toBe(true);
  });

  it('every later caller loses', async () => {
    await claimOnboardingComplete(db, ACCOUNT, 'customer-feedback', {}, undefined, 7000);
    expect(await claimOnboardingComplete(db, ACCOUNT, 'blank', {}, undefined, 8000)).toBe(false);
    expect(await claimOnboardingComplete(db, ACCOUNT, 'blank', {}, undefined, 9000)).toBe(false);
  });

  it('the LOSER does not overwrite the winner’s template', async () => {
    // Losing must be inert. If the second call still wrote, the account would
    // report a template it never created a form from.
    await claimOnboardingComplete(db, ACCOUNT, 'customer-feedback', {}, undefined, 7000);
    await claimOnboardingComplete(db, ACCOUNT, 'blank', {}, undefined, 8000);
    const state = await getAccountOnboarding(db, ACCOUNT);
    expect(state?.onboarding?.template).toBe('customer-feedback');
    expect(state?.completedAt).toBe(7000);
  });

  it('CONCURRENT callers produce exactly one winner', async () => {
    // This assertion only has teeth on POSTGRES — better-sqlite3 is synchronous,
    // so the two calls serialize there regardless. It is the guarded UPDATE, not
    // the read before it, that makes this single-winner.
    const results = await Promise.all([
      claimOnboardingComplete(db, ACCOUNT, 'lead-qualifier', {}, undefined, 7000),
      claimOnboardingComplete(db, ACCOUNT, 'application', {}, undefined, 7000),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('preserves the answers gathered along the way', async () => {
    await saveOnboardingProgress(db, ACCOUNT, { role: 'founder', lastStep: 'role' }, 1000);
    await saveOnboardingProgress(db, ACCOUNT, { industry: 'retail', lastStep: 'industry' }, 2000);
    await saveOnboardingProgress(db, ACCOUNT, { useCase: 'leads', lastStep: 'use_case' }, 3000);
    await claimOnboardingComplete(db, ACCOUNT, 'lead-qualifier', {}, undefined, 4000);

    const state = await getAccountOnboarding(db, ACCOUNT);
    expect(state?.onboarding).toMatchObject({
      version: 1,
      role: 'founder',
      industry: 'retail',
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
    expect(await claimOnboardingComplete(db, ACCOUNT, 'blank', {}, undefined, 7000)).toBe(true);
    const state = await getAccountOnboarding(db, ACCOUNT);
    expect(state?.onboarding).toMatchObject({ version: 1, template: 'blank', startedAt: 7000 });
  });

  it('returns false for an account that does not exist', async () => {
    expect(await claimOnboardingComplete(db, 'acc_nope', 'blank', {}, undefined, 1)).toBe(false);
  });

  /**
   * The template screen arms its CTA the moment question three is answered, so
   * the completion can be sent ~300ms behind that answer's PATCH — and both used
   * to write the same JSON column by read-modify-write. If the claim's read won,
   * `useCase` was written by nobody. Carrying the answers on the claim is what
   * makes the final record independent of who reads the row first.
   */
  it('writes answers handed to it, even with nothing patched before', async () => {
    await claimOnboardingComplete(
      db,
      ACCOUNT,
      'lead-qualifier',
      { role: 'founder', industry: 'computer_software', useCase: 'leads' },
      undefined,
      7000,
    );
    expect((await getAccountOnboarding(db, ACCOUNT))?.onboarding).toMatchObject({
      role: 'founder',
      industry: 'computer_software',
      useCase: 'leads',
      template: 'lead-qualifier',
    });
  });

  it('keeps a PATCHed answer the completion did not carry', async () => {
    await saveOnboardingProgress(db, ACCOUNT, { role: 'marketing', lastStep: 'role' }, 1000);
    await claimOnboardingComplete(db, ACCOUNT, 'blank', { useCase: 'other' }, undefined, 7000);
    expect((await getAccountOnboarding(db, ACCOUNT))?.onboarding).toMatchObject({
      role: 'marketing',
      useCase: 'other',
    });
  });
});

describe('the cohort record — why an answer is missing', () => {
  it('marks what Dapta holds as a POINTER, not a gap', async () => {
    // The whole reason this field exists. The IAM has no endpoint that returns a
    // person's answers yet, so skipping industry and CRM leaves them null for the
    // entire Dapta cohort. Without a reason recorded beside them, "Dapta has it"
    // and "we never collected it" are the same null, and in three months nobody
    // remembers which. With it, the eventual fix is a backfill query.
    await claimOnboardingComplete(
      db,
      ACCOUNT,
      'blank',
      { leadSource: 'google_ads', useCase: 'leads' },
      'dapta',
      7000,
    );
    const blob = (await getAccountOnboarding(db, ACCOUNT))?.onboarding;
    expect(blob?.cohort).toBe('dapta');
    expect(blob?.sources).toMatchObject({
      industry: 'dapta',
      crm: 'dapta',
      lead_volume: 'dapta',
      phone: 'dapta',
      // The two Dapta cannot answer: no equivalent in its bank, and the one that
      // preselects a template.
      lead_source: 'asked',
      use_case: 'asked',
    });
  });

  it('tells a declined answer apart from one never asked', async () => {
    // A cold signup is SHOWN the phone screen. Passing over it is a fact about a
    // person; being from Dapta is a fact about where the data lives.
    await claimOnboardingComplete(
      db,
      ACCOUNT,
      'blank',
      {
        industry: 'retail',
        crm: 'hubspot',
        leadVolume: '201_500',
        leadSource: 'outbound',
        useCase: 'leads',
      },
      'cold',
      7000,
    );
    const blob = (await getAccountOnboarding(db, ACCOUNT))?.onboarding;
    expect(blob?.sources).toMatchObject({
      phone: 'skipped',
      industry: 'asked',
      crm: 'asked',
      lead_volume: 'asked',
      lead_source: 'asked',
    });
  });

  it('completes without a cohort, recording nothing rather than guessing', async () => {
    // A caller from before this shipped, or a fork. Metadata is not worth
    // failing a completion over.
    expect(await claimOnboardingComplete(db, ACCOUNT, 'blank', {}, undefined, 7000)).toBe(true);
    const blob = (await getAccountOnboarding(db, ACCOUNT))?.onboarding;
    expect(blob?.cohort).toBeUndefined();
    expect(blob?.sources).toBeUndefined();
  });

  it('does not fail a claim over a cohort it does not recognise', async () => {
    expect(
      await claimOnboardingComplete(db, ACCOUNT, 'blank', {}, 'from-the-future' as never, 7000),
    ).toBe(true);
  });
});

describe('recordOnboardingFormId', () => {
  it('records the form the winner built', async () => {
    await claimOnboardingComplete(db, ACCOUNT, 'blank', {}, undefined, 7000);
    await recordOnboardingFormId(db, ACCOUNT, 'form_created_by_winner');
    expect((await getAccountOnboarding(db, ACCOUNT))?.onboarding?.formId).toBe(
      'form_created_by_winner',
    );
  });

  it('is write-once — a retry cannot repoint it at a form built later', async () => {
    await claimOnboardingComplete(db, ACCOUNT, 'blank', {}, undefined, 7000);
    await recordOnboardingFormId(db, ACCOUNT, 'form_first');
    await recordOnboardingFormId(db, ACCOUNT, 'form_second');
    expect((await getAccountOnboarding(db, ACCOUNT))?.onboarding?.formId).toBe('form_first');
  });

  it('leaves the rest of the blob alone', async () => {
    await saveOnboardingProgress(db, ACCOUNT, { role: 'sales', lastStep: 'role' }, 1000);
    await claimOnboardingComplete(db, ACCOUNT, 'lead-qualifier', {}, undefined, 7000);
    await recordOnboardingFormId(db, ACCOUNT, 'form_x');
    expect((await getAccountOnboarding(db, ACCOUNT))?.onboarding).toMatchObject({
      role: 'sales',
      template: 'lead-qualifier',
      lastStep: 'template',
      startedAt: 1000,
      formId: 'form_x',
    });
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

describe('the 0012 industry rewrite', () => {
  /**
   * Run migration 0012 exactly as it ships.
   *
   * `migrate()` has already applied it in `beforeEach`, before these rows exist,
   * so the statement has to be replayed — and it is replayed from the FILE, per
   * dialect, rather than from a copy pasted into this spec. A copy would pass
   * forever while the real migration rotted.
   */
  async function migrateIndustry(): Promise<void> {
    const file = new URL(
      `../migrations/${db.dialect}/0012_onboarding_iam_industries.sql`,
      import.meta.url,
    );
    await db.run(sql.raw(readFileSync(file, 'utf8')));
  }

  /** A row written by the PREVIOUS build, with one of the eleven old buckets. */
  async function legacyRow(industry: string): Promise<string> {
    const run = `${Date.now()}_${n++}`;
    const id = `acc_ob_ind_${run}`;
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at)
          VALUES (${id}, ${`oi${run}`.slice(0, 20)}, ${'legacy'}, 1000)`,
    );
    await db.run(
      sql`UPDATE account SET onboarding = ${jsonParam({
        version: 1,
        role: 'founder',
        industry,
        useCase: 'leads',
        lastStep: 'use_case',
        stepsSeen: ['role', 'industry', 'use_case'],
        startedAt: 1000,
      })} WHERE id = ${id}`,
    );
    return id;
  }

  it('a stale value takes the WHOLE blob down, not just the industry', async () => {
    // The reason the migration is not optional. `readOnboarding` safeParses the
    // blob and treats a failure as absent — so one unmigrated enum value loses
    // the role, the use case and the drop-off bucket with it, silently, on every
    // read. This is the state the migration exists to prevent.
    const id = await legacyRow('software');
    const state = await getAccountOnboarding(db, id);
    expect(state?.onboarding).toBeNull();
  });

  it('rewrites every old bucket to a value the schema accepts', async () => {
    const expected: Record<string, string> = {
      software: 'computer_software',
      ecommerce: 'retail',
      services: 'consumer_services',
      agency: 'marketing_advertising',
      health: 'hospital_healthcare',
      finance: 'financial_services',
      education: 'education_management',
      realestate: 'real_estate',
      // No manufacturing OR logistics entry exists in the IAM bank. Anything
      // narrower would invent a specificity nobody stated.
      manufacturing: 'other',
    };
    for (const [old, want] of Object.entries(expected)) {
      const id = await legacyRow(old);
      await migrateIndustry();
      const state = await getAccountOnboarding(db, id);
      expect(state?.onboarding?.industry, `${old} -> ${want}`).toBe(want);
      // The rest of the blob survives — that is the half `jsonb_set`/`json_set`
      // buy over rewriting the column.
      expect(state?.onboarding).toMatchObject({
        role: 'founder',
        useCase: 'leads',
        lastStep: 'use_case',
        startedAt: 1000,
      });
    }
  });

  it('leaves a value that is already legal alone, and re-runs as a no-op', async () => {
    const id = await legacyRow('nonprofit');
    await migrateIndustry();
    await migrateIndustry();
    expect((await getAccountOnboarding(db, id))?.onboarding?.industry).toBe('nonprofit');
  });
});
