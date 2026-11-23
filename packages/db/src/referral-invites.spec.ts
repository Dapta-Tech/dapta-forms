/**
 * Referral invites (0033): who invited which address as a teammate, the first
 * inviter keeping it, and the "new person at this sign-in" reads the invite
 * credit relies on.
 *
 * Defaults to a temp SQLite file; CI runs the identical assertions against
 * DATABASE_URL on Postgres, where `ON CONFLICT DO NOTHING RETURNING` on a text
 * key and the staff-grant and status filters have to mean the same thing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import {
  countReferrals,
  creditReferral,
  hasBoundMembership,
  hasSignedInByEmail,
  recordReferralInvite,
  referralInviterOf,
} from './referrals';

const NOW = Date.parse('2026-11-23T15:00:00Z');
const DAY = 24 * 60 * 60_000;

let db: Db;
let sqliteDir: string | undefined;
/** Unique per test, so a shared Postgres never sees another run's rows. */
let tag: string;
const accounts: string[] = [];

const person = (name: string) => `user_${name}_${tag}`;
const email = (name: string) => `${name}-${tag}@example.com`;

async function member(
  name: string,
  opts: { createdAt?: number; accessGrant?: 'staff'; externalId?: string | null; status?: string } = {},
): Promise<string> {
  const accountId = randomUUID();
  accounts.push(accountId);
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at) VALUES (${accountId}, ${`ws-${accountId}`}, ${'ws'}, ${NOW})`,
  );
  const externalId = opts.externalId === undefined ? person(name) : opts.externalId;
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, external_id, access_grant, created_at)
        VALUES (${randomUUID()}, ${accountId}, ${email(name)}, ${'member'}, ${opts.status ?? 'active'},
          ${externalId}, ${opts.accessGrant ?? null}, ${opts.createdAt ?? NOW})`,
  );
  return accountId;
}

beforeEach(async () => {
  const databaseUrl =
    process.env.DATABASE_URL ?? `file:${join(await mkdtemp(join(tmpdir(), 'quill-referral-invites-')), 'forms.db')}`;
  if (!process.env.DATABASE_URL) sqliteDir = join(databaseUrl.slice('file:'.length), '..');
  db = await createDb(databaseUrl);
  await migrate(db);
  tag = randomUUID().slice(0, 8);
});

afterEach(async () => {
  if (db) {
    await db.run(sql`DELETE FROM referral_invite WHERE email LIKE ${`%${tag}%`}`);
    await db.run(sql`DELETE FROM referral WHERE referee_person_id LIKE ${`%${tag}%`}`);
    for (const id of accounts.splice(0)) {
      await db.run(sql`DELETE FROM member WHERE account_id = ${id}`);
      await db.run(sql`DELETE FROM account WHERE id = ${id}`);
    }
  }
  await db?.close();
  if (sqliteDir) await rm(sqliteDir, { recursive: true, force: true });
  sqliteDir = undefined;
});

describe('recordReferralInvite', () => {
  it('keys the address trimmed and lowercased, and the first inviter keeps it', async () => {
    expect(
      await recordReferralInvite(db, { email: `  ${email('Bea').toUpperCase()} `, inviter: person('ana'), accountId: 'a1', now: NOW }),
    ).toBe(true);
    expect(await recordReferralInvite(db, { email: email('bea'), inviter: person('hal'), accountId: 'a2', now: NOW + 1 })).toBe(false);
    expect(await recordReferralInvite(db, { email: email('bea'), inviter: person('ana'), accountId: 'a1', now: NOW + 2 })).toBe(false);
    expect(await referralInviterOf(db, email('BEA'))).toBe(person('ana'));
  });

  it('nobody invited an address: no inviter', async () => {
    expect(await referralInviterOf(db, email('nobody'))).toBeNull();
    expect(await referralInviterOf(db, null)).toBeNull();
  });
});

describe('creditReferral for an invite (newPerson judged by the caller)', () => {
  it('credits a person whose adopted invite row is days old', async () => {
    await member('ana', { createdAt: NOW - 30 * DAY });
    await member('bea', { createdAt: NOW - 5 * DAY });
    expect(
      await creditReferral(db, { referee: person('bea'), referrer: person('ana'), source: 'invite', now: NOW, newPerson: true }),
    ).toBe(true);
    expect(await countReferrals(db, person('ana'))).toBe(1);
  });

  it('still refuses a self-invite and a second credit', async () => {
    await member('ana');
    await member('bea');
    // Another identity on Ana's own address.
    await db.run(
      sql`UPDATE member SET email = ${email('ana')} WHERE external_id = ${person('bea')}`,
    );
    expect(
      await creditReferral(db, { referee: person('bea'), referrer: person('ana'), source: 'invite', now: NOW, newPerson: true }),
    ).toBe(false);
    await member('cid');
    await member('hal');
    expect(await creditReferral(db, { referee: person('cid'), referrer: person('hal'), source: 'link', now: NOW })).toBe(true);
    expect(
      await creditReferral(db, { referee: person('cid'), referrer: person('ana'), source: 'invite', now: NOW, newPerson: true }),
    ).toBe(false);
    expect(await countReferrals(db, person('hal'))).toBe(1);
    expect(await countReferrals(db, person('ana'))).toBe(0);
  });

  it('newPerson false refuses, even inside the link window', async () => {
    await member('ana');
    await member('bea');
    expect(
      await creditReferral(db, { referee: person('bea'), referrer: person('ana'), source: 'invite', now: NOW, newPerson: false }),
    ).toBe(false);
  });
});

describe('hasBoundMembership', () => {
  it('is false for a subject with no row, or only a staff grant', async () => {
    expect(await hasBoundMembership(db, person('bea'))).toBe(false);
    await member('bea', { accessGrant: 'staff' });
    expect(await hasBoundMembership(db, person('bea'))).toBe(false);
  });

  it('is true for any membership, a disabled one included', async () => {
    await member('bea', { status: 'disabled' });
    expect(await hasBoundMembership(db, person('bea'))).toBe(true);
  });
});

describe('hasSignedInByEmail (local development)', () => {
  it('is false while every row of the address is still an invitation', async () => {
    await member('bea', { externalId: null, status: 'invited' });
    expect(await hasSignedInByEmail(db, email('BEA'))).toBe(false);
  });

  it('is true once one of them is more than an invitation', async () => {
    await member('bea', { externalId: null, status: 'invited' });
    await member('bea', { externalId: null, status: 'active' });
    expect(await hasSignedInByEmail(db, email('bea'))).toBe(true);
  });
});
