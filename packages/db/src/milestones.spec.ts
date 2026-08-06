/**
 * Account milestones — the guards that keep a funnel counting PEOPLE reaching a
 * stage rather than actions taken. Runs on whatever DATABASE_URL is set, so the
 * same assertions cover SQLite and Postgres.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, migrate, sql, type Db } from './index';
import {
  claimAccountActivation,
  claimAccountFirstView,
  getAccountOwner,
  touchMemberLastSeen,
  claimAccountAttribution,
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

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  const run = `${Date.now()}_${n++}`;
  ACCOUNT = `acc_a_${run}`;
  OTHER_ACCOUNT = `acc_b_${run}`;
  // `code` is UNIQUE account-wide, so it has to be per-run too.
  await seedAccount(ACCOUNT, `a${run}`.slice(0, 20));
  await seedAccount(OTHER_ACCOUNT, `b${run}`.slice(0, 20));
});

afterEach(() => {
  db.close?.();
});

describe('claimAccountActivation — exactly once, ever', () => {
  it('the first caller wins', async () => {
    expect(await claimAccountActivation(db, ACCOUNT, 2000)).toBe(true);
  });

  it('every later caller loses', async () => {
    await claimAccountActivation(db, ACCOUNT, 2000);
    expect(await claimAccountActivation(db, ACCOUNT, 3000)).toBe(false);
    expect(await claimAccountActivation(db, ACCOUNT, 4000)).toBe(false);
  });

  it('CONCURRENT callers produce exactly one winner', async () => {
    // The bug this replaced: a read-then-act check had both callers see the
    // other's row and BOTH decline, leaving the account unable to ever activate.
    //
    // This assertion only has teeth on POSTGRES. better-sqlite3 is synchronous,
    // so `Promise.all` runs these one after another and the test would pass even
    // without the WHERE guard. Real concurrency is exercised by the Postgres
    // parity job, where the guard is enforced by a row lock.
    const results = await Promise.all([
      claimAccountActivation(db, ACCOUNT, 2000),
      claimAccountActivation(db, ACCOUNT, 2000),
      claimAccountActivation(db, ACCOUNT, 2000),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('records WHEN it happened, and never moves it', async () => {
    await claimAccountActivation(db, ACCOUNT, 2000);
    await claimAccountActivation(db, ACCOUNT, 9999);
    const row = await db.get<{ activated_at: number | string }>(
      sql`SELECT activated_at FROM account WHERE id = ${ACCOUNT}`,
    );
    expect(Number(row!.activated_at)).toBe(2000);
  });

  it('does not leak across accounts', async () => {
    await claimAccountActivation(db, ACCOUNT, 2000);
    expect(await claimAccountActivation(db, OTHER_ACCOUNT, 2000)).toBe(true);
  });
});

describe('claimAccountFirstView', () => {
  it('the first caller wins and later ones lose', async () => {
    expect(await claimAccountFirstView(db, ACCOUNT, 2000)).toBe(true);
    expect(await claimAccountFirstView(db, ACCOUNT, 3000)).toBe(false);
  });

  it('CONCURRENT callers produce exactly one winner', async () => {
    const results = await Promise.all([
      claimAccountFirstView(db, ACCOUNT, 2000),
      claimAccountFirstView(db, ACCOUNT, 2000),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('is independent of the activation claim', async () => {
    await claimAccountActivation(db, ACCOUNT, 2000);
    // Two separate milestones on the same row — one must not consume the other.
    expect(await claimAccountFirstView(db, ACCOUNT, 2000)).toBe(true);
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

describe('claimAccountAttribution — first touch, once, and only for a NEW account', () => {
  // Seeded accounts are born at epoch-ms 1000, so `now` is passed explicitly:
  // the claim is bounded by account AGE, and Date.now() would put these accounts
  // decades outside the window. That is the behaviour under test, not a nuisance.
  const JUST_BORN = 2000;

  async function storedAttribution(accountId: string): Promise<Record<string, string> | null> {
    const row = await db.get<{ attribution: unknown }>(
      sql`SELECT attribution FROM account WHERE id = ${accountId}`,
    );
    const raw = row?.attribution ?? null;
    if (raw == null) return null;
    // Postgres `jsonb` comes back parsed; SQLite stores the same value as TEXT
    // and hands back the string. Same dual-dialect coercion the package applies
    // to every other JSON column read.
    return typeof raw === 'string' ? (JSON.parse(raw) as Record<string, string>) : (raw as Record<string, string>);
  }

  it('the first caller wins and the payload round-trips', async () => {
    expect(
      await claimAccountAttribution(db, ACCOUNT, { utmSource: 'landing', utmMedium: 'cpc' }, JUST_BORN),
    ).toBe(true);
    expect(await storedAttribution(ACCOUNT)).toEqual({ utmSource: 'landing', utmMedium: 'cpc' });
  });

  it('keeps FIRST touch, not last', async () => {
    // Overwriting would credit whichever link the customer clicked most recently
    // — usually an untagged direct return — and the paid campaign loses the
    // signup it paid for.
    await claimAccountAttribution(db, ACCOUNT, { utmSource: 'google-ads' }, JUST_BORN);
    expect(await claimAccountAttribution(db, ACCOUNT, { utmSource: 'direct' }, JUST_BORN)).toBe(false);
    expect(await storedAttribution(ACCOUNT)).toEqual({ utmSource: 'google-ads' });
  });

  it('REFUSES an account older than the window, even though its column is NULL', async () => {
    // The guard that matters most in production: every account that predates this
    // feature has a NULL column. Without the age bound, the first tagged login by
    // anyone — the owner of a year-old workspace clicking a campaign link, or an
    // invited member just browsing — would permanently stamp that workspace as
    // acquired by a campaign it predates. Write-once, so unrecoverable.
    const wayLater = 1000 + 10 * 60_000 + 1;
    expect(await claimAccountAttribution(db, ACCOUNT, { utmSource: 'landing' }, wayLater)).toBe(false);
    expect(await storedAttribution(ACCOUNT)).toBeNull();
  });

  it('honours a caller-supplied window', async () => {
    const wayLater = 1000 + 60 * 60_000;
    expect(
      await claimAccountAttribution(db, ACCOUNT, { utmSource: 'landing' }, wayLater, 2 * 60 * 60_000),
    ).toBe(true);
  });

  it('CONCURRENT callers produce exactly one winner', async () => {
    // Only has teeth on POSTGRES (better-sqlite3 is synchronous, so Promise.all
    // serializes) — the Postgres parity job is where the row lock is exercised.
    const results = await Promise.all([
      claimAccountAttribution(db, ACCOUNT, { utmSource: 'a' }, JUST_BORN),
      claimAccountAttribution(db, ACCOUNT, { utmSource: 'b' }, JUST_BORN),
      claimAccountAttribution(db, ACCOUNT, { utmSource: 'c' }, JUST_BORN),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('does not leak across accounts', async () => {
    await claimAccountAttribution(db, ACCOUNT, { utmSource: 'landing' }, JUST_BORN);
    expect(await claimAccountAttribution(db, OTHER_ACCOUNT, { utmSource: 'other' }, JUST_BORN)).toBe(
      true,
    );
    expect(await storedAttribution(OTHER_ACCOUNT)).toEqual({ utmSource: 'other' });
  });

  it('is independent of the timestamp milestones on the same row', async () => {
    await claimAccountActivation(db, ACCOUNT, 1500);
    await claimAccountFirstView(db, ACCOUNT, 1500);
    expect(await claimAccountAttribution(db, ACCOUNT, { utmSource: 'landing' }, JUST_BORN)).toBe(true);
  });
});
