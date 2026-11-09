/**
 * The paid verdict the projection caches for the attribution switch.
 *
 * dForms holds no credential for the identity service (ADR 0003): the verdict
 * is read from the rows it already gets with the caller's own token, the
 * search's `isPaid` and the detail's `account.account_status_id`, and only the
 * resulting boolean is stored. What is locked here:
 *
 *   1. search `isPaid` true / false writes 1 / 0 with the time of the read;
 *      absent writes nothing and keeps the old verdict;
 *   2. detail `account_status_id` 1, 3, 4 are not paid; 2 and 5 are; absent
 *      writes nothing;
 *   3. no plan name, status or billing id from the upstream row is stored.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, getAccountByExternalId, getAttributionSwitch, migrate, sql, type Db } from '@quill/db';
import { WorkspaceProjection, type UpstreamIdentity } from './workspace-projection';
import { IamWorkspacesClient, paidVerdictOf, type IamWorkspace } from './iam-workspaces';

const SUB = '4bd0984c-0000-4000-8000-0000000000c1';
const IAM_ACCOUNT = 'a49b1229-0000-4000-8000-0000000000cc';
const WS = '38bafc53-0000-4000-8000-0000000000d1';

/** An upstream workspace row as the identity service ships it, billing noise included. */
function row(extra: Record<string, unknown>): IamWorkspace {
  return {
    id: WS,
    name: 'Paid Co',
    account_id: IAM_ACCOUNT,
    is_active: true,
    users: [{ id: 'wu-1', user_id: SUB, type: 'OWNER', is_active: true, roles: [] }],
    // What must never reach a dForms row.
    plan: 'GROWTH_PLAN_X',
    stripe_customer_id: 'cus_STRIPE_SECRET',
    phone_number: '+570000000',
    ...extra,
  } as IamWorkspace;
}

class FakeIam {
  searchRow: IamWorkspace = row({});
  detailRow: IamWorkspace = row({});
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.pathname === `/iam/account/${IAM_ACCOUNT}`) return json({ id: IAM_ACCOUNT });
    if (method === 'GET' && url.pathname === '/iam/workspace/search') {
      return json({ data: [this.searchRow], total: 1, totalPages: 1 });
    }
    if (method === 'GET' && url.pathname === `/iam/workspace/${WS}`) return json(this.detailRow);
    return new Response('not found', { status: 404 });
  };
}

function json(v: unknown): Response {
  return new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
}

const id: UpstreamIdentity = { sub: SUB, iamAccountId: IAM_ACCOUNT, email: 'owner@paid.test', displayName: 'Owner', bearer: 'token' };

describe('the paid verdict, from the rows the projection already reads', () => {
  let db: Db;
  let iam: FakeIam;
  let projection: WorkspaceProjection;
  let now = 1_700_000_000_000;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    iam = new FakeIam();
    now = 1_700_000_000_000;
    projection = new WorkspaceProjection(
      db,
      new IamWorkspacesClient({ baseUrl: 'https://iam.example.test/iam', fetchImpl: iam.fetch }),
      { ttlMs: 0, now: () => now },
    );
  });

  afterEach(async () => {
    await db.close();
  });

  async function verdict() {
    const account = await getAccountByExternalId(db, WS);
    return getAttributionSwitch(db, account!.id);
  }

  describe('workspace search: isPaid', () => {
    it('true and false are written with the time of the read', async () => {
      iam.searchRow = row({ isPaid: true });
      await projection.ensure(id, { force: true });
      expect(await verdict()).toMatchObject({ paid: true, paidCheckedAt: now });

      now += 60_000;
      iam.searchRow = row({ isPaid: false });
      await projection.ensure(id, { force: true });
      expect(await verdict()).toMatchObject({ paid: false, paidCheckedAt: now });
    });

    it('absent (an older identity service) writes nothing and keeps the old verdict', async () => {
      iam.searchRow = row({});
      await projection.ensure(id, { force: true });
      expect(await verdict()).toMatchObject({ paid: null, paidCheckedAt: null });

      iam.searchRow = row({ isPaid: true });
      await projection.ensure(id, { force: true });
      const at = now;
      now += 60_000;
      iam.searchRow = row({});
      await projection.ensure(id, { force: true });
      expect(await verdict()).toMatchObject({ paid: true, paidCheckedAt: at });
    });
  });

  describe('workspace detail: account.account_status_id', () => {
    for (const [status, paid] of [
      [1, false],
      [2, true],
      [3, false],
      [4, false],
      [5, true],
    ] as const) {
      it(`status ${status} is ${paid ? 'paid' : 'not paid'}`, async () => {
        iam.detailRow = row({ account: { account_status_id: status, stripe_id: 'cus_STRIPE_SECRET', plan_name: 'GROWTH_PLAN_X' } });
        const detail = await projection.iam.getWorkspace(id.bearer, WS);
        await projection.projectOne(id, detail);
        expect(await verdict()).toMatchObject({ paid, paidCheckedAt: now });
      });
    }

    it('a detail with no account status writes nothing', async () => {
      iam.searchRow = row({ isPaid: true });
      await projection.ensure(id, { force: true });
      const at = now;
      now += 1000;
      iam.detailRow = row({ account: { name: 'no status here' } });
      await projection.projectOne(id, await projection.iam.getWorkspace(id.bearer, WS));
      expect(await verdict()).toMatchObject({ paid: true, paidCheckedAt: at });
    });
  });

  it('stores only the boolean: no plan, status or billing id anywhere on the rows', async () => {
    iam.searchRow = row({ isPaid: true, account: { account_status_id: 2, stripe_id: 'cus_STRIPE_SECRET' } });
    await projection.ensure(id, { force: true });
    const accounts = await db.all<Record<string, unknown>>(sql`SELECT * FROM account`);
    const members = await db.all<Record<string, unknown>>(sql`SELECT * FROM member`);
    const dump = JSON.stringify([accounts, members]);
    expect(dump).not.toContain('cus_STRIPE_SECRET');
    expect(dump).not.toContain('GROWTH_PLAN_X');
    expect(dump).not.toContain('+570000000');
    expect(dump).not.toContain('account_status');
  });
});

describe('paidVerdictOf', () => {
  it('prefers the search boolean, else derives from the status, else null', () => {
    expect(paidVerdictOf({ isPaid: true, account: { account_status_id: 1 } })).toBe(true);
    expect(paidVerdictOf({ isPaid: false, account: { account_status_id: 2 } })).toBe(false);
    expect(paidVerdictOf({ account: { account_status_id: '2' } })).toBe(true);
    expect(paidVerdictOf({ account: { account_status_id: '4' } })).toBe(false);
    expect(paidVerdictOf({ account: { account_status_id: 'abc' } })).toBeNull();
    expect(paidVerdictOf({ account: { account_status_id: null } })).toBeNull();
    expect(paidVerdictOf({ account: null })).toBeNull();
    expect(paidVerdictOf({})).toBeNull();
    expect(paidVerdictOf(null)).toBeNull();
  });
});
