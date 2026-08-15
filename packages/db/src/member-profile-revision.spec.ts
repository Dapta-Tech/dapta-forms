/**
 * The public page write contract, at the data layer.
 *
 * A save whose answer never reaches the browser is ambiguous — the timeout does
 * not abort the write. `member.profile_revision` is what makes that decidable:
 * every writer increments it by exactly one, so a caller that knows the revision
 * it started from can name ITS write instead of guessing from content.
 *
 * Runs on whichever dialect DATABASE_URL points at, so CI re-runs the same
 * suite against real Postgres (the parity job); locally it is in-memory SQLite.
 * SQLite here proves SEQUENTIAL semantics only — a genuine race needs two
 * connections and lives in `member-profile-concurrency.spec.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb, sql, type Db } from './client';
import { migrate } from './migrate';
import {
  casSetMemberProfile,
  fenceMemberProfile,
  getMemberProfileState,
  normalizeProfileRevision,
  overwriteMemberProfileLegacy,
} from './members';

let db: Db;
let accountId: string;
let otherAccountId: string;
let memberId: string;

const page = (enabled: boolean, headline = 'Growth partner') => ({
  version: 1 as const,
  enabled,
  headline,
});

async function addAccount(): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${id}, ${'t' + id.slice(0, 8)}, ${'Test'}, ${Date.now()})`,
  );
  return id;
}

async function addMember(account: string): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, email, display_name, handle, role, status, created_at)
        VALUES (${id}, ${account}, ${id + '@example.com'}, ${'Alex'}, ${'h' + id.slice(0, 8)},
                ${'owner'}, ${'active'}, ${Date.now()})`,
  );
  return id;
}

/** A member row as it existed before migration 0016: revision IS NULL. */
async function makeLegacy(id: string): Promise<void> {
  await db.run(sql`UPDATE member SET profile_revision = NULL WHERE id = ${id}`);
}

const rawRevision = async (id: string): Promise<unknown> =>
  (await db.get<Record<string, unknown>>(sql`SELECT profile_revision FROM member WHERE id = ${id}`))
    ?.profile_revision;

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  accountId = await addAccount();
  otherAccountId = await addAccount();
  memberId = await addMember(accountId);
});

afterEach(async () => {
  // Leave a shared Postgres database clean (memory SQLite just evaporates).
  await db.run(sql`DELETE FROM member WHERE account_id IN (${accountId}, ${otherAccountId})`);
  await db.run(sql`DELETE FROM account WHERE id IN (${accountId}, ${otherAccountId})`);
  await db.close();
});

describe('compare-and-set writes', () => {
  it('starts at 0 and advances by exactly one per write', async () => {
    const before = await getMemberProfileState(db, accountId, memberId);
    expect(before).toEqual({ profile: null, revision: 0 });

    const first = await casSetMemberProfile(db, accountId, memberId, page(true), 0);
    expect(first).toMatchObject({ status: 'ok', revision: 1 });
    expect((first as { profile: { enabled: boolean } }).profile.enabled).toBe(true);

    const second = await casSetMemberProfile(db, accountId, memberId, page(false), 1);
    expect(second).toMatchObject({ status: 'ok', revision: 2 });
    expect(await getMemberProfileState(db, accountId, memberId)).toMatchObject({ revision: 2 });
  });

  it('treats a pre-0016 row (NULL revision) as logical 0 and writes it', async () => {
    await makeLegacy(memberId);
    expect(await rawRevision(memberId)).toBeNull();

    // Without coalesce(), the predicate `profile_revision = 0` never matches a
    // NULL row and `profile_revision + 1` stays NULL: this is the counterfactual
    // that fails if either loses its coalesce.
    const res = await casSetMemberProfile(db, accountId, memberId, page(true), 0);

    expect(res).toMatchObject({ status: 'ok', revision: 1 });
    expect(await getMemberProfileState(db, accountId, memberId)).toMatchObject({ revision: 1 });
  });

  it('hands back a NUMBER, not whatever the driver returned', async () => {
    const res = await casSetMemberProfile(db, accountId, memberId, page(true), 0);

    expect(typeof (res as { revision: unknown }).revision).toBe('number');
    const state = await getMemberProfileState(db, accountId, memberId);
    expect(typeof state?.revision).toBe('number');
  });

  it('orders 9 before 10 — numerically, not as text', async () => {
    for (let i = 0; i < 9; i += 1) {
      expect(await casSetMemberProfile(db, accountId, memberId, page(true), i)).toMatchObject({
        status: 'ok',
        revision: i + 1,
      });
    }
    const tenth = await casSetMemberProfile(db, accountId, memberId, page(false), 9);

    expect(tenth).toMatchObject({ status: 'ok', revision: 10 });
    expect((await getMemberProfileState(db, accountId, memberId))!.revision).toBe(10);
    // A stale 9 is refused even though "9" sorts after "10" as text.
    expect(await casSetMemberProfile(db, accountId, memberId, page(true), 9)).toMatchObject({
      status: 'conflict',
      revision: 10,
    });
  });

  it('refuses a stale expectation, and burns no revision doing it', async () => {
    await casSetMemberProfile(db, accountId, memberId, page(true), 0); // -> 1
    await casSetMemberProfile(db, accountId, memberId, page(false), 1); // -> 2

    const stale = await casSetMemberProfile(db, accountId, memberId, page(true), 0);

    expect(stale).toMatchObject({ status: 'conflict', revision: 2 });
    // The refusal is free: retrying after adopting state must not have to race a
    // counter that the refusal itself moved.
    expect((await getMemberProfileState(db, accountId, memberId))!.revision).toBe(2);
    expect((await getMemberProfileState(db, accountId, memberId))!.profile).toMatchObject({
      enabled: false,
    });
  });

  it('says 404 for a member who does not exist, 409 for one who moved', async () => {
    expect(await casSetMemberProfile(db, accountId, randomUUID(), page(true), 0)).toEqual({
      status: 'not_found',
    });

    await casSetMemberProfile(db, accountId, memberId, page(true), 0);
    expect(await casSetMemberProfile(db, accountId, memberId, page(false), 0)).toMatchObject({
      status: 'conflict',
    });
  });

  it('never writes or reveals a member through the wrong account', async () => {
    await casSetMemberProfile(db, accountId, memberId, page(true), 0);

    // Same member id, different account: not a conflict — invisible.
    expect(await casSetMemberProfile(db, otherAccountId, memberId, page(false), 1)).toEqual({
      status: 'not_found',
    });
    expect(await fenceMemberProfile(db, otherAccountId, memberId, 1)).toEqual({
      status: 'not_found',
    });
    expect(await getMemberProfileState(db, otherAccountId, memberId)).toBeNull();
    // Untouched by the attempts above.
    expect((await getMemberProfileState(db, accountId, memberId))!.revision).toBe(1);
  });
});

describe('the fence', () => {
  it('advances the revision without touching the page', async () => {
    await casSetMemberProfile(db, accountId, memberId, page(true, 'Before'), 0);

    const fenced = await fenceMemberProfile(db, accountId, memberId, 1);

    expect(fenced).toMatchObject({ status: 'ok', revision: 2 });
    expect((fenced as { profile: { headline: string } }).profile.headline).toBe('Before');
    expect((await getMemberProfileState(db, accountId, memberId))!.profile).toMatchObject({
      enabled: true,
      headline: 'Before',
    });
  });

  it('fences a pre-0016 row too', async () => {
    await makeLegacy(memberId);

    expect(await fenceMemberProfile(db, accountId, memberId, 0)).toMatchObject({
      status: 'ok',
      revision: 1,
      profile: null,
    });
  });

  it('is idempotent when repeated with the SAME original expectation', async () => {
    await casSetMemberProfile(db, accountId, memberId, page(true), 0); // -> 1

    const first = await fenceMemberProfile(db, accountId, memberId, 1);
    expect(first).toMatchObject({ status: 'ok', revision: 2 });

    // "Check again" re-uses the original expectation. It must not advance the
    // counter a second time, or every retry would look like a new writer.
    for (let i = 0; i < 3; i += 1) {
      expect(await fenceMemberProfile(db, accountId, memberId, 1)).toMatchObject({
        status: 'conflict',
        revision: 2,
      });
    }
    expect((await getMemberProfileState(db, accountId, memberId))!.revision).toBe(2);
  });

  it('blocks the write it fenced: that expectation can never land again', async () => {
    await casSetMemberProfile(db, accountId, memberId, page(true), 0); // -> 1
    await fenceMemberProfile(db, accountId, memberId, 1); // -> 2

    // This is the ambiguous save arriving late. It is refused, exactly as the
    // fence promised the browser it would be.
    expect(await casSetMemberProfile(db, accountId, memberId, page(false), 1)).toMatchObject({
      status: 'conflict',
      revision: 2,
    });
  });
});

describe('the deprecated v1 shim writer', () => {
  it('cannot compare, but still increments atomically with its write', async () => {
    await casSetMemberProfile(db, accountId, memberId, page(true), 0); // -> 1

    const legacy = await overwriteMemberProfileLegacy(db, accountId, memberId, page(false));

    expect(legacy).toMatchObject({ status: 'ok', revision: 2 });
    expect((await getMemberProfileState(db, accountId, memberId))!.profile).toMatchObject({
      enabled: false,
    });
  });

  it('keeps the fence decidable: a fence after a shim write conflicts', async () => {
    await overwriteMemberProfileLegacy(db, accountId, memberId, page(true)); // -> 1

    expect(await fenceMemberProfile(db, accountId, memberId, 0)).toMatchObject({
      status: 'conflict',
      revision: 1,
    });
  });

  it('is account-scoped like everything else', async () => {
    expect(await overwriteMemberProfileLegacy(db, otherAccountId, memberId, page(true))).toEqual({
      status: 'not_found',
    });
  });
});

describe('revision normalization', () => {
  it('accepts what a driver may hand back for an integer column', () => {
    // postgres-js can return integer columns as strings depending on driver
    // configuration; SQLite hands back a number. Both must compare as numbers.
    expect(normalizeProfileRevision(7)).toBe(7);
    expect(normalizeProfileRevision('7')).toBe(7);
    expect(normalizeProfileRevision(null)).toBe(0);
    expect(normalizeProfileRevision(undefined)).toBe(0);
  });

  it('refuses to reconcile against a value that is not a safe count', () => {
    for (const bad of [-1, 1.5, 'abc', Number.NaN, Number.MAX_SAFE_INTEGER + 1, '9007199254740993']) {
      expect(() => normalizeProfileRevision(bad), String(bad)).toThrow();
    }
  });
});

describe('the writer set is closed', () => {
  it('has no profile writer that skips the revision', () => {
    // The guarantee the fence rests on: nothing moves `profile` without moving
    // `profile_revision` in the same statement.
    const source = readFileSync(fileURLToPath(new URL('./members.ts', import.meta.url)), 'utf8');
    const writes = source.split('UPDATE member').slice(1);
    const profileWrites = writes.filter((stmt) => /SET[\s\S]{0,120}?profile\s*=/.test(stmt));

    expect(profileWrites).toHaveLength(2); // CAS + the deprecated shim
    for (const stmt of profileWrites) {
      expect(stmt).toContain('profile_revision = coalesce(profile_revision, 0) + 1');
    }
    // And every revision increment goes through coalesce, never a bare +1.
    expect(source).not.toMatch(/profile_revision\s*\+\s*1/);
  });
});
