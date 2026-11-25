/**
 * Referrer browsers (0034): the browsers each person was seen in, and the
 * same-browser refusal `creditReferralVerdict` applies with them.
 *
 * Defaults to a temp SQLite file; CI runs the identical assertions against
 * DATABASE_URL on Postgres, where the composite-key upsert with a guarded
 * `DO UPDATE ... WHERE`, `RETURNING` and the capped delete must mean the same
 * thing.
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
  REFERRER_BROWSER_CAP,
  REFERRER_BROWSER_REFRESH_MS,
  personBrowserSeen,
  recordPersonBrowser,
} from './referral-browsers';
import { countReferrals, creditReferral, creditReferralVerdict } from './referrals';

const NOW = Date.parse('2026-11-25T15:00:00Z');

let db: Db;
let sqliteDir: string | undefined;
/** Unique per test, so a shared Postgres never sees another run's rows. */
let tag: string;
const accounts: string[] = [];

const person = (name: string) => `user_${name}_${tag}`;
const hash = (name: string) => `${name}-${tag}`.padEnd(64, '0');

async function member(name: string, createdAt = NOW): Promise<void> {
  const accountId = randomUUID();
  accounts.push(accountId);
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at) VALUES (${accountId}, ${`ws-${accountId}`}, ${'ws'}, ${NOW})`,
  );
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, external_id, created_at)
        VALUES (${randomUUID()}, ${accountId}, ${`${name}-${tag}@example.com`}, ${'owner'}, ${'active'},
          ${person(name)}, ${createdAt})`,
  );
}

async function rowsOf(name: string) {
  const rows = await db.all<{ browser_hash: string; first_seen_at: number | string; last_seen_at: number | string }>(
    sql`SELECT browser_hash, first_seen_at, last_seen_at FROM referrer_browser
        WHERE person_id = ${person(name)} ORDER BY last_seen_at DESC`,
  );
  return rows.map((r) => ({ hash: r.browser_hash, first: Number(r.first_seen_at), last: Number(r.last_seen_at) }));
}

beforeEach(async () => {
  const databaseUrl =
    process.env.DATABASE_URL ?? `file:${join(await mkdtemp(join(tmpdir(), 'quill-referrer-browsers-')), 'forms.db')}`;
  if (!process.env.DATABASE_URL) sqliteDir = join(databaseUrl.slice('file:'.length), '..');
  db = await createDb(databaseUrl);
  await migrate(db);
  tag = randomUUID().slice(0, 8);
});

afterEach(async () => {
  if (db) {
    await db.run(sql`DELETE FROM referrer_browser WHERE person_id LIKE ${`%${tag}%`}`);
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

describe('recordPersonBrowser', () => {
  it('records a browser once per person, and personBrowserSeen finds it', async () => {
    expect(await recordPersonBrowser(db, { person: person('ana'), browserHash: hash('a'), now: NOW })).toBe(true);
    expect(await recordPersonBrowser(db, { person: person('ana'), browserHash: hash('a'), now: NOW + 1 })).toBe(false);
    expect(await rowsOf('ana')).toEqual([{ hash: hash('a'), first: NOW, last: NOW }]);
    expect(await personBrowserSeen(db, person('ana'), hash('a'))).toBe(true);
    expect(await personBrowserSeen(db, person('ana'), hash('b'))).toBe(false);
    expect(await personBrowserSeen(db, person('bea'), hash('a'))).toBe(false);
  });

  it('refreshes last_seen_at at most once per refresh window, keeping first_seen_at', async () => {
    await recordPersonBrowser(db, { person: person('ana'), browserHash: hash('a'), now: NOW });
    const later = NOW + REFERRER_BROWSER_REFRESH_MS + 1;
    expect(await recordPersonBrowser(db, { person: person('ana'), browserHash: hash('a'), now: later })).toBe(true);
    expect(await rowsOf('ana')).toEqual([{ hash: hash('a'), first: NOW, last: later }]);
  });

  it('two people in one browser each get their row (a shared computer)', async () => {
    await recordPersonBrowser(db, { person: person('ana'), browserHash: hash('a'), now: NOW });
    await recordPersonBrowser(db, { person: person('bea'), browserHash: hash('a'), now: NOW });
    expect(await personBrowserSeen(db, person('ana'), hash('a'))).toBe(true);
    expect(await personBrowserSeen(db, person('bea'), hash('a'))).toBe(true);
  });

  it(`keeps only the ${REFERRER_BROWSER_CAP} most recently seen browsers of a person`, async () => {
    for (let i = 0; i < REFERRER_BROWSER_CAP + 3; i++) {
      await recordPersonBrowser(db, { person: person('ana'), browserHash: hash(`b${i}`), now: NOW + i });
    }
    const rows = await rowsOf('ana');
    expect(rows).toHaveLength(REFERRER_BROWSER_CAP);
    // The three oldest went, the newest stayed.
    expect(rows.map((r) => r.hash)).not.toContain(hash('b0'));
    expect(rows.map((r) => r.hash)).not.toContain(hash('b2'));
    expect(rows[0]!.hash).toBe(hash(`b${REFERRER_BROWSER_CAP + 2}`));
    // Another person's rows are untouched by the cap.
    await recordPersonBrowser(db, { person: person('bea'), browserHash: hash('x'), now: NOW });
    expect(await rowsOf('bea')).toHaveLength(1);
  });
});

describe('creditReferralVerdict: the same-browser rule', () => {
  it('refuses a new person whose browser the referrer was seen in', async () => {
    await member('ana', NOW - 30 * 86_400_000);
    await member('bea');
    await recordPersonBrowser(db, { person: person('ana'), browserHash: hash('chrome'), now: NOW - 1000 });
    expect(
      await creditReferralVerdict(db, {
        referee: person('bea'),
        referrer: person('ana'),
        source: 'link',
        now: NOW,
        browserHash: hash('chrome'),
      }),
    ).toEqual({ credited: false, reason: 'same_browser' });
    expect(await countReferrals(db, person('ana'))).toBe(0);
  });

  it('credits a new person in a browser the referrer was never seen in', async () => {
    await member('ana', NOW - 30 * 86_400_000);
    await member('bea');
    await recordPersonBrowser(db, { person: person('ana'), browserHash: hash('chrome'), now: NOW - 1000 });
    expect(
      await creditReferralVerdict(db, {
        referee: person('bea'),
        referrer: person('ana'),
        source: 'link',
        now: NOW,
        browserHash: hash('firefox'),
      }),
    ).toEqual({ credited: true });
    expect(await countReferrals(db, person('ana'))).toBe(1);
  });

  it('without a browser (no cookie) the rule is not asked', async () => {
    await member('ana', NOW - 30 * 86_400_000);
    await member('bea');
    await recordPersonBrowser(db, { person: person('ana'), browserHash: hash('chrome'), now: NOW - 1000 });
    expect(
      await creditReferral(db, { referee: person('bea'), referrer: person('ana'), source: 'link', now: NOW }),
    ).toBe(true);
  });

  it('the other refusals come first, so a same-browser count only holds real attempts', async () => {
    await member('ana', NOW - 30 * 86_400_000);
    await member('old', NOW - 30 * 86_400_000);
    await recordPersonBrowser(db, { person: person('ana'), browserHash: hash('chrome'), now: NOW - 1000 });
    const input = { referrer: person('ana'), source: 'link' as const, now: NOW, browserHash: hash('chrome') };
    expect(await creditReferralVerdict(db, { ...input, referee: person('ana') })).toEqual({
      credited: false,
      reason: 'self_referral',
    });
    expect(await creditReferralVerdict(db, { ...input, referee: person('old') })).toEqual({
      credited: false,
      reason: 'not_new',
    });
    // Already credited to someone else: that is the answer, not the browser.
    await member('bea');
    await member('hal', NOW - 30 * 86_400_000);
    expect(
      await creditReferral(db, { referee: person('bea'), referrer: person('hal'), source: 'link', now: NOW }),
    ).toBe(true);
    expect(await creditReferralVerdict(db, { ...input, referee: person('bea') })).toEqual({
      credited: false,
      reason: 'already_credited',
    });
  });
});
