import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { seed } from './seed';
import {
  listMembers,
  getAccountMember,
  getMemberRole,
  inviteMember,
  changeMemberRole,
  setMemberStatus,
  removeMember,
} from './members';
import { getMe } from './parity';

describe('account roles + member management (owner/admin/member)', () => {
  let db: Db;
  let accountId: string;
  let alex: string; // seeded owner
  let jordan: string; // seeded member

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code='acme'`))!.id;
    alex = (await db.get<{ id: string }>(
      sql`SELECT id FROM member WHERE account_id = ${accountId} AND handle='alex-rivera'`,
    ))!.id;
    jordan = (await db.get<{ id: string }>(
      sql`SELECT id FROM member WHERE account_id = ${accountId} AND handle='jordan-lee'`,
    ))!.id;
  });

  it('seeds the first member as owner, others as member', async () => {
    expect(await getMemberRole(db, accountId, alex)).toBe('owner');
    expect(await getMemberRole(db, accountId, jordan)).toBe('member');
    const list = await listMembers(db, accountId);
    expect(list.find((m) => m.id === alex)).toMatchObject({ role: 'owner', status: 'active' });
    expect(list.find((m) => m.id === jordan)).toMatchObject({ role: 'member', status: 'active' });
  });

  it('/me carries the caller role + status', async () => {
    const me = await getMe(db, accountId, alex);
    expect(me).toMatchObject({ role: 'owner', status: 'active' });
    const staff = await getMe(db, accountId, jordan);
    expect(staff).toMatchObject({ role: 'member' });
  });

  it('migration backfill promotes exactly one owner per account', async () => {
    const owners = await db.all<{ id: string }>(
      sql`SELECT id FROM member WHERE account_id = ${accountId} AND role='owner'`,
    );
    expect(owners).toHaveLength(1);
    expect(owners[0]!.id).toBe(alex);
  });

  it('invites a member by email as an invited row; rejects duplicates and owner invites', async () => {
    const r = await inviteMember(db, accountId, { email: 'New.Hire@Example.com', role: 'admin' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('invite failed');
    expect(r.value).toMatchObject({ email: 'new.hire@example.com', role: 'admin', status: 'invited' });

    // Duplicate email (case-insensitive) → EMAIL_TAKEN.
    const dup = await inviteMember(db, accountId, { email: 'new.hire@example.com' });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toBe('EMAIL_TAKEN');

    // Inviting an existing seeded email is also taken.
    const dup2 = await inviteMember(db, accountId, { email: 'jordan@example.com' });
    expect(dup2.ok).toBe(false);

    // Role is clamped to member|admin — owner can never be invited.
    const clamped = await inviteMember(db, accountId, {
      email: 'staff@example.com',
      // @ts-expect-error — deliberately passing an out-of-range role
      role: 'owner',
    });
    expect(clamped.ok).toBe(true);
    if (clamped.ok) expect(clamped.value.role).toBe('member');
  });

  it('changes roles but guards the last owner (demote)', async () => {
    // Promote/adjust staff freely.
    const up = await changeMemberRole(db, accountId, jordan, 'admin');
    expect(up.ok).toBe(true);
    if (up.ok) expect(up.value.role).toBe('admin');

    // Demoting the sole owner is refused.
    const demote = await changeMemberRole(db, accountId, alex, 'admin');
    expect(demote.ok).toBe(false);
    if (!demote.ok) expect(demote.reason).toBe('LAST_OWNER');

    // Add a second owner → the first can now be demoted.
    await changeMemberRole(db, accountId, jordan, 'owner');
    const demote2 = await changeMemberRole(db, accountId, alex, 'member');
    expect(demote2.ok).toBe(true);
    expect(await getMemberRole(db, accountId, alex)).toBe('member');
  });

  it('guards the last owner on disable, allows disabling once another owner exists', async () => {
    const off = await setMemberStatus(db, accountId, alex, 'disabled');
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.reason).toBe('LAST_OWNER');

    await changeMemberRole(db, accountId, jordan, 'owner');
    const off2 = await setMemberStatus(db, accountId, alex, 'disabled');
    expect(off2.ok).toBe(true);
    if (off2.ok) expect(off2.value.status).toBe('disabled');
    // A disabled owner no longer counts toward the guard.
    const off3 = await setMemberStatus(db, accountId, jordan, 'disabled');
    expect(off3.ok).toBe(false);
  });

  it('removes a member (cascading personal resources) but guards the last owner', async () => {
    // Sole owner cannot be removed.
    const rmOwner = await removeMember(db, accountId, alex);
    expect(rmOwner.ok).toBe(false);
    if (!rmOwner.ok) expect(rmOwner.reason).toBe('LAST_OWNER');

    // Jordan has a seeded schedule — removal should cascade it away.
    const schedBefore = await db.get<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM schedule WHERE account_id = ${accountId} AND member_id = ${jordan}`,
    );
    expect(Number(schedBefore!.n)).toBeGreaterThan(0);

    const rm = await removeMember(db, accountId, jordan);
    expect(rm.ok).toBe(true);
    expect(await getAccountMember(db, accountId, jordan)).toBeNull();
    const schedAfter = await db.get<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM schedule WHERE account_id = ${accountId} AND member_id = ${jordan}`,
    );
    expect(Number(schedAfter!.n)).toBe(0);
    // Removing an already-gone member is idempotent.
    expect((await removeMember(db, accountId, jordan)).ok).toBe(true);
  });

  it('scopes every op to the account (foreign member is invisible)', async () => {
    expect(await getMemberRole(db, 'other-account', alex)).toBeNull();
    expect(await getAccountMember(db, 'other-account', alex)).toBeNull();
    const rm = await changeMemberRole(db, 'other-account', alex, 'member');
    expect(rm.ok).toBe(false);
    if (!rm.ok) expect(rm.reason).toBe('NOT_FOUND');
  });
});
