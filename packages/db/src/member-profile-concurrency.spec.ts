/**
 * The revision contract under REAL concurrency — two connections, one row.
 *
 * `member-profile-revision.spec.ts` runs on either dialect, but on SQLite it can
 * only prove sequential semantics: better-sqlite3 is synchronous and a single
 * process serializes everything, so nothing there is a race. These orderings
 * need two independent connections committing against the same row, so they run
 * on Postgres only — the dialect production uses — and skip elsewhere rather
 * than pretending SQLite proved them.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, sql, type Db } from './client';
import { migrate } from './migrate';
import { casSetMemberProfile, fenceMemberProfile, getMemberProfileState } from './members';

const url = process.env.DATABASE_URL ?? '';
const isPostgres = url.startsWith('postgres://') || url.startsWith('postgresql://');

/** Connection A and connection B — two clients, as in production. */
let a: Db;
let b: Db;
let accountId: string;
let memberId: string;

const page = (headline: string) => ({ version: 1 as const, enabled: true, headline });

describe.skipIf(!isPostgres)('two connections racing one public page', () => {
  beforeEach(async () => {
    a = await createDb(url);
    b = await createDb(url);
    await migrate(a);
    accountId = randomUUID();
    memberId = randomUUID();
    await a.run(
      sql`INSERT INTO account (id, code, name, created_at)
          VALUES (${accountId}, ${'t' + accountId.slice(0, 8)}, ${'Test'}, ${Date.now()})`,
    );
    await a.run(
      sql`INSERT INTO member (id, account_id, email, display_name, handle, role, status, created_at)
          VALUES (${memberId}, ${accountId}, ${memberId + '@example.com'}, ${'Alex'},
                  ${'h' + memberId.slice(0, 8)}, ${'owner'}, ${'active'}, ${Date.now()})`,
    );
    // Get the row to revision 5 so the expectations below are not the 0 case.
    for (let i = 0; i < 5; i += 1) {
      await a.run(
        sql`UPDATE member SET profile = ${JSON.stringify(page('seed'))},
                              profile_revision = coalesce(profile_revision, 0) + 1
              WHERE id = ${memberId} AND account_id = ${accountId}`,
      );
    }
    expect((await getMemberProfileState(a, accountId, memberId))!.revision).toBe(5);
  });

  afterEach(async () => {
    await a.run(sql`DELETE FROM member WHERE account_id = ${accountId}`);
    await a.run(sql`DELETE FROM account WHERE id = ${accountId}`);
    await a.close();
    await b.close();
  });

  it('refuses A’s delayed write once B has committed r6', async () => {
    // A read at r5 and its request is slow. B writes and commits meanwhile.
    const bWrote = await casSetMemberProfile(b, accountId, memberId, page('from B'), 5);
    expect(bWrote).toMatchObject({ status: 'ok', revision: 6 });

    // A finally lands. Its expectation is spent, so it must not overwrite B.
    const aLate = await casSetMemberProfile(a, accountId, memberId, page('from A'), 5);

    expect(aLate).toMatchObject({ status: 'conflict', revision: 6 });
    expect((await getMemberProfileState(a, accountId, memberId))!.profile).toMatchObject({
      headline: 'from B',
    });
  });

  it('lets exactly one of two simultaneous writers win', async () => {
    const [first, second] = await Promise.all([
      casSetMemberProfile(a, accountId, memberId, page('from A'), 5),
      casSetMemberProfile(b, accountId, memberId, page('from B'), 5),
    ]);

    const outcomes = [first.status, second.status].sort();
    expect(outcomes).toEqual(['conflict', 'ok']);
    // One increment, not two: the loser burned nothing.
    expect((await getMemberProfileState(a, accountId, memberId))!.revision).toBe(6);
  });

  it('ordering 1 — the fence wins first, so A’s in-flight write can never land', async () => {
    // The browser timed out on A's write and fenced from another connection.
    const fenced = await fenceMemberProfile(b, accountId, memberId, 5);
    expect(fenced).toMatchObject({ status: 'ok', revision: 6 });
    expect((fenced as { profile: { headline: string } }).profile.headline).toBe('seed');

    // A's write arrives late and is refused — which is exactly what the fence
    // told the browser: "that save was not applied".
    const aLate = await casSetMemberProfile(a, accountId, memberId, page('from A'), 5);

    expect(aLate).toMatchObject({ status: 'conflict', revision: 6 });
    expect((await getMemberProfileState(a, accountId, memberId))!.profile).toMatchObject({
      headline: 'seed',
    });
  });

  it('ordering 2 — A commits first, so the fence loses and reports A’s state', async () => {
    const aWrote = await casSetMemberProfile(a, accountId, memberId, page('from A'), 5);
    expect(aWrote).toMatchObject({ status: 'ok', revision: 6 });

    // The browser still does not know that. Its fence, with the ORIGINAL
    // expectation, now conflicts and hands back what is really stored.
    const fenced = await fenceMemberProfile(b, accountId, memberId, 5);

    expect(fenced).toMatchObject({ status: 'conflict', revision: 6 });
    expect((fenced as { profile: { headline: string } }).profile.headline).toBe('from A');
    // The fence lost, so it advanced nothing.
    expect((await getMemberProfileState(a, accountId, memberId))!.revision).toBe(6);
  });

  it('keeps repeated fences from burning revisions under contention', async () => {
    const first = await fenceMemberProfile(b, accountId, memberId, 5);
    expect(first).toMatchObject({ status: 'ok', revision: 6 });

    const repeats = await Promise.all([
      fenceMemberProfile(a, accountId, memberId, 5),
      fenceMemberProfile(b, accountId, memberId, 5),
      fenceMemberProfile(a, accountId, memberId, 5),
    ]);

    for (const r of repeats) expect(r).toMatchObject({ status: 'conflict', revision: 6 });
    expect((await getMemberProfileState(a, accountId, memberId))!.revision).toBe(6);
  });
});
