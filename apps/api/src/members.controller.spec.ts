/**
 * Regression: "members don't work — I can't add a new member."
 *
 * The add-member endpoint the dashboard's Settings page drives, exercised end to
 * end through the real controller → AuthService → provider → db on in-memory
 * SQLite. Before this fix the web UI never called it (dead client method, no
 * button), so no test guarded the contract. These lock the intended flow:
 *
 *   1. an admin/owner adds a member by email + role → it persists as `invited`
 *      with the granted role and shows up in the roster (what the "Add member"
 *      button now triggers);
 *   2. a plain member is refused (403) — management is admin/owner only;
 *   3. a duplicate email is refused (409 EMAIL_TAKEN);
 *   4. the invited member is ADOPTED on their first WorkOS login — external_id
 *      bound, status flipped to active, granted role preserved (the JIT
 *      invite→adoption model).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForbiddenException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  createDb,
  migrate,
  seed,
  insertAccountWithShortCode,
  inviteMember,
  sql,
  type Db,
} from '@quill/db';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { LocalAuthProvider } from './auth.provider';
import { WorkOsAuthProvider } from './auth.provider.workos';
import { signJwtHs256 } from './jwt';
import type { ReqLike } from './auth.provider';

let db: Db;
let controller: AdminCrudController;

/** A request the local dev provider resolves to `email` (JIT-safe). */
const asEmail = (email: string): ReqLike => ({ headers: { 'x-quill-email': email } });
/** No identity → local provider falls back to the first seeded account+member (the owner). */
const asOwner = (): ReqLike => ({ headers: {} });

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db); // account "acme" + owner alex@example.com
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  const auth = new AuthService(db, provider);
  const admin = new AdminService(db);
  // Submission/Analytics services are unused by the member routes under test.
  controller = new AdminCrudController(db, auth, admin, {} as never, {} as never);
});

afterEach(async () => {
  await db.close();
});

describe('POST /v1/members (add a member)', () => {
  it('an owner adds a member by email + role → invited, and it appears in the roster', async () => {
    const before = await controller.members(asOwner());
    expect(before).toHaveLength(1); // just the owner

    const created = await controller.inviteMember(asOwner(), {
      email: 'Newbie@Acme.test',
      role: 'member',
    });
    expect(created.email).toBe('newbie@acme.test'); // normalized
    expect(created.role).toBe('member');
    expect(created.status).toBe('invited');
    expect(created.handle).toBeTruthy(); // auto-handle so they're bookable on accept

    const after = await controller.members(asOwner());
    expect(after).toHaveLength(2);
    expect(after.map((m) => m.email)).toContain('newbie@acme.test');
  });

  it('honors an admin role grant', async () => {
    const created = await controller.inviteMember(asOwner(), {
      email: 'boss@acme.test',
      role: 'admin',
    });
    expect(created.role).toBe('admin');
    expect(created.status).toBe('invited');
  });

  it('refuses a plain member (admin/owner only) with 403', async () => {
    await controller.inviteMember(asOwner(), { email: 'plain@acme.test', role: 'member' });
    // The invited member logs in later; here we just resolve them as the caller.
    await expect(
      controller.inviteMember(asEmail('plain@acme.test'), { email: 'x@acme.test' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.members(asEmail('plain@acme.test'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a duplicate email with 409 EMAIL_TAKEN', async () => {
    await controller.inviteMember(asOwner(), { email: 'dup@acme.test' });
    const err = await controller
      .inviteMember(asOwner(), { email: 'DUP@acme.test' })
      .then(() => null)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ error: 'EMAIL_TAKEN' });
  });
});

/** Find a roster member's id by email (owner-scoped read). */
async function memberIdByEmail(email: string): Promise<string> {
  const roster = await controller.members(asOwner());
  const found = roster.find((m) => m.email === email.toLowerCase());
  if (!found) throw new Error(`member ${email} not in roster`);
  return found.id;
}

describe('PATCH /v1/members/:id (change role)', () => {
  it('an owner promotes a member to admin, then demotes back to member', async () => {
    await controller.inviteMember(asOwner(), { email: 'm@acme.test', role: 'member' });
    const id = await memberIdByEmail('m@acme.test');

    const up = await controller.updateMember(asOwner(), id, { role: 'admin' });
    expect(up.role).toBe('admin');
    const down = await controller.updateMember(asOwner(), id, { role: 'member' });
    expect(down.role).toBe('member');
  });

  it('refuses a plain member (admin/owner only) with 403', async () => {
    await controller.inviteMember(asOwner(), { email: 'plain@acme.test', role: 'member' });
    const target = await controller.inviteMember(asOwner(), { email: 'victim@acme.test' });
    await expect(
      controller.updateMember(asEmail('plain@acme.test'), target.id, { role: 'admin' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an admin trying to manage an owner with 403 (only an owner can)', async () => {
    await controller.inviteMember(asOwner(), { email: 'boss@acme.test', role: 'admin' });
    const ownerId = await memberIdByEmail('alex@example.com');
    await expect(
      controller.updateMember(asEmail('boss@acme.test'), ownerId, { role: 'member' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses changing your own membership with 403', async () => {
    const ownerId = await memberIdByEmail('alex@example.com');
    await expect(
      controller.updateMember(asOwner(), ownerId, { role: 'member' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('DELETE /v1/members/:id (remove member)', () => {
  it('an owner removes a member → gone from the roster', async () => {
    await controller.inviteMember(asOwner(), { email: 'r@acme.test', role: 'member' });
    const id = await memberIdByEmail('r@acme.test');

    const res = await controller.removeMember(asOwner(), id);
    expect(res).toEqual({ ok: true });
    const roster = await controller.members(asOwner());
    expect(roster.map((m) => m.email)).not.toContain('r@acme.test');
  });

  it('is idempotent for an unknown member (200 ok)', async () => {
    expect(await controller.removeMember(asOwner(), randomUUID())).toEqual({ ok: true });
  });

  it('refuses a plain member (owner only) with 403', async () => {
    await controller.inviteMember(asOwner(), { email: 'plain@acme.test', role: 'member' });
    const target = await controller.inviteMember(asOwner(), { email: 'victim@acme.test' });
    await expect(
      controller.removeMember(asEmail('plain@acme.test'), target.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an ADMIN removing an ACTIVE member with 403 — removal is owner-only, like the identity service', async () => {
    await controller.inviteMember(asOwner(), { email: 'boss@acme.test', role: 'admin' });
    const target = await controller.inviteMember(asOwner(), { email: 'victim@acme.test' });
    // Accepted membership (what first login does): the owner-only rule applies.
    await db.run(sql`UPDATE member SET status = 'active' WHERE id = ${target.id}`);
    await expect(
      controller.removeMember(asEmail('boss@acme.test'), target.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // …while the same admin can still demote / disable them.
    const demoted = await controller.updateMember(asEmail('boss@acme.test'), target.id, { status: 'disabled' });
    expect(demoted.status).toBe('disabled');
  });

  it('an admin CAN retract an invitation (an `invited` row is not a membership yet)', async () => {
    await controller.inviteMember(asOwner(), { email: 'boss@acme.test', role: 'admin' });
    const pending = await controller.inviteMember(asEmail('boss@acme.test'), { email: 'maybe@acme.test' });
    expect(pending.status).toBe('invited');
    expect(await controller.removeMember(asEmail('boss@acme.test'), pending.id)).toEqual({ ok: true });
    const roster = await controller.members(asOwner());
    expect(roster.map((m) => m.email)).not.toContain('maybe@acme.test');
  });

  it('refuses an admin removing an owner with 403', async () => {
    await controller.inviteMember(asOwner(), { email: 'boss@acme.test', role: 'admin' });
    const ownerId = await memberIdByEmail('alex@example.com');
    await expect(
      controller.removeMember(asEmail('boss@acme.test'), ownerId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses removing yourself with 403', async () => {
    const ownerId = await memberIdByEmail('alex@example.com');
    await expect(controller.removeMember(asOwner(), ownerId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('invite → first-login adoption (WorkOS JIT model)', () => {
  it('adopts the invited member on first login: binds external_id, activates, keeps the role', async () => {
    const secret = 'test-shared-secret';
    const externalId = 'org_adopt_1';
    await insertAccountWithShortCode(db, { name: 'Adopt Co', externalId });
    const account = (await db.get<{ id: string }>(
      sql`SELECT id FROM account WHERE external_id = ${externalId} LIMIT 1`,
    ))!;

    // Invite (granted admin) — an `invited` row with no external_id yet.
    const invited = await inviteMember(db, account.id, { email: 'invitee@adopt.test', role: 'admin' });
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;
    expect(invited.value.status).toBe('invited');

    // Their first login: the identity service mints a token for the same email.
    const provider = new WorkOsAuthProvider(db, {
      JWT_SECRET: secret,
      JWT_ISSUER: undefined,
      JWT_AUDIENCE: undefined,
      SEED_DEMO_FORM: false,
      ONBOARDING_WIZARD: false,
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const token = signJwtHs256(
      {
        sub: 'workos_user_42',
        account_id: externalId,
        email: 'invitee@adopt.test',
        name: 'Invited Person',
        iat: nowSec,
        exp: nowSec + 3600,
      },
      secret,
    );
    const resolved = await provider.resolveHost({ headers: { authorization: `Bearer ${token}` } });

    // Adopted the SAME row (not a fresh member), bound + activated, role kept.
    expect(resolved.memberId).toBe(invited.value.id);
    const row = (await db.get<{ external_id: string | null; status: string; role: string }>(
      sql`SELECT external_id, status, role FROM member WHERE id = ${invited.value.id} LIMIT 1`,
    ))!;
    expect(row.external_id).toBe('workos_user_42');
    expect(row.status).toBe('active');
    expect(row.role).toBe('admin');
  });
});
