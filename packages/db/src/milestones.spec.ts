/**
 * Account milestones — the guards that keep a funnel counting PEOPLE reaching a
 * stage rather than actions taken. Runs on whatever DATABASE_URL is set, so the
 * same assertions cover SQLite and Postgres.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, migrate, sql, type Db } from './index';
import {
  isFirstAccountCompletion,
  isFirstAccountFormView,
  getAccountOwner,
  touchMemberLastSeen,
} from './milestones';

let db: Db;

/**
 * Fresh ids per test. On Postgres the suite shares ONE database with every
 * other spec and with the seeded demo data, so this file must never clear a
 * table to isolate itself — doing so silently breaks whichever spec runs next.
 * Unique ids give the same isolation and touch nothing else; every function
 * under test is account-scoped, so unrelated rows are invisible to it anyway.
 */
let ACCOUNT: string;
let OTHER_ACCOUNT: string;
let F1: string;
let F2: string;
let F_OTHER: string;
let n = 0;

async function seedAccount(accountId: string, code: string): Promise<void> {
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${code}, ${code}, 1000)`,
  );
}

async function seedMember(
  id: string,
  accountId: string,
  role: string,
  email: string | null,
  opts: { status?: string; createdAt?: number } = {},
): Promise<void> {
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, created_at)
        VALUES (${id}, ${accountId}, ${email}, ${role}, ${opts.status ?? 'active'},
                ${opts.createdAt ?? 1000})`,
  );
}

async function seedForm(id: string, accountId: string): Promise<void> {
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
        VALUES (${id}, ${accountId}, ${id}, ${id}, '{}', 1000, 1000)`,
  );
}

async function seedSubmission(id: string, formId: string, completedAt: number | null) {
  await db.run(
    sql`INSERT INTO submission (id, form_id, session_id, data, score, started_at, completed_at)
        VALUES (${id}, ${formId}, ${id}, '{}', 0, 1000, ${completedAt})`,
  );
}

async function seedView(id: string, formId: string, type = 'view'): Promise<void> {
  await db.run(
    sql`INSERT INTO form_event (id, form_id, session_id, type, created_at)
        VALUES (${id}, ${formId}, ${id}, ${type}, 1000)`,
  );
}

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  const run = `${Date.now()}_${n++}`;
  ACCOUNT = `acc_a_${run}`;
  OTHER_ACCOUNT = `acc_b_${run}`;
  F1 = `f1_${run}`;
  F2 = `f2_${run}`;
  F_OTHER = `fo_${run}`;
  // `code` is UNIQUE account-wide, so it has to be per-run too.
  await seedAccount(ACCOUNT, `a${run}`.slice(0, 20));
  await seedAccount(OTHER_ACCOUNT, `b${run}`.slice(0, 20));
  await seedForm(F1, ACCOUNT);
  await seedForm(F2, ACCOUNT);
  await seedForm(F_OTHER, OTHER_ACCOUNT);
});

afterEach(() => {
  db.close?.();
});

describe('isFirstAccountCompletion — activation fires once per account', () => {
  it('is true for the very first completed submission', async () => {
    await seedSubmission(`s_1_${ACCOUNT}`, F1, 2000);
    expect(await isFirstAccountCompletion(db, ACCOUNT, `s_1_${ACCOUNT}`)).toBe(true);
  });

  it('is false for every submission after it, on ANY form of the account', async () => {
    await seedSubmission(`s_1_${ACCOUNT}`, F1, 2000);
    await seedSubmission(`s_2_${ACCOUNT}`, F2, 3000);
    // Without this, an account that gets 1000 answers "activates" 1000 times
    // and the funnel improves the more a happy customer succeeds.
    expect(await isFirstAccountCompletion(db, ACCOUNT, `s_2_${ACCOUNT}`)).toBe(false);
  });

  it('ignores partials — starting and leaving is not an answer', async () => {
    await seedSubmission(`s_partial_${ACCOUNT}`, F1, null);
    await seedSubmission(`s_1_${ACCOUNT}`, F1, 2000);
    expect(await isFirstAccountCompletion(db, ACCOUNT, `s_1_${ACCOUNT}`)).toBe(true);
  });

  it('does not leak across accounts', async () => {
    await seedSubmission(`s_other_${ACCOUNT}`, F_OTHER, 2000);
    await seedSubmission(`s_1_${ACCOUNT}`, F1, 3000);
    expect(await isFirstAccountCompletion(db, ACCOUNT, `s_1_${ACCOUNT}`)).toBe(true);
  });
});

describe('isFirstAccountFormView', () => {
  it('is true when nothing of this account was ever viewed', async () => {
    expect(await isFirstAccountFormView(db, ACCOUNT, F1)).toBe(true);
  });

  it('is false once the same form has a view', async () => {
    await seedView(`e_1_${ACCOUNT}`, F1);
    expect(await isFirstAccountFormView(db, ACCOUNT, F1)).toBe(false);
  });

  it('is false when a DIFFERENT form of the account was already viewed', async () => {
    await seedView(`e_1_${ACCOUNT}`, F1);
    // The milestone is the account's first traffic ever, not each form's.
    expect(await isFirstAccountFormView(db, ACCOUNT, F2)).toBe(false);
  });

  it('ignores non-view events', async () => {
    await seedView(`e_1_${ACCOUNT}`, F1, 'step_view');
    expect(await isFirstAccountFormView(db, ACCOUNT, F1)).toBe(true);
  });

  it('does not leak across accounts', async () => {
    await seedView(`e_other_${ACCOUNT}`, F_OTHER);
    expect(await isFirstAccountFormView(db, ACCOUNT, F1)).toBe(true);
  });
});

describe('getAccountOwner', () => {
  it('returns the active owner', async () => {
    await seedMember(`m1_${ACCOUNT}`, ACCOUNT, 'owner', 'owner@acme.com');
    await seedMember(`m2_${ACCOUNT}`, ACCOUNT, 'member', 'member@acme.com');
    expect((await getAccountOwner(db, ACCOUNT))?.email).toBe('owner@acme.com');
  });

  it('skips a deactivated owner rather than anchoring events to them', async () => {
    await seedMember(`m1_${ACCOUNT}`, ACCOUNT, 'owner', 'gone@acme.com', { status: 'disabled' });
    expect(await getAccountOwner(db, ACCOUNT)).toBeNull();
  });

  it('is deterministic when ownership was transferred', async () => {
    await seedMember(`mnew_${ACCOUNT}`, ACCOUNT, 'owner', 'new@acme.com', { createdAt: 5000 });
    await seedMember(`mold_${ACCOUNT}`, ACCOUNT, 'owner', 'old@acme.com', { createdAt: 1000 });
    expect((await getAccountOwner(db, ACCOUNT))?.email).toBe('old@acme.com');
  });
});

describe('touchMemberLastSeen', () => {
  async function lastSeen(id: string): Promise<number | null> {
    const row = await db.get<{ last_seen_at: number | string | null }>(
      sql`SELECT last_seen_at FROM member WHERE id = ${id}`,
    );
    // Number(): node-postgres hands BIGINT back as a STRING (it does not fit a
    // JS number in the general case), while SQLite returns a number. Same
    // coercion the rest of the package applies to raw bigint/count reads.
    return row?.last_seen_at == null ? null : Number(row.last_seen_at);
  }

  it('stamps a member that was never seen', async () => {
    await seedMember(`m1_${ACCOUNT}`, ACCOUNT, 'owner', 'a@b.com');
    await touchMemberLastSeen(db, `m1_${ACCOUNT}`, 10_000);
    expect(await lastSeen(`m1_${ACCOUNT}`)).toBe(10_000);
  });

  it('does NOT write again inside the throttle window', async () => {
    await seedMember(`m1_${ACCOUNT}`, ACCOUNT, 'owner', 'a@b.com');
    await touchMemberLastSeen(db, `m1_${ACCOUNT}`, 10_000);
    // Without the throttle this is a row UPDATE on every authenticated request.
    await touchMemberLastSeen(db, `m1_${ACCOUNT}`, 10_001);
    expect(await lastSeen(`m1_${ACCOUNT}`)).toBe(10_000);
  });

  it('writes again once the window has passed', async () => {
    await seedMember(`m1_${ACCOUNT}`, ACCOUNT, 'owner', 'a@b.com');
    await touchMemberLastSeen(db, `m1_${ACCOUNT}`, 10_000);
    await touchMemberLastSeen(db, `m1_${ACCOUNT}`, 10_000 + 15 * 60_000 + 1);
    expect(await lastSeen(`m1_${ACCOUNT}`)).toBe(10_000 + 15 * 60_000 + 1);
  });
});
