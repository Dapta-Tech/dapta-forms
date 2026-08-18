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
import { listWorkspacesForIdentity } from './members';
import {
  createLocalWorkspace,
  humanHasCompletedOnboarding,
  pickHomeAccount,
  projectMemberships,
  projectRoster,
  rebindLegacyAccount,
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
    expect((await listWorkspacesForIdentity(db, { externalId: SUB, email: EMAIL })).length).toBe(1);
    expect((await listWorkspacesForIdentity(db, { externalId: null, email: null })).length).toBe(0);
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
    const first = await projectMemberships(db, identity, two);
    await ids([a, b]);
    expect(first.created.length).toBe(2);
    expect(first.createdAccounts.length).toBe(2);
    const second = await projectMemberships(db, identity, two);
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
