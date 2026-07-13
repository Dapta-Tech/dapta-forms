/**
 * Account-level member management — the workspace roster the dashboard's
 * Members/Staff page drives: list members with their role + status, invite by
 * email, change role, enable/disable, remove.
 *
 * This is the ACCOUNT role (`member.role`: owner | admin | member), distinct from
 * the per-team role (`team_membership.role`) even though the two share value
 * names. Every account keeps at least one owner (last-owner guard, mirroring the
 * team owner-protection in crud.ts). All ops are account-scoped by the caller.
 */
import { randomUUID } from 'node:crypto';
import { sql, type Db } from './client';
import type { CrudResult } from './crud';
import { deriveUniqueHandle } from './short-links';

/** Account-level roles, most-privileged first. */
export const ACCOUNT_ROLES = ['owner', 'admin', 'member'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Member lifecycle within a workspace. */
export const MEMBER_STATUSES = ['active', 'invited', 'disabled'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export interface MemberView {
  id: string;
  email: string | null;
  displayName: string | null;
  handle: string | null;
  avatarUrl: string | null;
  role: AccountRole;
  status: MemberStatus;
  createdAt: number;
}

interface MemberDbRow {
  id: string;
  email: string | null;
  display_name: string | null;
  handle: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
  created_at: number;
}

function toMemberView(r: MemberDbRow): MemberView {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    handle: r.handle,
    avatarUrl: r.avatar_url,
    role: (r.role as AccountRole) ?? 'member',
    status: (r.status as MemberStatus) ?? 'active',
    createdAt: r.created_at,
  };
}

const MEMBER_COLS = sql`id, email, display_name, handle, avatar_url, role, status, created_at`;

/** All members of an account, oldest first (owner typically leads). */
export async function listMembers(db: Db, accountId: string): Promise<MemberView[]> {
  const rows = await db.all<MemberDbRow>(
    sql`SELECT ${MEMBER_COLS} FROM member WHERE account_id = ${accountId} ORDER BY created_at ASC, id ASC`,
  );
  return rows.map(toMemberView);
}

/** A single account member (scoped) — used by the permission layer + PATCH/DELETE. */
export async function getAccountMember(
  db: Db,
  accountId: string,
  memberId: string,
): Promise<MemberView | null> {
  const r = await db.get<MemberDbRow>(
    sql`SELECT ${MEMBER_COLS} FROM member WHERE account_id = ${accountId} AND id = ${memberId} LIMIT 1`,
  );
  return r ? toMemberView(r) : null;
}

/**
 * The caller's account role, or null if the member is unknown/foreign. The
 * permission layer resolves this from the AuthProvider principal's memberId.
 */
export async function getMemberRole(
  db: Db,
  accountId: string,
  memberId: string,
): Promise<AccountRole | null> {
  const r = await db.get<{ role: string }>(
    sql`SELECT role FROM member WHERE account_id = ${accountId} AND id = ${memberId} LIMIT 1`,
  );
  return r ? ((r.role as AccountRole) ?? 'member') : null;
}

/** Count active owners other than `excludeMemberId` (for the last-owner guard). */
async function otherActiveOwners(
  db: Db,
  accountId: string,
  excludeMemberId: string,
): Promise<number> {
  const row = await db.get<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM member
        WHERE account_id = ${accountId} AND role = 'owner' AND status = 'active'
          AND id <> ${excludeMemberId}`,
  );
  return Number(row?.n ?? 0);
}

const EMAIL_LOCAL = (email: string) => email.split('@')[0] ?? email;

/**
 * Invite a member by email → creates an `invited` member row with the given role
 * so they can be granted access before they ever sign in. An owner cannot be
 * invited (ownership is transferred, never handed out). A repeat email in the
 * same account is refused (EMAIL_TAKEN) rather than creating a duplicate.
 */
export async function inviteMember(
  db: Db,
  accountId: string,
  input: { email: string; role?: 'admin' | 'member'; displayName?: string | null },
): Promise<CrudResult<MemberView>> {
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, reason: 'CONFLICT', message: 'An email is required.' };
  const role: AccountRole = input.role === 'admin' ? 'admin' : 'member';

  const clash = await db.get<{ id: string }>(
    sql`SELECT id FROM member WHERE account_id = ${accountId} AND lower(email) = ${email} LIMIT 1`,
  );
  if (clash)
    return { ok: false, reason: 'EMAIL_TAKEN', message: 'A member with that email already exists.' };

  const id = randomUUID();
  // Auto-handle at creation (short-links §3): invited members are bookable the
  // moment they accept — no "set a handle" step, freely renameable later.
  const handle = await deriveUniqueHandle(db, accountId, input.displayName, email);
  await db.run(
    sql`INSERT INTO member (id, account_id, email, display_name, handle, role, status, created_at)
        VALUES (${id}, ${accountId}, ${email}, ${input.displayName ?? EMAIL_LOCAL(email)},
          ${handle}, ${role}, ${'invited'}, ${Date.now()})`,
  );
  return { ok: true, value: (await getAccountMember(db, accountId, id))! };
}

/**
 * Change a member's account role. Guards the last owner: demoting the sole active
 * owner would leave the workspace ownerless (LAST_OWNER). Promoting to owner is
 * allowed (co-owners), mirroring the team owner model.
 */
export async function changeMemberRole(
  db: Db,
  accountId: string,
  memberId: string,
  role: AccountRole,
): Promise<CrudResult<MemberView>> {
  if (!ACCOUNT_ROLES.includes(role))
    return { ok: false, reason: 'CONFLICT', message: 'Unknown role.' };
  const current = await getAccountMember(db, accountId, memberId);
  if (!current) return { ok: false, reason: 'NOT_FOUND' };
  if (current.role === role) return { ok: true, value: current };

  if (current.role === 'owner' && role !== 'owner') {
    if ((await otherActiveOwners(db, accountId, memberId)) === 0)
      return { ok: false, reason: 'LAST_OWNER', message: 'A workspace must keep at least one owner.' };
  }
  await db.run(sql`UPDATE member SET role = ${role} WHERE account_id = ${accountId} AND id = ${memberId}`);
  return { ok: true, value: (await getAccountMember(db, accountId, memberId))! };
}

/**
 * Enable/disable a member (soft access revocation). Disabling an owner is guarded
 * the same as demotion — the account must retain an active owner.
 */
export async function setMemberStatus(
  db: Db,
  accountId: string,
  memberId: string,
  status: MemberStatus,
): Promise<CrudResult<MemberView>> {
  if (!MEMBER_STATUSES.includes(status))
    return { ok: false, reason: 'CONFLICT', message: 'Unknown status.' };
  const current = await getAccountMember(db, accountId, memberId);
  if (!current) return { ok: false, reason: 'NOT_FOUND' };
  if (current.role === 'owner' && status !== 'active') {
    if ((await otherActiveOwners(db, accountId, memberId)) === 0)
      return { ok: false, reason: 'LAST_OWNER', message: 'A workspace must keep at least one owner.' };
  }
  await db.run(
    sql`UPDATE member SET status = ${status} WHERE account_id = ${accountId} AND id = ${memberId}`,
  );
  return { ok: true, value: (await getAccountMember(db, accountId, memberId))! };
}

/**
 * Remove a member from the workspace. Guards the last owner. Forms are
 * account-owned (not member-owned), so removing a member leaves the account's
 * forms and their submissions intact — only the roster row is deleted.
 */
export async function removeMember(
  db: Db,
  accountId: string,
  memberId: string,
): Promise<CrudResult<{ id: string }>> {
  const current = await getAccountMember(db, accountId, memberId);
  if (!current) return { ok: true, value: { id: memberId } }; // already gone — idempotent
  if (current.role === 'owner') {
    if ((await otherActiveOwners(db, accountId, memberId)) === 0)
      return { ok: false, reason: 'LAST_OWNER', message: 'A workspace must keep at least one owner.' };
  }
  await db.run(sql`DELETE FROM member WHERE account_id = ${accountId} AND id = ${memberId}`);
  return { ok: true, value: { id: memberId } };
}
