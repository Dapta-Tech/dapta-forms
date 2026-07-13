/**
 * The permission matrix: each account role × each guarded route → allow / 403,
 * plus the last-owner guard and admin-cannot-touch-owner rule. Exercises the real
 * controllers against an in-memory DB with a controllable principal (a fake
 * AuthService), so the guards are tested where they actually run.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException, ConflictException } from '@nestjs/common';
import {
  sql,
  createDb,
  migrate,
  seed,
  changeMemberRole,
  createEventType,
  type Db,
  type AccountRole,
} from '@slate/db';
import { AdminCrudController } from './admin-crud.controller';
import { HostController } from './host.controller';
import type { AuthService, HostPrincipal, ReqLike } from './auth.service';
import {
  isAdmin,
  isOwner,
  assertAdmin,
  assertOwner,
  assertOwnsOrAdmin,
  assertCanManageTarget,
} from './permissions';

const REQ: ReqLike = { headers: {} };

/** A fake AuthService whose resolved principal we flip per-call. */
class FakeAuth {
  current: HostPrincipal = { accountId: '', memberId: '', role: 'member' };
  resolveHost(): Promise<HostPrincipal> {
    return Promise.resolve(this.current);
  }
}

describe('permission layer — pure capability helpers', () => {
  it('isAdmin / isOwner classify the role tiers', () => {
    expect(isOwner('owner')).toBe(true);
    expect(isOwner('admin')).toBe(false);
    expect(isAdmin('owner')).toBe(true);
    expect(isAdmin('admin')).toBe(true);
    expect(isAdmin('member')).toBe(false);
  });

  it('assertAdmin / assertOwner throw 403 below the tier', () => {
    const member = { memberId: 'm', role: 'member' as AccountRole };
    const admin = { memberId: 'a', role: 'admin' as AccountRole };
    expect(() => assertAdmin(member)).toThrow(ForbiddenException);
    expect(() => assertAdmin(admin)).not.toThrow();
    expect(() => assertOwner(admin)).toThrow(ForbiddenException);
    expect(() => assertOwner({ memberId: 'o', role: 'owner' })).not.toThrow();
  });

  it('assertOwnsOrAdmin: member only their own; admin anyone; null owner is admin-only', () => {
    const member = { memberId: 'm1', role: 'member' as AccountRole };
    expect(() => assertOwnsOrAdmin(member, 'm1')).not.toThrow();
    expect(() => assertOwnsOrAdmin(member, 'm2')).toThrow(ForbiddenException);
    expect(() => assertOwnsOrAdmin(member, null)).toThrow(ForbiddenException);
    const admin = { memberId: 'a', role: 'admin' as AccountRole };
    expect(() => assertOwnsOrAdmin(admin, 'm2')).not.toThrow();
    expect(() => assertOwnsOrAdmin(admin, null)).not.toThrow();
  });

  it('assertCanManageTarget: only an owner may touch an owner or grant ownership', () => {
    const admin = { memberId: 'a', role: 'admin' as AccountRole };
    const owner = { memberId: 'o', role: 'owner' as AccountRole };
    expect(() => assertCanManageTarget(admin, { role: 'member' })).not.toThrow();
    expect(() => assertCanManageTarget(admin, { role: 'owner' })).toThrow(ForbiddenException);
    expect(() => assertCanManageTarget(admin, { role: 'member' }, { toRole: 'owner' })).toThrow(
      ForbiddenException,
    );
    expect(() => assertCanManageTarget(owner, { role: 'owner' }, { toRole: 'owner' })).not.toThrow();
  });
});

describe('permission matrix — guarded routes (real controllers)', () => {
  let db: Db;
  let auth: FakeAuth;
  let crud: AdminCrudController;
  let host: HostController;
  let accountId: string;
  let alex: string; // owner
  let jordan: string; // member

  const as = (role: AccountRole, memberId: string) => {
    auth.current = { accountId, memberId, role };
  };

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code='acme'`))!.id;
    alex = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE handle='alex-rivera'`))!.id;
    jordan = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE handle='jordan-lee'`))!.id;
    auth = new FakeAuth();
    // AdminService is only reached AFTER the guard for the host routes we test,
    // so a minimal stub is enough to prove the 403s.
    const adminStub = {
      listApiKeys: () => Promise.resolve([]),
      listWebhooks: () => Promise.resolve([]),
    };
    crud = new AdminCrudController(db, auth as unknown as AuthService);
    host = new HostController(adminStub as never, auth as unknown as AuthService);
  });

  // --- Member management (admin/owner only; admins can't touch owners) ------

  it('GET /members: member 403, admin/owner allowed', async () => {
    as('member', jordan);
    await expect(crud.members(REQ)).rejects.toBeInstanceOf(ForbiddenException);
    as('owner', alex);
    const list = await crud.members(REQ);
    expect(list.find((m) => m.id === alex)).toMatchObject({ role: 'owner' });
  });

  it('POST /members (invite): member 403; admin invites; duplicate 409', async () => {
    as('member', jordan);
    await expect(
      crud.inviteMember(REQ, { email: 'x@example.com' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await changeMemberRole(db, accountId, jordan, 'admin'); // promote for the admin cases
    as('admin', jordan);
    const invited = await crud.inviteMember(REQ, { email: 'new@example.com', role: 'member' });
    expect(invited).toMatchObject({ email: 'new@example.com', status: 'invited' });
    await expect(
      crud.inviteMember(REQ, { email: 'new@example.com' }),
    ).rejects.toBeInstanceOf(ConflictException); // EMAIL_TAKEN
  });

  it('PATCH /members/:id: admin cannot touch an owner or grant ownership', async () => {
    await changeMemberRole(db, accountId, jordan, 'admin');
    as('admin', jordan);
    // Admin acting on the owner (alex) → 403.
    await expect(
      crud.updateMember(REQ, alex, { role: 'member' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Admin promoting anyone to owner → 403.
    const staff = (await crud.inviteMember(REQ, { email: 's@example.com' })) as { id: string };
    await expect(
      crud.updateMember(REQ, staff.id, { role: 'owner' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Admin changing a normal member's status → OK.
    const off = await crud.updateMember(REQ, staff.id, { status: 'disabled' });
    expect(off).toMatchObject({ status: 'disabled' });
  });

  it('no self-administration: a caller cannot change or remove their own membership', async () => {
    // Even the owner cannot demote/remove themselves via the members endpoints
    // (own-profile edits go through /v1/me; this prevents self-lockout/escalation).
    as('owner', alex);
    await expect(
      crud.updateMember(REQ, alex, { role: 'member' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      crud.updateMember(REQ, alex, { status: 'disabled' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(crud.removeMember(REQ, alex)).rejects.toBeInstanceOf(ForbiddenException);
    // Acting on ANOTHER member is unaffected.
    await changeMemberRole(db, accountId, jordan, 'admin');
    as('owner', alex);
    const other = await crud.updateMember(REQ, jordan, { role: 'member' });
    expect(other).toMatchObject({ role: 'member' });
  });

  it('DELETE /members/:id: member 403; owner removes another member', async () => {
    as('member', jordan);
    await expect(crud.removeMember(REQ, alex)).rejects.toBeInstanceOf(ForbiddenException);
    as('owner', alex);
    expect(await crud.removeMember(REQ, jordan)).toEqual({ ok: true });
  });

  // --- Own-resource scoping (event-types) -----------------------------------

  it('event-types: a member edits only their own; admin/owner edit anyone’s', async () => {
    // Alex (owner) owns an event-type; Jordan (member) owns one too.
    const alexEt = (await createEventType(db, accountId, alex, {
      slug: 'owner-call',
      title: 'Owner Call',
      lengthMinutes: 30,
    }));
    const jordanEt = await createEventType(db, accountId, jordan, {
      slug: 'staff-call',
      title: 'Staff Call',
      lengthMinutes: 30,
    });
    if (!alexEt.ok || !jordanEt.ok) throw new Error('setup');

    // Member editing someone else's event-type → 403; own → OK.
    as('member', jordan);
    await expect(
      crud.updateEventType(REQ, alexEt.value.id, { title: 'Hijack' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const own = await crud.updateEventType(REQ, jordanEt.value.id, { title: 'My Call' });
    expect(own.title).toBe('My Call');

    // Admin (owner tier) may edit the member's event-type.
    as('owner', alex);
    const edited = await crud.updateEventType(REQ, jordanEt.value.id, { title: 'Reassigned' });
    expect(edited.title).toBe('Reassigned');
  });

  it('creating a TEAM event-type requires admin/owner', async () => {
    const team = (await db.get<{ id: string }>(sql`SELECT id FROM team WHERE slug='sales'`))!.id;
    as('member', jordan);
    await expect(
      crud.createEventType(REQ, { slug: 't1', title: 'T', lengthMinutes: 30, teamId: team }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    as('owner', alex);
    const ok = await crud.createEventType(REQ, {
      slug: 't2',
      title: 'T2',
      lengthMinutes: 30,
      teamId: team,
    });
    expect(ok.teamId).toBe(team);
  });

  // --- Teams + Developer surfaces -------------------------------------------

  it('team create is admin-only; member 403', async () => {
    as('member', jordan);
    await expect(
      crud.createTeam(REQ, { name: 'Crew', slug: 'crew' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    as('owner', alex);
    expect(await crud.createTeam(REQ, { name: 'Crew', slug: 'crew' })).toMatchObject({ slug: 'crew' });
  });

  it('Developer surface (api-keys, webhooks) is admin-only', async () => {
    as('member', jordan);
    await expect(host.listApiKeys(REQ)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(host.listWebhooks(REQ)).rejects.toBeInstanceOf(ForbiddenException);
    as('owner', alex);
    expect(await host.listApiKeys(REQ)).toEqual([]);
    expect(await host.listWebhooks(REQ)).toEqual([]);
  });
});
