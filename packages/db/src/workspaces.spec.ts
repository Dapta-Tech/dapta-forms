/**
 * The workspace projection at the data layer, on BOTH dialects: honors
 * DATABASE_URL so the CI parity job re-runs this against real Postgres.
 *
 * What is locked here, worst first:
 *   1. `listWorkspacesForIdentity` runs on Postgres with either key alone (it
 *      used to fail there — "could not determine data type of parameter" — and
 *      only SQLite ever ran it, which the always-on switcher would have found
 *      in production).
 *   2. `projectMemberships` is idempotent and disables only what upstream no
 *      longer names.
 *   3. `projectRoster` never disables a row the identity service does not know
 *      (no upstream membership id) — the owner survives a roster read.
 *   4. `rebindLegacyAccount` keeps the legacy row's id when it can, absorbs an
 *      EMPTY projected row, and parks a legacy row (disabled, renamed) when the
 *      projected one already has forms.
 *   5. `pickHomeAccount` prefers the requested workspace, else most recent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, sql, type Db } from './client';
import { migrate } from './migrate';
import { listMembers, listWorkspacesForIdentity } from './members';
import {
  createLocalWorkspace,
  grantStaffAccess,
  humanHasCompletedOnboarding,
  pickHomeAccount,
  projectMemberships,
  projectRoster,
  rebindLegacyAccount,
  searchProjectedAccounts,
} from './workspaces';

let db: Db;
const SUB = `sub-${randomUUID()}`;
const EMAIL = `${randomUUID().slice(0, 8)}@example.com`;
const created: string[] = [];

async function cleanup() {
  for (const id of created) {
    await db.run(sql`DELETE FROM form WHERE account_id = ${id}`);
    await db.run(sql`DELETE FROM member WHERE account_id = ${id}`);
    await db.run(sql`DELETE FROM account_alias WHERE account_id = ${id}`);
    await db.run(sql`DELETE FROM account WHERE id = ${id}`);
  }
  await db.run(sql`DELETE FROM member WHERE external_id = ${SUB} OR lower(email) = ${EMAIL}`);
  created.length = 0;
}

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
});

afterEach(async () => {
  await cleanup();
  await db.close?.();
});

async function ids(externalIds: string[]) {
  for (const ext of externalIds) {
    const r = await db.get<{ id: string }>(sql`SELECT id FROM account WHERE external_id = ${ext}`);
    if (r) created.push(r.id);
  }
}

describe('listWorkspacesForIdentity (both dialects)', () => {
  it('matches on external_id alone, on email alone, and on both', async () => {
    const ws = `ws-${randomUUID()}`;
    await projectMemberships(
      db,
      { externalId: SUB, email: EMAIL, displayName: 'A' },
      [{ workspaceId: ws, workspaceName: 'W', iamAccountId: 'acct', workspaceUserId: 'wu', role: 'owner', active: true }],
    );
    await ids([ws]);
    expect((await listWorkspacesForIdentity(db, { externalId: SUB, email: null })).length).toBe(1);
    expect((await listWorkspacesForIdentity(db, { externalId: null, email: EMAIL })).length).toBe(1);
    const both = await listWorkspacesForIdentity(db, { externalId: SUB, email: EMAIL });
    expect(both.length).toBe(1);
    // The row carries the upstream workspace id: the id the Dapta estate (and
    // the Account settings URL) knows the workspace by.
    expect(both[0]!.workspaceId).toBe(ws);
    expect((await listWorkspacesForIdentity(db, { externalId: null, email: null })).length).toBe(0);
  });

  it('a local-only account (never projected) lists with workspaceId null', async () => {
    const id = randomUUID();
    created.push(id);
    const now = Date.now();
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at) VALUES (${id}, ${`c${id.slice(0, 8)}`}, 'Local', ${now})`,
    );
    const email = `local-${id.slice(0, 8)}@example.com`;
    await db.run(
      sql`INSERT INTO member (id, account_id, email, role, status, created_at)
          VALUES (${randomUUID()}, ${id}, ${email}, 'owner', 'active', ${now})`,
    );
    const list = await listWorkspacesForIdentity(db, { externalId: null, email });
    expect(list.length).toBe(1);
    expect(list[0]!.workspaceId).toBeNull();
  });
});

describe('projectMemberships', () => {
  it('is idempotent and disables only what upstream stopped naming', async () => {
    const a = `ws-${randomUUID()}`, b = `ws-${randomUUID()}`;
    const identity = { externalId: SUB, email: EMAIL, displayName: 'A' };
    const two = [
      { workspaceId: a, workspaceName: 'A', iamAccountId: 'acct', workspaceUserId: 'wu-a', role: 'owner' as const, active: true },
      { workspaceId: b, workspaceName: 'B', iamAccountId: 'other', workspaceUserId: 'wu-b', role: 'member' as const, active: true },
    ];
    // Rows born before the prune grace window, so the drop below disables.
    const born = Date.now() - 6 * 60_000;
    const first = await projectMemberships(db, identity, two, { now: born });
    await ids([a, b]);
    expect(first.created.length).toBe(2);
    expect(first.createdAccounts.length).toBe(2);
    const second = await projectMemberships(db, identity, two, { now: born });
    expect(second.created.length).toBe(0);
    expect(second.createdAccounts.length).toBe(0);
    // Upstream drops B.
    await projectMemberships(db, identity, [two[0]!]);
    const list = await listWorkspacesForIdentity(db, identity);
    expect(list.map((w) => w.accountName)).toEqual(['A']);
    // memberCount is a NUMBER on both dialects (Postgres hands COUNT(*) back as
    // a bigint string) and counts active rows only.
    expect(list[0]!.memberCount).toBe(1);
    expect(typeof list[0]!.memberCount).toBe('number');
    const bRow = await db.get<{ status: string }>(
      sql`SELECT m.status FROM member m JOIN account acc ON acc.id = m.account_id WHERE acc.external_id = ${b} AND m.external_id = ${SUB}`,
    );
    expect(bRow!.status).toBe('disabled');
  });

  it('spares a freshly written row from the prune (a lagging list is not evidence), but an affirmative inactive membership disables it', async () => {
    const a = `ws-${randomUUID()}`, b = `ws-${randomUUID()}`;
    const identity = { externalId: SUB, email: EMAIL, displayName: 'A' };
    const two = [
      { workspaceId: a, workspaceName: 'A', iamAccountId: 'acct', workspaceUserId: 'wu-a', role: 'owner' as const, active: true },
      { workspaceId: b, workspaceName: 'B', iamAccountId: 'acct', workspaceUserId: 'wu-b', role: 'owner' as const, active: true },
    ];
    await projectMemberships(db, identity, two);
    await ids([a, b]);
    // The next list does not name B, but B's row is minutes old: kept.
    await projectMemberships(db, identity, [two[0]!]);
    let list = await listWorkspacesForIdentity(db, identity);
    expect(list.map((w) => w.accountName).sort()).toEqual(['A', 'B']);
    // The workspace was READ and affirmatively does not name them: disabled now.
    await projectMemberships(db, identity, [two[0]!, { ...two[1]!, active: false }]);
    list = await listWorkspacesForIdentity(db, identity);
    expect(list.map((w) => w.accountName)).toEqual(['A']);
  });

  it('inherits onboarding completion for accounts it creates when asked', async () => {
    const a = `ws-${randomUUID()}`;
    await projectMemberships(db, { externalId: SUB, email: EMAIL, displayName: null }, [
      { workspaceId: a, workspaceName: 'A', iamAccountId: 'acct', workspaceUserId: 'wu', role: 'owner', active: true },
    ]);
    await ids([a]);
    expect(await humanHasCompletedOnboarding(db, SUB)).toBe(false);
    await db.run(sql`UPDATE account SET onboarding_completed_at = 1 WHERE external_id = ${a}`);
    expect(await humanHasCompletedOnboarding(db, SUB)).toBe(true);
    const b = `ws-${randomUUID()}`;
    await projectMemberships(
      db,
      { externalId: SUB, email: EMAIL, displayName: null },
      [
        { workspaceId: a, workspaceName: 'A', iamAccountId: 'acct', workspaceUserId: 'wu', role: 'owner', active: true },
        { workspaceId: b, workspaceName: 'B', iamAccountId: 'acct', workspaceUserId: 'wu2', role: 'owner', active: true },
      ],
      { inheritOnboarding: true },
    );
    await ids([b]);
    const row = await db.get<{ onboarding_completed_at: number | null }>(sql`SELECT onboarding_completed_at FROM account WHERE external_id = ${b}`);
    expect(row!.onboarding_completed_at).not.toBeNull();
  });
});

describe('projectRoster', () => {
  it('never disables a row without an upstream membership id (the owner survives)', async () => {
    const a = `ws-${randomUUID()}`;
    await projectMemberships(db, { externalId: SUB, email: EMAIL, displayName: null }, [
      { workspaceId: a, workspaceName: 'A', iamAccountId: 'acct', workspaceUserId: null, role: 'owner', active: true },
    ]);
    await ids([a]);
    const acc = await db.get<{ id: string }>(sql`SELECT id FROM account WHERE external_id = ${a}`);
    // Upstream lists ONLY a colleague; the owner is absent from users[].
    await projectRoster(db, acc!.id, [
      { externalId: `sub-${randomUUID()}`, email: 'c@example.com', displayName: 'C', role: 'member', active: true, workspaceUserId: 'wu-c' },
    ]);
    const owner = await db.get<{ status: string; role: string }>(sql`SELECT status, role FROM member WHERE account_id = ${acc!.id} AND external_id = ${SUB}`);
    expect(owner!.status).toBe('active');
    expect(owner!.role).toBe('owner');
    // A row upstream DID know (has a membership id) and now omits IS disabled.
    await projectRoster(db, acc!.id, []);
    const c = await db.get<{ status: string }>(sql`SELECT status FROM member WHERE account_id = ${acc!.id} AND lower(email) = 'c@example.com'`);
    expect(c!.status).toBe('disabled');
  });
});

describe('rebindLegacyAccount', () => {
  it('rebinds in place, absorbs an empty projected row, and parks when the projected row has forms', async () => {
    const acct = `acct-${randomUUID()}`, ws = `ws-${randomUUID()}`;
    // Legacy row: external_id = upstream ACCOUNT id.
    const legacyId = randomUUID();
    await db.run(sql`INSERT INTO account (id, code, name, external_id, created_at) VALUES (${legacyId}, ${'l' + legacyId.slice(0, 5)}, 'Old', ${acct}, 1)`);
    created.push(legacyId);
    const r1 = await rebindLegacyAccount(db, { iamAccountId: acct, workspaceId: ws, workspaceName: 'W' });
    expect(r1).toEqual({ accountId: legacyId, parkedLegacyId: null });
    const row = await db.get<{ external_id: string; iam_account_id: string }>(sql`SELECT external_id, iam_account_id FROM account WHERE id = ${legacyId}`);
    expect(row).toEqual({ external_id: ws, iam_account_id: acct });

    // Absorb: a second legacy row and an EMPTY projected row for the same workspace.
    const acct2 = `acct-${randomUUID()}`, ws2 = `ws-${randomUUID()}`;
    const legacy2 = randomUUID(), projected2 = randomUUID();
    await db.run(sql`INSERT INTO account (id, code, name, external_id, created_at) VALUES (${legacy2}, ${'m' + legacy2.slice(0, 5)}, 'Old2', ${acct2}, 1)`);
    await db.run(sql`INSERT INTO account (id, code, name, external_id, created_at) VALUES (${projected2}, ${'p' + projected2.slice(0, 5)}, 'W2', ${ws2}, 2)`);
    created.push(legacy2, projected2);
    const r2 = await rebindLegacyAccount(db, { iamAccountId: acct2, workspaceId: ws2, workspaceName: 'W2' });
    expect(r2).toEqual({ accountId: legacy2, parkedLegacyId: null });
    expect(await db.get(sql`SELECT id FROM account WHERE id = ${projected2}`)).toBeUndefined();

    // Park: the projected row already has a form.
    const acct3 = `acct-${randomUUID()}`, ws3 = `ws-${randomUUID()}`;
    const legacy3 = randomUUID(), projected3 = randomUUID();
    await db.run(sql`INSERT INTO account (id, code, name, external_id, created_at) VALUES (${legacy3}, ${'n' + legacy3.slice(0, 5)}, 'Old3', ${acct3}, 1)`);
    await db.run(sql`INSERT INTO member (id, account_id, external_id, email, handle, role, status, created_at) VALUES (${randomUUID()}, ${legacy3}, ${SUB}, ${EMAIL}, 'h', 'owner', 'active', 1)`);
    await db.run(sql`INSERT INTO account (id, code, name, external_id, created_at) VALUES (${projected3}, ${'q' + projected3.slice(0, 5)}, 'W3', ${ws3}, 2)`);
    await db.run(sql`INSERT INTO form (id, account_id, slug, name, config, created_at, updated_at) VALUES (${randomUUID()}, ${projected3}, 'f', 'F', '{}', 1, 1)`);
    created.push(legacy3, projected3);
    const r3 = await rebindLegacyAccount(db, { iamAccountId: acct3, workspaceId: ws3, workspaceName: 'W3' });
    expect(r3).toEqual({ accountId: projected3, parkedLegacyId: legacy3 });
    const parked = await db.get<{ external_id: string; name: string }>(sql`SELECT external_id, name FROM account WHERE id = ${legacy3}`);
    expect(parked!.external_id).toBe(`legacy:${acct3}`);
    expect(parked!.name).toBe('Old3 (legacy)');
    // Parked = unreachable from the switcher.
    const list = await listWorkspacesForIdentity(db, { externalId: SUB, email: null });
    expect(list.some((w) => w.accountId === legacy3)).toBe(false);
  });
});

describe('pickHomeAccount + createLocalWorkspace', () => {
  it('prefers the requested workspace when the person is an active member of it, else the most recent', async () => {
    const a = `ws-${randomUUID()}`, b = `ws-${randomUUID()}`;
    await projectMemberships(db, { externalId: SUB, email: EMAIL, displayName: null }, [
      { workspaceId: a, workspaceName: 'A', iamAccountId: 'acct', workspaceUserId: 'wu-a', role: 'owner', active: true },
      { workspaceId: b, workspaceName: 'B', iamAccountId: 'acct', workspaceUserId: 'wu-b', role: 'member', active: true },
    ]);
    await ids([a, b]);
    const bAcc = await db.get<{ id: string }>(sql`SELECT id FROM account WHERE external_id = ${b}`);
    expect((await pickHomeAccount(db, SUB, b))!.accountId).toBe(bAcc!.id);
    // A workspace the person is NOT in is ignored, and the fallback is a real membership.
    const fallback = await pickHomeAccount(db, SUB, `ws-${randomUUID()}`);
    expect([a, b]).toContain((await db.get<{ external_id: string }>(sql`SELECT external_id FROM account WHERE id = ${fallback!.accountId}`))!.external_id);
    // Local create: owner row, listed.
    const local = await createLocalWorkspace(db, { externalId: SUB, email: EMAIL, displayName: null }, { name: 'Local' });
    created.push(local.accountId);
    const list = await listWorkspacesForIdentity(db, { externalId: SUB, email: null });
    expect(list.find((w) => w.accountId === local.accountId)!.role).toBe('owner');
  });
});

describe('grantStaffAccess (both dialects)', () => {
  it('mints an admin grant row that is off the roster and count, keeps the owner first for home, and is not pruned', async () => {
    const wsId = `ws-${randomUUID()}`;
    const staff = { externalId: `staff-${randomUUID()}`, email: 's@example.test', displayName: 'S' };
    const staffHome = `ws-${randomUUID()}`;
    // The staff person's own workspace first, then the grant.
    await projectMemberships(db, staff, [
      { workspaceId: staffHome, workspaceName: 'HQ', iamAccountId: 'acc-s', workspaceUserId: 'wu-s', role: 'owner', active: true },
    ]);
    const { accountId, memberId } = await grantStaffAccess(db, staff, { workspaceId: wsId, workspaceName: 'Cust', iamAccountId: 'acc-c' });
    await ids([wsId, staffHome]);
    const same = await grantStaffAccess(db, staff, { workspaceId: wsId, workspaceName: 'Cust', iamAccountId: 'acc-c' });
    expect(same.memberId).toBe(memberId);

    // The customer's owner arrives later: still the FIRST member, still gets onboarding owed.
    const owner = { externalId: `own-${randomUUID()}`, email: 'o@example.test', displayName: 'O' };
    const res = await projectMemberships(db, owner, [
      { workspaceId: wsId, workspaceName: 'Cust', iamAccountId: 'acc-c', workspaceUserId: 'wu-o', role: 'owner', active: true },
    ], { inheritOnboarding: true });
    expect(res.created[0]!.isFirstMember).toBe(true);
    const acc = await db.get<{ onboarding_completed_at: number | null }>(sql`SELECT onboarding_completed_at FROM account WHERE id = ${accountId}`);
    expect(acc!.onboarding_completed_at).toBeNull(); // the account pre-existed (grant), so no stamp: the wizard is still owed

    // Roster and count exclude the grant; the owner's list shows one member.
    expect((await listMembers(db, accountId)).map((m) => m.email)).toEqual(['o@example.test']);
    const ownerList = await listWorkspacesForIdentity(db, { externalId: owner.externalId, email: null });
    expect(ownerList[0]!.memberCount).toBe(1);
    // The staff list shows both, own first, the grant marked.
    const staffList = await listWorkspacesForIdentity(db, { externalId: staff.externalId, email: null });
    expect(staffList.map((w) => [w.accountName, w.accessGrant])).toEqual([['HQ', null], ['Cust', 'staff']]);
    // Home falls back to the real membership.
    expect((await pickHomeAccount(db, staff.externalId, null))!.accountId).not.toBe(accountId);
    // A membership refresh that does not name the grant leaves it active.
    await projectMemberships(db, staff, [
      { workspaceId: staffHome, workspaceName: 'HQ', iamAccountId: 'acc-s', workspaceUserId: 'wu-s', role: 'owner', active: true },
    ]);
    const g = await db.get<{ status: string }>(sql`SELECT status FROM member WHERE id = ${memberId}`);
    expect(g!.status).toBe('active');
  });
});

describe('searchProjectedAccounts (both dialects)', () => {
  it('matches by workspace name, member email or form name; names the reason; skips local-only accounts', async () => {
    const tag = randomUUID().slice(0, 8);
    const wsA = `ws-${randomUUID()}`, wsB = `ws-${randomUUID()}`;
    const owner = { externalId: `sub-${tag}-a`, email: `zed-${tag}@seika.test`, displayName: 'Zed' };
    await projectMemberships(db, owner, [
      { workspaceId: wsA, workspaceName: `Henry Bravo ${tag}`, iamAccountId: 'acc-a', workspaceUserId: 'wu-a', role: 'owner', active: true },
    ]);
    await projectMemberships(db, { externalId: `sub-${tag}-b`, email: `other-${tag}@example.com`, displayName: 'B' }, [
      { workspaceId: wsB, workspaceName: `Bravo Corp ${tag}`, iamAccountId: 'acc-b', workspaceUserId: 'wu-b', role: 'owner', active: true },
    ]);
    await ids([wsA, wsB]);
    const a = created[0]!;
    const now = Date.now();
    await db.run(
      sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
          VALUES (${randomUUID()}, ${a}, ${`Katagi Leads demo ${tag}`}, ${`katagi-${tag}`}, '{}', ${now}, ${now})`,
    );
    // A local-only account (never projected) with a matching name: not a workspace anyone is granted into.
    const local = randomUUID();
    created.push(local);
    await db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${local}, ${`c${local.slice(0, 8)}`}, ${`Bravo local ${tag}`}, ${now})`);

    // By name: both projected accounts, the local-only one left out; no hint (the name matched).
    const byName = await searchProjectedAccounts(db, tag);
    expect(byName.map((h) => h.name).sort()).toEqual([`Bravo Corp ${tag}`, `Henry Bravo ${tag}`]);
    expect(byName.every((h) => h.hint === null)).toBe(true);
    expect(byName.find((h) => h.name === `Henry Bravo ${tag}`)!.workspaceId).toBe(wsA);
    expect(byName.find((h) => h.name === `Henry Bravo ${tag}`)!.memberCount).toBe(1);

    // By the owner's email: the hint says which address matched.
    const byEmail = await searchProjectedAccounts(db, `zed-${tag}@seika`);
    expect(byEmail.map((h) => h.name)).toEqual([`Henry Bravo ${tag}`]);
    expect(byEmail[0]!.hint).toEqual({ kind: 'email', value: `zed-${tag}@seika.test` });

    // By a form's name: the hint is the form.
    const byForm = await searchProjectedAccounts(db, `katagi leads`);
    expect(byForm.some((h) => h.workspaceId === wsA)).toBe(true);
    expect(byForm.find((h) => h.workspaceId === wsA)!.hint).toEqual({ kind: 'form', value: `Katagi Leads demo ${tag}` });

    // LIKE wildcards are literal; blank is nothing.
    expect(await searchProjectedAccounts(db, `%${tag}%`)).toEqual([]);
    expect(await searchProjectedAccounts(db, '   ')).toEqual([]);
  });
});
