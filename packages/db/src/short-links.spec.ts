import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { isShortCode } from '@slate/engine';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { seed } from './seed';
import { sql } from 'drizzle-orm';
import { getAccountByCode, getPublicProfile } from './repository';
import { getMe, getTeamProfile } from './parity';
import { inviteMember } from './members';
import {
  applyShortLinkFixups,
  backfillAccountShortCodes,
  canonicalPublicCode,
  deriveUniqueHandle,
  generateUniqueShortCode,
  publicCodeInUse,
  setVanitySlug,
} from './short-links';

describe('short links (SQLite in-memory)', () => {
  let db: Db;
  let accountId: string;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code='acme'`))!.id;
  });

  // --- Generation + collision retry ----------------------------------------

  it('generateUniqueShortCode retries past collisions (codes, vanities, aliases, reserved)', async () => {
    await db.run(sql`UPDATE account SET vanity_slug = ${'v4nity'} WHERE id = ${accountId}`);
    await db.run(
      sql`INSERT INTO account_alias (alias, account_id, created_at) VALUES (${'al1as9'}, ${accountId}, ${Date.now()})`,
    );
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at) VALUES (${randomUUID()}, ${'c0ll1d'}, ${'X'}, ${Date.now()})`,
    );
    // Deterministic candidate stream: reserved word → taken code → taken vanity
    // → taken alias → finally a free one. The generator must land on the last.
    const stream = ['signup', 'c0ll1d', 'v4nity', 'al1as9', 'fr33ok'];
    let i = 0;
    const code = await generateUniqueShortCode(db, () => stream[Math.min(i++, stream.length - 1)]!);
    expect(code).toBe('fr33ok');
    expect(i).toBeGreaterThanOrEqual(4);
  });

  it('exhausted retries throw instead of looping forever', async () => {
    await expect(generateUniqueShortCode(db, () => 'acme')).rejects.toThrow(/exhausted/);
  });

  // --- Resolution: short code | vanity | legacy alias -----------------------

  it('getAccountByCode resolves canonical code, vanity, and alias to the same account', async () => {
    await db.run(sql`UPDATE account SET vanity_slug = ${'acme-inc'} WHERE id = ${accountId}`);
    await db.run(
      sql`INSERT INTO account_alias (alias, account_id, created_at)
          VALUES (${'acct-deadbeef'}, ${accountId}, ${Date.now()})`,
    );
    for (const key of ['acme', 'acme-inc', 'acct-deadbeef', 'ACME-INC']) {
      const acc = await getAccountByCode(db, key);
      expect(acc?.id).toBe(accountId);
    }
    expect(canonicalPublicCode((await getAccountByCode(db, 'acct-deadbeef'))!)).toBe('acme-inc');
    expect(await getAccountByCode(db, 'nosuch')).toBeUndefined();
  });

  it('publicCodeInUse sees codes, vanities, and aliases; excludes the owner itself', async () => {
    await db.run(sql`UPDATE account SET vanity_slug = ${'acme-inc'} WHERE id = ${accountId}`);
    expect(await publicCodeInUse(db, 'acme')).toBe(true);
    expect(await publicCodeInUse(db, 'acme-inc')).toBe(true);
    expect(await publicCodeInUse(db, 'acme-inc', accountId)).toBe(false);
    expect(await publicCodeInUse(db, 'free-slug')).toBe(false);
  });

  // --- Backfills (the migrate() data fixups) --------------------------------

  it('re-codes legacy acct-/dev- accounts and keeps the old code as an alias', async () => {
    const legacyId = randomUUID();
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at)
          VALUES (${legacyId}, ${'acct-d3466b0b3ef84267a053'}, ${'Legacy'}, ${Date.now()})`,
    );
    const devId = randomUUID();
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at)
          VALUES (${devId}, ${'dev-taylor-example-com'}, ${'Dev'}, ${Date.now()})`,
    );
    await backfillAccountShortCodes(db);

    for (const [id, legacy] of [
      [legacyId, 'acct-d3466b0b3ef84267a053'],
      [devId, 'dev-taylor-example-com'],
    ] as const) {
      const acc = await db.get<{ code: string }>(sql`SELECT code FROM account WHERE id = ${id}`);
      expect(isShortCode(acc!.code)).toBe(true);
      // The legacy code still resolves (alias) — no broken links.
      expect((await getAccountByCode(db, legacy))?.id).toBe(id);
    }
    // The pretty seeded code is untouched.
    expect((await db.get<{ code: string }>(sql`SELECT code FROM account WHERE id = ${accountId}`))!.code).toBe('acme');
    // Idempotent: a second run changes nothing.
    const before = await db.all<{ code: string }>(sql`SELECT code FROM account ORDER BY code`);
    await backfillAccountShortCodes(db);
    expect(await db.all(sql`SELECT code FROM account ORDER BY code`)).toEqual(before);
  });

  it('backfills handles for handle-less members with collision suffixing', async () => {
    for (const name of ['Felipe Gomez', 'Fernanda Gomez']) {
      await db.run(
        sql`INSERT INTO member (id, account_id, display_name, email, created_at)
            VALUES (${randomUUID()}, ${accountId}, ${name}, ${null}, ${Date.now()})`,
      );
    }
    await applyShortLinkFixups(db);
    const handles = (
      await db.all<{ handle: string | null }>(
        sql`SELECT handle FROM member WHERE account_id = ${accountId} AND display_name LIKE '%Gomez'
            ORDER BY created_at ASC, id ASC`,
      )
    ).map((r) => r.handle);
    expect(handles).toEqual(['fgomez', 'fgomez2']);
    const bare = await db.get<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM member WHERE handle IS NULL OR handle = ''`,
    );
    expect(Number(bare!.n)).toBe(0);
  });

  // --- Auto-handles at creation ----------------------------------------------

  it('deriveUniqueHandle suffixes within the account and skips reserved words', async () => {
    expect(await deriveUniqueHandle(db, accountId, 'Alex Rivera', null)).toBe('arivera');
    await db.run(
      sql`INSERT INTO member (id, account_id, handle, created_at)
          VALUES (${randomUUID()}, ${accountId}, ${'arivera'}, ${Date.now()})`,
    );
    expect(await deriveUniqueHandle(db, accountId, 'Alex Rivera', null)).toBe('arivera2');
    // 'admin' is a reserved route word — the bare candidate is skipped entirely.
    expect(await deriveUniqueHandle(db, accountId, null, 'admin@example.com')).toBe('admin2');
  });

  it('inviteMember assigns a handle immediately', async () => {
    const out = await inviteMember(db, accountId, { email: 'sam.guest@example.com' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.handle).toBe('samguest');
  });

  // --- Vanity slug ------------------------------------------------------------

  it('setVanitySlug validates shape, reserved words, and global uniqueness', async () => {
    expect(await setVanitySlug(db, accountId, 'ab')).toEqual({ ok: false, reason: 'invalid' });
    expect(await setVanitySlug(db, accountId, 'admin')).toEqual({ ok: false, reason: 'reserved' });
    const other = randomUUID();
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at) VALUES (${other}, ${'zzz999'}, ${'Z'}, ${Date.now()})`,
    );
    expect(await setVanitySlug(db, accountId, 'zzz999')).toEqual({ ok: false, reason: 'taken' });
    expect(await setVanitySlug(db, accountId, 'Acme-Inc')).toEqual({ ok: true, vanitySlug: 'acme-inc' });
  });

  it('replacing/clearing a vanity keeps the old one resolving (alias) — no broken links', async () => {
    await setVanitySlug(db, accountId, 'acme-inc');
    await setVanitySlug(db, accountId, 'acme-corp');
    expect((await getAccountByCode(db, 'acme-inc'))?.id).toBe(accountId);
    expect(canonicalPublicCode((await getAccountByCode(db, 'acme-inc'))!)).toBe('acme-corp');
    await setVanitySlug(db, accountId, null);
    expect((await getAccountByCode(db, 'acme-corp'))?.id).toBe(accountId);
    expect(canonicalPublicCode((await getAccountByCode(db, 'acme-corp'))!)).toBe('acme');
  });

  // --- Canonical emission -------------------------------------------------------

  it('profiles and /me emit the canonical code (vanity ?? short) even when queried by alias', async () => {
    await setVanitySlug(db, accountId, 'acme-inc');
    const profile = await getPublicProfile(db, 'acme', 'alex-rivera');
    expect(profile!.account.code).toBe('acme-inc');
    const team = await getTeamProfile(db, 'acme', 'sales');
    expect(team!.account.code).toBe('acme-inc');
    const me = await getMe(db, accountId);
    expect(me!.accountCode).toBe('acme-inc');
    expect(me!.accountShortCode).toBe('acme');
    expect(me!.vanitySlug).toBe('acme-inc');
  });
});
