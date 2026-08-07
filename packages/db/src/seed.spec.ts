/**
 * The demo seed's contract with the first-run gate.
 *
 * `db:setup` is `db:migrate && db:seed`, in that order, so migration 0011's
 * backfill sweeps the table BEFORE this row exists and can never reach it. That
 * left the seeded account as the one account in a fresh database still owed a
 * wizard — and with `ONBOARDING_WIZARD` on by default, that is not a cosmetic
 * detail:
 *
 *   - `pnpm dev` lands on `/onboarding` instead of the dashboard, contradicting
 *     the zero-infra path CLAUDE.md documents.
 *   - The demo form the seed just wrote is invisible behind the gate, and
 *     finishing the wizard adds a SECOND "first" form to the same account.
 *   - `qa/dev-sqlite.sh` seeds the same row, so every Playwright spec that
 *     navigates to `/admin/...` redirects into the wizard. That is most of the
 *     suite, and it fails in a way that looks like a routing bug.
 *
 * The account is onboarded by definition: it ships with a form.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { seed } from './seed';

let db: Db;

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
});

afterEach(async () => {
  await db.close?.();
});

describe('seed — the demo account and the first-run gate', () => {
  it('stamps onboarding_completed_at, so a fresh clone lands on the dashboard', async () => {
    const { accountCode } = await seed(db);
    const row = await db.get<{ onboarding_completed_at: number | string | null }>(
      sql`SELECT onboarding_completed_at FROM account WHERE code = ${accountCode}`,
    );
    expect(row?.onboarding_completed_at).not.toBeNull();
    expect(Number(row?.onboarding_completed_at)).toBeGreaterThan(0);
  });

  it('reseeds to the same state — the stamp is not a one-time accident', async () => {
    await seed(db);
    const { accountCode } = await seed(db);
    const row = await db.get<{ onboarding_completed_at: number | string | null }>(
      sql`SELECT onboarding_completed_at FROM account WHERE code = ${accountCode}`,
    );
    expect(Number(row?.onboarding_completed_at)).toBeGreaterThan(0);
  });
});
