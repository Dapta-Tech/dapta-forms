/**
 * Referrals (0031): crediting one new person to one referrer, the first
 * credit winning, and the count a referrer sees.
 *
 * Defaults to a temp SQLite file; CI runs the identical assertions against
 * DATABASE_URL on Postgres, which is where `ON CONFLICT DO NOTHING RETURNING`,
 * the BIGINT count and the staff-grant filter have to mean the same thing.
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
  REFERRAL_CLAIM_WINDOW_MS,
  countReferrals,
  creditReferral,
  ensureReferrer,
  getReferrerByCode,
  isNewPerson,
} from './referrals';

const NOW = Date.parse('2026-11-23T15:00:00Z');
const MIN = 60_000;

let db: Db;
let sqliteDir: string | undefined;
/** Unique per test, so a shared Postgres never sees another run's rows. */
let tag: string;
const accounts: string[] = [];

const person = (name: string) => `user_${name}_${tag}`;

async function member(
  name: string,
  opts: { createdAt?: number; accessGrant?: 'staff'; email?: string; externalId?: string | null } = {},
): Promise<void> {
  const accountId = randomUUID();
  accounts.push(accountId);
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at) VALUES (${accountId}, ${`ws-${accountId}`}, ${'ws'}, ${NOW})`,
  );
  const externalId = opts.externalId === undefined ? person(name) : opts.externalId;
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, external_id, access_grant, created_at)
        VALUES (${randomUUID()}, ${accountId}, ${opts.email ?? `${name}-${tag}@example.com`}, ${'owner'}, ${'active'},
          ${externalId}, ${opts.accessGrant ?? null}, ${opts.createdAt ?? NOW})`,
  );
}

beforeEach(async () => {
  const databaseUrl =
    process.env.DATABASE_URL ?? `file:${join(await mkdtemp(join(tmpdir(), 'quill-referrals-')), 'forms.db')}`;
  if (!process.env.DATABASE_URL) sqliteDir = join(databaseUrl.slice('file:'.length), '..');
  db = await createDb(databaseUrl);
  await migrate(db);
  tag = randomUUID().slice(0, 8);
});

afterEach(async () => {
  if (db) {
    await db.run(sql`DELETE FROM referral WHERE referee_person_id LIKE ${`%${tag}%`}`);
    await db.run(sql`DELETE FROM referrer WHERE person_id LIKE ${`%${tag}%`}`);
    for (const id of accounts.splice(0)) {
      await db.run(sql`DELETE FROM member WHERE account_id = ${id}`);
      await db.run(sql`DELETE FROM account WHERE id = ${id}`);
    }
  }
  await db?.close();
  if (sqliteDir) await rm(sqliteDir, { recursive: true, force: true });
  sqliteDir = undefined;
});

describe('creditReferral', () => {
  it('credits a new person once: the first credit wins and the count is a number', async () => {
    await member('ana', { createdAt: NOW - 30 * 24 * 60 * MIN });
    await member('hal', { createdAt: NOW - 30 * 24 * 60 * MIN });
    await member('ben');
    const link = { referee: person('ben'), source: 'link' as const, now: NOW + MIN };
    expect(await creditReferral(db, { ...link, referrer: person('ana') })).toBe(true);
    expect(await creditReferral(db, { ...link, referrer: person('hal') })).toBe(false);
    expect(await creditReferral(db, { ...link, referrer: person('ana') })).toBe(false);
    expect(await countReferrals(db, person('ana'))).toBe(1);
    expect(await countReferrals(db, person('hal'))).toBe(0);
  });

  it('refuses the same person and the same address', async () => {
    await member('ana', { createdAt: NOW - 60 * MIN, email: `Ana-${tag}@Example.com` });
    await member('ana2', { email: `ana-${tag}@example.com` });
    expect(await creditReferral(db, { referee: person('ana'), referrer: person('ana'), source: 'link', now: NOW })).toBe(
      false,
    );
    expect(await creditReferral(db, { referee: person('ana2'), referrer: person('ana'), source: 'link', now: NOW })).toBe(
      false,
    );
  });

  it('keys a person without a subject by email (local development)', async () => {
    await member('dev', { externalId: null, email: ` Dev-${tag}@Example.com ` });
    await member('ana', { createdAt: NOW - 60 * MIN });
    const referee = `email:dev-${tag}@example.com`;
    expect(await isNewPerson(db, referee, NOW + MIN)).toBe(true);
    expect(await creditReferral(db, { referee, referrer: person('ana'), source: 'link', now: NOW + MIN })).toBe(true);
    expect(await countReferrals(db, person('ana'))).toBe(1);
  });
});

describe('isNewPerson', () => {
  it('is true inside the window after the first member row, false after it', async () => {
    await member('ben');
    expect(await isNewPerson(db, person('ben'), NOW + REFERRAL_CLAIM_WINDOW_MS - 1)).toBe(true);
    expect(await isNewPerson(db, person('ben'), NOW + REFERRAL_CLAIM_WINDOW_MS)).toBe(false);
  });

  it('the OLDEST row decides: a fresh workspace does not make an old person new', async () => {
    await member('dan', { createdAt: NOW - 11 * MIN });
    await member('dan');
    expect(await isNewPerson(db, person('dan'), NOW)).toBe(false);
  });

  it('a staff access grant is no prior account, and alone is nobody', async () => {
    await member('fay', { accessGrant: 'staff', createdAt: NOW - 90 * 24 * 60 * MIN });
    expect(await isNewPerson(db, person('fay'), NOW)).toBe(false);
    await member('fay');
    expect(await isNewPerson(db, person('fay'), NOW)).toBe(true);
  });

  it('a person with no member row is not new', async () => {
    expect(await isNewPerson(db, person('ghost'), NOW)).toBe(false);
  });
});

describe('getReferrerByCode', () => {
  it('finds the referrer row by its code, and nothing for an unknown one', async () => {
    const row = await ensureReferrer(db, person('ana'), { now: NOW, code: () => `c${tag}` });
    expect(await getReferrerByCode(db, `c${tag}`)).toEqual(row);
    expect(await getReferrerByCode(db, `x${tag}`)).toBeNull();
  });
});
