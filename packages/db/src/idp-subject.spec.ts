/**
 * `member.idp_subject` and `member.login_seen_at`: recording a sign-in subject
 * at web login (the latest login within an account takes it) and finding a
 * subject's members for the MCP door. In-memory SQLite locally; DATABASE_URL
 * for Postgres, where the same cases run against the row lock and the real
 * unique index.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, sql, type Db } from './client';
import { migrate } from './migrate';
import {
  memberIdpLink,
  membershipsBySubject,
  noteMemberLogin,
  notePersonLogins,
  recordMemberIdpSubject,
  staffGrantsBySubject,
} from './idp-subject';

let db: Db;
const accounts: string[] = [];
/** Subjects are unique per test run, so a shared Postgres database never sees another run's rows. */
const run = randomUUID().slice(0, 8);
const s = (name: string) => `user_${name}_${run}`;

async function account(name: string, createdAt = Date.now()): Promise<string> {
  const id = randomUUID();
  accounts.push(id);
  await db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${id}, ${`i${id.slice(0, 7)}`}, ${name}, ${createdAt})`);
  return id;
}

async function member(
  accountId: string,
  role = 'admin',
  status = 'active',
  externalId: string | null = `iam_${randomUUID()}`,
  accessGrant: string | null = null,
): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, external_id, email, role, status, access_grant, created_at)
        VALUES (${id}, ${accountId}, ${externalId}, ${`${id.slice(0, 6)}@example.com`}, ${role}, ${status}, ${accessGrant}, ${Date.now()})`,
  );
  return id;
}

const DAY = 86_400_000;
const seen = (id: string, at: number) => db.run(sql`UPDATE member SET login_seen_at = ${at} WHERE id = ${id}`);
const since = (now = Date.now()) => now - 30 * DAY;
const subjectOf = async (id: string) =>
  (await db.get<{ idp_subject: string | null }>(sql`SELECT idp_subject FROM member WHERE id = ${id}`))!.idp_subject;
const seenOf = async (a: string, m: string) => (await memberIdpLink(db, a, m))!.loginSeenAt;

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
});

afterEach(async () => {
  for (const id of accounts.splice(0)) {
    await db.run(sql`DELETE FROM member WHERE account_id = ${id}`);
    await db.run(sql`DELETE FROM account WHERE id = ${id}`);
  }
});

describe('recordMemberIdpSubject', () => {
  it('records a subject once, stamping the login as seen, and reports nothing on the same value again', async () => {
    const a = await account('Acme');
    const m = await member(a);
    expect(await recordMemberIdpSubject(db, a, m, s('one'), 1_000)).toEqual({ written: true, clearedMemberIds: [] });
    expect(await subjectOf(m)).toBe(s('one'));
    expect(await memberIdpLink(db, a, m)).toEqual({ externalId: expect.stringMatching(/^iam_/), idpSubject: s('one'), loginSeenAt: 1_000 });
    expect(await recordMemberIdpSubject(db, a, m, s('one'))).toEqual({ written: false, clearedMemberIds: [] });
  });

  it('never moves the stamp backwards, and stamps nothing without an issue time', async () => {
    const a = await account('Acme');
    const m = await member(a);
    await recordMemberIdpSubject(db, a, m, s('first'), 5_000);
    await recordMemberIdpSubject(db, a, m, s('second'), 1_000);
    expect(await subjectOf(m)).toBe(s('second'));
    expect(await seenOf(a, m)).toBe(5_000);
    const n = await member(a);
    await recordMemberIdpSubject(db, a, n, s('no_time'), null);
    expect(await subjectOf(n)).toBe(s('no_time'));
    expect(await seenOf(a, n)).toBeNull();
  });

  it('within one account the latest login takes the subject from the member who held it', async () => {
    const a = await account('Acme');
    const first = await member(a);
    const second = await member(a);
    await recordMemberIdpSubject(db, a, first, s('shared'));
    expect(await recordMemberIdpSubject(db, a, second, s('shared'))).toEqual({ written: true, clearedMemberIds: [first] });
    expect(await subjectOf(first)).toBeNull();
    expect(await subjectOf(second)).toBe(s('shared'));
  });

  it('one subject may hold a member in each of several accounts', async () => {
    const a = await account('Acme');
    const b = await account('Globex');
    const ma = await member(a);
    const mb = await member(b);
    await recordMemberIdpSubject(db, a, ma, s('multi'));
    expect(await recordMemberIdpSubject(db, b, mb, s('multi'))).toEqual({ written: true, clearedMemberIds: [] });
    expect(await subjectOf(ma)).toBe(s('multi'));
  });

  it('writes nothing for a member of another account or one that does not exist', async () => {
    const a = await account('Acme');
    const b = await account('Globex');
    const m = await member(a);
    expect((await recordMemberIdpSubject(db, b, m, s('x'))).written).toBe(false);
    expect((await recordMemberIdpSubject(db, a, randomUUID(), s('x'))).written).toBe(false);
    expect(await subjectOf(m)).toBeNull();
  });

  it('the unique index refuses two members of one account with the same subject', async () => {
    const a = await account('Acme');
    const first = await member(a);
    const second = await member(a);
    await db.run(sql`UPDATE member SET idp_subject = ${s('dup')} WHERE id = ${first}`);
    // Async wrapper: the SQLite handle throws synchronously.
    const refused = await (async () => db.run(sql`UPDATE member SET idp_subject = ${s('dup')} WHERE id = ${second}`))().then(
      () => null,
      (e: unknown) => e as { code?: string; cause?: { code?: string } },
    );
    expect(refused?.cause?.code ?? refused?.code).toMatch(/^(SQLITE_CONSTRAINT_UNIQUE|23505)$/);
  });
});

describe('noteMemberLogin', () => {
  it('stamps a member never seen, then writes again only once the stamp is a day old', async () => {
    const a = await account('Acme');
    const m = await member(a);
    const t0 = 10 * DAY;
    expect(await noteMemberLogin(db, a, m, t0, DAY)).toBe(true);
    expect(await noteMemberLogin(db, a, m, t0 + DAY - 1, DAY)).toBe(false);
    expect(await seenOf(a, m)).toBe(t0);
    expect(await noteMemberLogin(db, a, m, t0 + DAY + 1, DAY)).toBe(true);
    expect(await seenOf(a, m)).toBe(t0 + DAY + 1);
    // Another account's member, or one that does not exist, is never touched.
    const b = await account('Globex');
    expect(await noteMemberLogin(db, b, m, t0 + 5 * DAY, DAY)).toBe(false);
    expect(await memberIdpLink(db, b, m)).toBeNull();
  });
});

describe('membershipsBySubject', () => {
  it('returns every member carrying the subject with its role, status, person and account name, oldest account first', async () => {
    const newer = await account('Newer', Date.now());
    const older = await account('Older', Date.now() - DAY);
    const mNewer = await member(newer, 'member', 'active', 'iam_m');
    const mOlder = await member(older, 'owner', 'disabled', 'iam_m');
    await recordMemberIdpSubject(db, newer, mNewer, s('m'));
    await recordMemberIdpSubject(db, older, mOlder, s('m'));
    const rows = await membershipsBySubject(db, s('m'), since());
    expect(rows.map(({ email: _email, ...r }) => r)).toEqual([
      { memberId: mOlder, accountId: older, accountName: 'Older', externalId: 'iam_m', role: 'owner', status: 'disabled' },
      { memberId: mNewer, accountId: newer, accountName: 'Newer', externalId: 'iam_m', role: 'member', status: 'active' },
    ]);
    expect(rows.every((r) => r.email?.endsWith('@example.com'))).toBe(true);
    expect(await membershipsBySubject(db, s('none'), since())).toEqual([]);
  });

  it('honors a fresh link and refuses a stale one', async () => {
    const a = await account('Acme');
    const m = await member(a);
    await recordMemberIdpSubject(db, a, m, s('age'));
    expect(await membershipsBySubject(db, s('age'), since())).toHaveLength(1);
    await seen(m, Date.now() - 31 * DAY);
    expect(await membershipsBySubject(db, s('age'), since())).toEqual([]);
    await db.run(sql`UPDATE member SET login_seen_at = NULL WHERE id = ${m}`);
    expect(await membershipsBySubject(db, s('age'), since())).toEqual([]);
  });

  it("reaches the person's members in other accounts through the upstream user id, each only while it is itself fresh", async () => {
    const primary = await account('Primary', Date.now() - 2 * DAY);
    const switched = await account('Switched', Date.now() - DAY);
    const stranger = await account('Stranger');
    const iamUser = `iam_${run}_1`;
    const linked = await member(primary, 'admin', 'active', iamUser);
    // The session for the switched-to account carried no subject: never linked there.
    const other = await member(switched, 'owner', 'active', iamUser);
    const someoneElse = await member(stranger, 'owner', 'active', `iam_${run}_2`);
    await recordMemberIdpSubject(db, primary, linked, s('person'));
    await seen(other, Date.now());
    await seen(someoneElse, Date.now());
    expect((await membershipsBySubject(db, s('person'), since())).map((r) => r.memberId)).toEqual([linked, other]);
    // Not seen in the switched-to account for longer than the window: that account drops out.
    await seen(other, Date.now() - 40 * DAY);
    expect((await membershipsBySubject(db, s('person'), since())).map((r) => r.memberId)).toEqual([linked]);
    // The link itself gone stale: nothing, even where the person was seen.
    await seen(other, Date.now());
    await seen(linked, Date.now() - 40 * DAY);
    expect(await membershipsBySubject(db, s('person'), since())).toEqual([]);
  });

  it('never returns a row no login bound to a person (no external_id), even one carrying the subject', async () => {
    const a = await account('Acme');
    const unbound = await member(a, 'admin', 'active', null);
    await recordMemberIdpSubject(db, a, unbound, s('unbound'));
    expect(await membershipsBySubject(db, s('unbound'), since())).toEqual([]);
  });

  it('never returns a row held through a staff access grant', async () => {
    const own = await account('Own', Date.now() - DAY);
    const customer = await account('Customer');
    const iamUser = `iam_${run}_staff`;
    const real = await member(own, 'admin', 'active', iamUser);
    const grant = await member(customer, 'admin', 'active', iamUser, 'staff');
    await recordMemberIdpSubject(db, own, real, s('staff'));
    await seen(grant, Date.now());
    expect((await membershipsBySubject(db, s('staff'), since())).map((r) => r.memberId)).toEqual([real]);
  });

  it('returns both upstream users when two of them carry the same subject, each with its person id', async () => {
    const a = await account('A', Date.now() - 3 * DAY);
    const b = await account('B', Date.now() - 2 * DAY);
    const ua = await member(a, 'admin', 'active', `iam_${run}_a`);
    const ub = await member(b, 'admin', 'active', `iam_${run}_b`);
    await recordMemberIdpSubject(db, a, ua, s('twice'));
    await recordMemberIdpSubject(db, b, ub, s('twice'));
    expect((await membershipsBySubject(db, s('twice'), since())).map((r) => r.externalId)).toEqual([`iam_${run}_a`, `iam_${run}_b`]);
  });
});

describe('notePersonLogins', () => {
  it("stamps one person's active real memberships in the given accounts only, at most once a refresh step, never backwards", async () => {
    const a = await account('A');
    const b = await account('B');
    const c = await account('C');
    const d = await account('D');
    const person = `iam_${run}_bulk`;
    const real = await member(a, 'member', 'active', person);
    const disabled = await member(b, 'admin', 'disabled', person);
    const grant = await member(c, 'admin', 'active', person, 'staff');
    const unconfirmed = await member(d, 'admin', 'active', person);
    const other = await member(a, 'admin', 'active', `iam_${run}_other`);
    const t0 = 10 * DAY;
    expect(await notePersonLogins(db, person, [a, b, c], t0, DAY)).toBe(1);
    expect(await seenOf(a, real)).toBe(t0);
    for (const [acc, id] of [[b, disabled], [c, grant], [d, unconfirmed], [a, other]] as const) expect(await seenOf(acc, id)).toBeNull();
    expect(await notePersonLogins(db, person, [a], t0 + DAY - 1, DAY)).toBe(0);
    expect(await notePersonLogins(db, person, [a], t0 - 5, DAY)).toBe(0);
    expect(await notePersonLogins(db, person, [], t0 + 5 * DAY, DAY)).toBe(0);
  });
});

describe('staffGrantsBySubject', () => {
  it("returns the person's fresh active grants, reached through a real linked member, and nothing for a grant-only person", async () => {
    const own = await account('Own', Date.now() - DAY);
    const customer = await account('Customer');
    const stale = await account('Stale');
    const person = `iam_${run}_staffer`;
    const real = await member(own, 'admin', 'active', person);
    const fresh = await member(customer, 'admin', 'active', person, 'staff');
    const old = await member(stale, 'admin', 'active', person, 'staff');
    await recordMemberIdpSubject(db, own, real, s('staffer'));
    const now = Date.now();
    await seen(fresh, now);
    await seen(old, now - 2 * DAY);
    const grants = await staffGrantsBySubject(db, s('staffer'), since(), now - DAY);
    expect(grants.map((g) => g.memberId)).toEqual([fresh]);
    // The linking member disabled: no grant either.
    await db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${real}`);
    expect(await staffGrantsBySubject(db, s('staffer'), since(), now - DAY)).toEqual([]);
    await db.run(sql`UPDATE member SET status = 'active' WHERE id = ${real}`);
    // The link itself stale: no grant either.
    await seen(real, now - 40 * DAY);
    expect(await staffGrantsBySubject(db, s('staffer'), since(), now - DAY)).toEqual([]);
    // A subject sitting on a grant row is no link.
    const lone = await account('Lone');
    const grantOnly = await member(lone, 'owner', 'active', `iam_${run}_lone`, 'staff');
    await db.run(sql`UPDATE member SET idp_subject = ${s('lone')}, login_seen_at = ${now} WHERE id = ${grantOnly}`);
    expect(await staffGrantsBySubject(db, s('lone'), since(), now - DAY)).toEqual([]);
  });
});
