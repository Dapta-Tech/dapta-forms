/**
 * The 7-day nudge's once-per-person stamp (`referrer.nudge_sent_at`, 0030):
 * one guarded UPDATE takes it only while the nudge still applies, and a
 * failed send can give back exactly the stamp it took.
 *
 * In-memory SQLite locally; DATABASE_URL for the Postgres parity job, where
 * the `COUNT(*)` comparison, `UPDATE ... RETURNING` and BIGINT must agree.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, sql, type Db } from './client';
import { migrate } from './migrate';
import { claimReferralNudge, referralNudgeSent, releaseReferralNudge } from './referral-nudge';
import { ensureReferrer, markReferralUnlocked } from './referrals';

const NOW = Date.parse('2026-11-30T15:00:00Z');

let db: Db;
let tag: string;

const ana = () => `user_ana_${tag}`;

async function referrals(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await db.run(
      sql`INSERT INTO referral (referee_person_id, referrer_person_id, source, created_at)
          VALUES (${`user_friend${i}_${tag}`}, ${ana()}, 'link', ${NOW})`,
    );
  }
}

const claim = (count: number, now = NOW) => claimReferralNudge(db, { person: ana(), count, goal: 5, now });

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  tag = randomUUID().slice(0, 8);
  await ensureReferrer(db, ana(), { now: NOW });
});

afterEach(async () => {
  await db.run(sql`DELETE FROM referral WHERE referrer_person_id = ${ana()}`);
  await db.run(sql`DELETE FROM referrer WHERE person_id = ${ana()}`);
  await db.close();
});

describe('claimReferralNudge', () => {
  it('takes the nudge once: only the first call answers true', async () => {
    await referrals(2);
    expect(await referralNudgeSent(db, ana())).toBe(false);
    const [first, second] = await Promise.all([claim(2), claim(2)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await claim(2)).toBe(false);
    expect(await referralNudgeSent(db, ana())).toBe(true);
  });

  it('refuses when the count moved on since it was scheduled', async () => {
    await referrals(3);
    expect(await claim(2)).toBe(false);
    expect(await claim(3)).toBe(true);
  });

  it('refuses at 0 and at the goal', async () => {
    expect(await claim(0)).toBe(false);
    await referrals(5);
    expect(await claim(5)).toBe(false);
  });

  it('refuses a person holding a referral unlock', async () => {
    await referrals(4);
    await markReferralUnlocked(db, ana(), NOW);
    expect(await claim(4)).toBe(false);
  });

  it('refuses a person with no referrer row', async () => {
    expect(await claimReferralNudge(db, { person: `user_nobody_${tag}`, count: 1, goal: 5, now: NOW })).toBe(false);
  });
});

describe('releaseReferralNudge', () => {
  it('gives back the stamp it took, so a retry can take it again', async () => {
    await referrals(1);
    expect(await claim(1)).toBe(true);
    await releaseReferralNudge(db, ana(), NOW);
    expect(await referralNudgeSent(db, ana())).toBe(false);
    expect(await claim(1, NOW + 1000)).toBe(true);
  });

  it('never clears a stamp another attempt wrote', async () => {
    await referrals(1);
    expect(await claim(1, NOW + 1000)).toBe(true);
    await releaseReferralNudge(db, ana(), NOW);
    expect(await referralNudgeSent(db, ana())).toBe(true);
  });
});
