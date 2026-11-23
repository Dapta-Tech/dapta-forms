/**
 * The referral unlock in the data layer (0030, 0032): marking a person
 * unlocked once, hiding the attribution on the workspaces they own that never
 * chose, starting their later workspaces hidden (projection and local create),
 * and the per-workspace read the badge rule uses ("any owner unlocked").
 *
 * In-memory SQLite locally; DATABASE_URL for the Postgres parity job, where
 * `UPDATE ... RETURNING`, the `||` key and the BIGINT columns must agree.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, sql, type Db } from './client';
import { migrate } from './migrate';
import { getAttributionSwitch, setHideAttribution } from './attribution-switch';
import {
  applyReferralUnlock,
  ensureReferrer,
  getReferrer,
  isAccountReferralUnlocked,
  markReferralUnlocked,
} from './referrals';
import { createLocalWorkspace, getAccountByExternalId, projectMemberships } from './workspaces';

const NOW = Date.parse('2026-11-23T15:00:00Z');

let db: Db;
let tag: string;
const accounts: string[] = [];

const person = (name: string) => `user_${name}_${tag}`;

async function workspace(): Promise<string> {
  const id = randomUUID();
  accounts.push(id);
  await db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${id}, ${`t-${id}`}, ${'ws'}, ${NOW})`);
  return id;
}

async function member(
  accountId: string,
  opts: {
    externalId?: string | null;
    email?: string;
    role?: 'owner' | 'admin' | 'member';
    status?: 'active' | 'invited' | 'disabled';
    accessGrant?: 'staff';
  },
): Promise<void> {
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, external_id, access_grant, created_at)
        VALUES (${randomUUID()}, ${accountId}, ${opts.email ?? `m-${randomUUID()}@example.com`}, ${opts.role ?? 'owner'},
          ${opts.status ?? 'active'}, ${opts.externalId ?? null}, ${opts.accessGrant ?? null}, ${NOW})`,
  );
}

async function unlock(personId: string): Promise<void> {
  await ensureReferrer(db, personId, { now: NOW });
  await markReferralUnlocked(db, personId, NOW);
}

const hidden = async (accountId: string) => (await getAttributionSwitch(db, accountId))!.hideAttribution;

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  tag = randomUUID().slice(0, 8);
});

afterEach(async () => {
  await db.run(sql`DELETE FROM referrer WHERE person_id LIKE ${`%${tag}%`}`);
  for (const id of accounts.splice(0)) {
    await db.run(sql`DELETE FROM member WHERE account_id = ${id}`);
    await db.run(sql`DELETE FROM account WHERE id = ${id}`);
  }
  await db.close();
});

describe('markReferralUnlocked', () => {
  it('writes the unlock once: only the first call answers true', async () => {
    await ensureReferrer(db, person('ana'), { now: NOW });
    expect(await markReferralUnlocked(db, person('ana'), NOW)).toBe(true);
    expect(await markReferralUnlocked(db, person('ana'), NOW + 1000)).toBe(false);
    expect((await getReferrer(db, person('ana')))!.unlockedAt).toBe(NOW);
  });

  it('writes nothing for a person with no referrer row', async () => {
    expect(await markReferralUnlocked(db, person('nobody'), NOW)).toBe(false);
    expect(await getReferrer(db, person('nobody'))).toBeNull();
  });
});

describe('applyReferralUnlock', () => {
  it('hides the owned workspaces that never chose, and nothing else', async () => {
    const owned = await workspace();
    const chose = await workspace();
    const asAdmin = await workspace();
    const invited = await workspace();
    const granted = await workspace();
    const disabled = await workspace();
    await member(owned, { externalId: person('ana') });
    await member(chose, { externalId: person('ana') });
    await member(asAdmin, { externalId: person('ana'), role: 'admin' });
    await member(invited, { email: `ana-${tag}@example.com`, status: 'invited' });
    await member(granted, { externalId: person('ana'), accessGrant: 'staff' });
    await member(disabled, { externalId: person('ana'), status: 'disabled' });
    await setHideAttribution(db, chose, false, NOW);
    await unlock(person('ana'));

    expect(await applyReferralUnlock(db, person('ana'))).toEqual([owned]);
    for (const id of [chose, asAdmin, invited, granted, disabled]) expect(await hidden(id)).toBe(false);
    expect(await hidden(owned)).toBe(true);
    // It acts for the workspace: the choice stays unmade, so a later save still wins.
    expect((await getAttributionSwitch(db, owned))!.chosenAt).toBeNull();
    // Idempotent: nothing left to hide.
    expect(await applyReferralUnlock(db, person('ana'))).toEqual([]);
  });

  it('changes nothing for a person who is not unlocked', async () => {
    const owned = await workspace();
    await member(owned, { externalId: person('ben') });
    await ensureReferrer(db, person('ben'), { now: NOW });
    expect(await applyReferralUnlock(db, person('ben'))).toEqual([]);
    expect(await hidden(owned)).toBe(false);
  });

  it('narrows to one workspace when asked', async () => {
    const a = await workspace();
    const b = await workspace();
    await member(a, { externalId: person('cy') });
    await member(b, { externalId: person('cy') });
    await unlock(person('cy'));
    expect(await applyReferralUnlock(db, person('cy'), { accountId: b })).toEqual([b]);
    expect(await hidden(a)).toBe(false);
  });

  it('a local development person (email key) owns by email on rows with no id', async () => {
    const mine = await workspace();
    await member(mine, { email: `Dev-${tag}@Example.com` });
    const key = `email:dev-${tag}@example.com`;
    await unlock(key);
    expect(await applyReferralUnlock(db, key)).toEqual([mine]);
  });
});

describe('isAccountReferralUnlocked', () => {
  it('is true when any active owner holds an unlock, with no expiry', async () => {
    const ws = await workspace();
    await member(ws, { externalId: person('dan') });
    await member(ws, { externalId: person('eve') });
    expect(await isAccountReferralUnlocked(db, ws)).toBe(false);
    await unlock(person('eve'));
    expect(await isAccountReferralUnlocked(db, ws)).toBe(true);
  });

  it('an unlocked admin, member, invitation or staff grant does not unlock the workspace', async () => {
    const ws = await workspace();
    await member(ws, { externalId: person('fay'), role: 'admin' });
    await member(ws, { externalId: person('gus'), role: 'member' });
    await member(ws, { externalId: person('hal'), accessGrant: 'staff' });
    await member(ws, { externalId: person('ida'), status: 'disabled' });
    for (const n of ['fay', 'gus', 'hal', 'ida']) await unlock(person(n));
    expect(await isAccountReferralUnlocked(db, ws)).toBe(false);
  });

  it('reads a local development owner by email', async () => {
    const ws = await workspace();
    await member(ws, { email: `Jo-${tag}@example.com` });
    await unlock(`email:jo-${tag}@example.com`);
    expect(await isAccountReferralUnlocked(db, ws)).toBe(true);
  });
});

describe('a workspace created after the unlock starts hidden', () => {
  it('through the projection, for its owner only', async () => {
    await unlock(person('kim'));
    const owned = `ws-owned-${tag}`;
    const joined = `ws-joined-${tag}`;
    await projectMemberships(
      db,
      { externalId: person('kim'), email: `kim-${tag}@example.com`, displayName: 'Kim' },
      [
        { workspaceId: owned, workspaceName: 'Mine', iamAccountId: null, workspaceUserId: null, role: 'owner', active: true },
        { workspaceId: joined, workspaceName: 'Theirs', iamAccountId: null, workspaceUserId: null, role: 'member', active: true },
      ],
      { now: NOW },
    );
    const mine = (await getAccountByExternalId(db, owned))!.id;
    const theirs = (await getAccountByExternalId(db, joined))!.id;
    accounts.push(mine, theirs);
    expect(await hidden(mine)).toBe(true);
    expect(await hidden(theirs)).toBe(false);
  });

  it('through a local create', async () => {
    await unlock(person('lea'));
    const { accountId } = await createLocalWorkspace(
      db,
      { externalId: person('lea'), email: `lea-${tag}@example.com`, displayName: 'Lea' },
      { name: 'Later', now: NOW },
    );
    accounts.push(accountId);
    expect(await hidden(accountId)).toBe(true);
  });

  it('a person without an unlock gets a workspace that shows it, as before', async () => {
    const { accountId } = await createLocalWorkspace(
      db,
      { externalId: person('max'), email: `max-${tag}@example.com`, displayName: 'Max' },
      { name: 'Plain', now: NOW },
    );
    accounts.push(accountId);
    expect(await hidden(accountId)).toBe(false);
  });
});
