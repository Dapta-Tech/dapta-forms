/**
 * Account-roster management guards, on the data layer (SQLite locally, Postgres
 * in the CI parity job). These lock the invariants the Settings roster controls
 * depend on: role changes and removals work, and the workspace can never lose its
 * last active owner (LAST_OWNER) — whether by demotion, disabling, or removal.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, sql, type Db } from './client';
import { migrate } from './migrate';
import {
  changeMemberRole,
  getAccountMember,
  listMembers,
  removeMember,
  setMemberStatus,
  type AccountRole,
  type MemberStatus,
} from './members';

let db: Db;
let accountId: string;

/** Insert a member row directly (bypasses invite, which cannot mint owners). */
async function addMember(
  email: string,
  role: AccountRole,
  status: MemberStatus = 'active',
): Promise<string> {
  const id = randomUUID();
  const handle = email.split('@')[0];
  await db.run(
    sql`INSERT INTO member (id, account_id, email, display_name, handle, role, status, created_at)
        VALUES (${id}, ${accountId}, ${email}, ${email.split('@')[0]}, ${handle}, ${role}, ${status}, ${Date.now()})`,
  );
  return id;
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  accountId = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${'acme'}, ${'Acme'}, ${Date.now()})`,
  );
});

afterEach(async () => {
  await db.close();
});

describe('changeMemberRole', () => {
  it('promotes a member to admin and demotes an admin to member', async () => {
    await addMember('owner@acme.test', 'owner');
    const memberId = await addMember('mem@acme.test', 'member');

    const up = await changeMemberRole(db, accountId, memberId, 'admin');
    expect(up.ok).toBe(true);
    if (up.ok) expect(up.value.role).toBe('admin');

    const down = await changeMemberRole(db, accountId, memberId, 'member');
    expect(down.ok).toBe(true);
    if (down.ok) expect(down.value.role).toBe('member');
  });

  it('refuses to demote the last active owner (LAST_OWNER)', async () => {
    const ownerId = await addMember('solo-owner@acme.test', 'owner');
    const res = await changeMemberRole(db, accountId, ownerId, 'member');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('LAST_OWNER');
    // Unchanged.
    expect((await getAccountMember(db, accountId, ownerId))!.role).toBe('owner');
  });

  it('allows demoting an owner while another active owner remains', async () => {
    await addMember('owner-a@acme.test', 'owner');
    const ownerB = await addMember('owner-b@acme.test', 'owner');
    const res = await changeMemberRole(db, accountId, ownerB, 'member');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.role).toBe('member');
  });
});

describe('setMemberStatus', () => {
  it('refuses to disable the last active owner (LAST_OWNER)', async () => {
    const ownerId = await addMember('solo-owner@acme.test', 'owner');
    const res = await setMemberStatus(db, accountId, ownerId, 'disabled');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('LAST_OWNER');
  });
});

describe('removeMember', () => {
  it('removes a member from the roster', async () => {
    await addMember('owner@acme.test', 'owner');
    const memberId = await addMember('mem@acme.test', 'member');

    const res = await removeMember(db, accountId, memberId);
    expect(res.ok).toBe(true);
    expect(await getAccountMember(db, accountId, memberId)).toBeNull();
    expect((await listMembers(db, accountId)).map((m) => m.email)).not.toContain('mem@acme.test');
  });

  it('refuses to remove the last active owner (LAST_OWNER)', async () => {
    const ownerId = await addMember('solo-owner@acme.test', 'owner');
    const res = await removeMember(db, accountId, ownerId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('LAST_OWNER');
    expect(await getAccountMember(db, accountId, ownerId)).not.toBeNull();
  });

  it('allows removing an owner while another active owner remains', async () => {
    await addMember('owner-a@acme.test', 'owner');
    const ownerB = await addMember('owner-b@acme.test', 'owner');
    const res = await removeMember(db, accountId, ownerB);
    expect(res.ok).toBe(true);
    expect(await getAccountMember(db, accountId, ownerB)).toBeNull();
  });

  it('is idempotent for an already-removed member', async () => {
    const res = await removeMember(db, accountId, randomUUID());
    expect(res.ok).toBe(true);
  });
});

describe('listPublishedFormsForAccount — public title extraction', () => {
  it('surfaces config.title when set and null otherwise, on both dialects', async () => {
    const { listPublishedFormsForAccount } = await import('./members');
    const { insertAccountWithShortCode } = await import('./short-links');
    const externalId = `x-${randomUUID()}`;
    await insertAccountWithShortCode(db, { name: 'Titled Co', externalId });
    const account = await db.get<{ id: string; code: string }>(
      sql`SELECT id, code FROM account WHERE external_id = ${externalId} LIMIT 1`,
    );
    const mk = async (slug: string, config: unknown) => {
      await db.run(
        sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
            VALUES (${randomUUID()}, ${account!.id}, ${'Internal ' + slug}, ${slug},
                    ${JSON.stringify(config)}, ${Date.now()}, ${Date.now()})`,
      );
    };
    await mk('with-title', { version: 1, title: '  Público  ', steps: [] });
    await mk('no-title', { version: 1, steps: [] });
    await mk('empty-title', { version: 1, title: '   ', steps: [] });

    const rows = await listPublishedFormsForAccount(db, account!.code);
    const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]));
    expect(bySlug['with-title']!.title).toBe('Público'); // trimmed
    expect(bySlug['with-title']!.name).toBe('Internal with-title');
    expect(bySlug['no-title']!.title).toBeNull();
    expect(bySlug['empty-title']!.title).toBeNull(); // whitespace = unset
  });
});
