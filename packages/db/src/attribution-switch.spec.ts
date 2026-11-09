/**
 * The attribution switch and its paid verdict (migration 0028): the default
 * every existing workspace gets, the choice kept apart from the verdict, and
 * the projection writing the verdict only when the identity service gave one.
 * In-memory SQLite locally; DATABASE_URL for the Postgres parity job.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, sql, type Db } from './client';
import { migrate } from './migrate';
import { cacheDaptaPaid, getAttributionSwitch, setHideAttribution } from './attribution-switch';
import { getAccountByExternalId, grantStaffAccess, projectMemberships } from './workspaces';

let db: Db;
let accountId: string;
const created: string[] = [];
const SUB = `sub-${randomUUID()}`;

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  accountId = randomUUID();
  created.push(accountId);
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${'t' + accountId.slice(0, 7)}, ${'Test'}, ${Date.now()})`,
  );
});

afterEach(async () => {
  for (const id of created) {
    await db.run(sql`DELETE FROM member WHERE account_id = ${id}`);
    await db.run(sql`DELETE FROM account WHERE id = ${id}`);
  }
  await db.run(sql`DELETE FROM member WHERE external_id = ${SUB}`);
  created.length = 0;
  await db.close();
});

describe('attribution switch', () => {
  it('defaults every workspace to showing it, with no verdict', async () => {
    expect(await getAttributionSwitch(db, accountId)).toEqual({
      accountId,
      hideAttribution: false,
      paid: null,
      paidCheckedAt: null,
    });
  });

  it('answers null for an account that does not exist', async () => {
    expect(await getAttributionSwitch(db, randomUUID())).toBeNull();
  });

  it('stores the choice and the verdict apart', async () => {
    await setHideAttribution(db, accountId, true);
    expect((await getAttributionSwitch(db, accountId))!.hideAttribution).toBe(true);
    expect((await getAttributionSwitch(db, accountId))!.paid).toBeNull();

    await cacheDaptaPaid(db, accountId, true, 1_700_000_000_000);
    expect(await getAttributionSwitch(db, accountId)).toMatchObject({
      hideAttribution: true,
      paid: true,
      paidCheckedAt: 1_700_000_000_000,
    });

    // A lapse rewrites the verdict and leaves the choice alone.
    await cacheDaptaPaid(db, accountId, false, 1_700_000_100_000);
    expect(await getAttributionSwitch(db, accountId)).toMatchObject({
      hideAttribution: true,
      paid: false,
      paidCheckedAt: 1_700_000_100_000,
    });

    await setHideAttribution(db, accountId, false);
    expect(await getAttributionSwitch(db, accountId)).toMatchObject({ hideAttribution: false, paid: false });
  });
});

describe('projectMemberships and the paid verdict', () => {
  const identity = { externalId: SUB, email: null, displayName: null };
  const membership = (workspaceId: string, paid?: boolean | null) => ({
    workspaceId,
    workspaceName: 'WS',
    iamAccountId: 'iam-acc',
    workspaceUserId: null,
    role: 'owner' as const,
    active: true,
    ...(paid === undefined ? {} : { paid }),
  });

  async function projectedId(workspaceId: string): Promise<string> {
    const a = await getAccountByExternalId(db, workspaceId);
    created.push(a!.id);
    return a!.id;
  }

  it('writes the verdict with the time of the read', async () => {
    const ws = `ws-${randomUUID()}`;
    await projectMemberships(db, identity, [membership(ws, true)], { now: 1000 });
    const id = await projectedId(ws);
    expect(await getAttributionSwitch(db, id)).toMatchObject({ paid: true, paidCheckedAt: 1000 });

    await projectMemberships(db, identity, [membership(ws, false)], { now: 2000 });
    expect(await getAttributionSwitch(db, id)).toMatchObject({ paid: false, paidCheckedAt: 2000 });
  });

  it('a read without a verdict keeps the old one', async () => {
    const ws = `ws-${randomUUID()}`;
    await projectMemberships(db, identity, [membership(ws, true)], { now: 1000 });
    const id = await projectedId(ws);
    await projectMemberships(db, identity, [membership(ws)], { now: 5000 });
    await projectMemberships(db, identity, [membership(ws, null)], { now: 6000 });
    expect(await getAttributionSwitch(db, id)).toMatchObject({ paid: true, paidCheckedAt: 1000 });
  });

  it('a new workspace with no verdict has none', async () => {
    const ws = `ws-${randomUUID()}`;
    await projectMemberships(db, identity, [membership(ws)], { now: 1000 });
    const id = await projectedId(ws);
    expect(await getAttributionSwitch(db, id)).toMatchObject({ hideAttribution: false, paid: null, paidCheckedAt: null });
  });

  it('a staff grant carries the verdict of the workspace it entered', async () => {
    const ws = `ws-${randomUUID()}`;
    await grantStaffAccess(db, identity, { workspaceId: ws, workspaceName: 'WS', iamAccountId: null, paid: true }, { now: 3000 });
    const id = await projectedId(ws);
    expect(await getAttributionSwitch(db, id)).toMatchObject({ paid: true, paidCheckedAt: 3000 });
  });
});
