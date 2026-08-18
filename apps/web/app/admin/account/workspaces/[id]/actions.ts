'use server';

import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { adminApi, ApiError, isAdminRole, type MemberStatus } from '@/lib/admin-api';

/**
 * Member + invitation actions for ONE workspace, named by `accountId`.
 *
 * Account settings manages any workspace the caller belongs to WITHOUT
 * switching into it, so every call here carries `{ workspace: accountId }`
 * (the `x-quill-workspace` header) instead of relying on the cookie. The API
 * re-derives membership + role from that header on every request; the `me`
 * re-checks below are defence-in-depth so the UI never fires a call that would
 * be refused, never the gate.
 */

/** Both surfaces that render this workspace's roster. */
function revalidateWorkspace(accountId: string): void {
  revalidatePath(`/admin/account/workspaces/${accountId}`);
  revalidatePath('/admin/account/workspaces');
}

/** Machine-readable outcome of an invite so the client can localize the message. */
export type InviteMemberState =
  | { ok: true }
  | { ok: false; code: 'INVALID' | 'TAKEN' | 'UPSTREAM' | 'FAILED' }
  | null;

/**
 * Invite a member by email with an account role. The form carries `accountId`
 * (hidden input) so one component serves every workspace. Admin/owner only;
 * the API enforces this too.
 */
export async function inviteMemberAction(
  _prev: InviteMemberState,
  formData: FormData,
): Promise<InviteMemberState> {
  const accountId = String(formData.get('accountId') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const roleRaw = String(formData.get('role') ?? 'member');
  const role: 'admin' | 'member' = roleRaw === 'admin' ? 'admin' : 'member';

  if (!accountId) return { ok: false, code: 'FAILED' };
  // Cheap client-side-mirrored guard: a blank/invalid email never hits the API.
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, code: 'INVALID' };
  }

  try {
    const me = await adminApi.me({ workspace: accountId });
    if (!isAdminRole(me.role)) return { ok: false, code: 'FAILED' };
    await adminApi.inviteMember({ email, role }, { workspace: accountId });
    revalidateWorkspace(accountId);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) {
      if (e.code === 'EMAIL_TAKEN') return { ok: false, code: 'TAKEN' };
      // The identity service could not take it (role missing, unmanaged
      // workspace, refused payload): a retry with the same input will not help.
      if (e.code === 'ROLE_UNAVAILABLE' || e.code === 'NO_UPSTREAM') return { ok: false, code: 'UPSTREAM' };
      if (e.status === 400) return { ok: false, code: 'INVALID' };
    }
    return { ok: false, code: 'FAILED' };
  }
}

/**
 * Machine-readable outcome of a roster management op so the client localizes
 * the message. `LAST_OWNER` = the guarded 409 (would leave the workspace
 * ownerless); `FORBIDDEN` = the guarded 403; `OWNERSHIP` = ownership is only
 * transferred in the Dapta app; `UPSTREAM` = the identity service could not
 * apply the change; `FAILED` = anything else.
 */
export type ManageMemberState =
  | { ok: true }
  | { ok: false; code: 'LAST_OWNER' | 'FORBIDDEN' | 'OWNERSHIP' | 'UPSTREAM' | 'FAILED' };

/** Map an API failure to a stable, localizable code (never a raw server string). */
function manageError(e: unknown): ManageMemberState {
  if (e instanceof ApiError) {
    if (e.code === 'LAST_OWNER') return { ok: false, code: 'LAST_OWNER' };
    if (e.status === 403 || e.code === 'FORBIDDEN') return { ok: false, code: 'FORBIDDEN' };
    if (e.code === 'NOT_SUPPORTED_UPSTREAM') return { ok: false, code: 'OWNERSHIP' };
    // Identity-service deployments: the change could not be applied over there.
    if (e.code === 'NO_UPSTREAM' || e.code === 'ROLE_UNAVAILABLE') return { ok: false, code: 'UPSTREAM' };
  }
  return { ok: false, code: 'FAILED' };
}

/**
 * Change a member's account role (Member ⇄ Admin). Admin/owner only, an admin
 * cannot touch an owner, no self-service, and the last active owner cannot be
 * demoted (LAST_OWNER) — all enforced by the API.
 */
export async function updateMemberRoleAction(
  accountId: string,
  id: string,
  role: 'admin' | 'member',
): Promise<ManageMemberState> {
  if (role !== 'admin' && role !== 'member') return { ok: false, code: 'FAILED' };
  if (!accountId) return { ok: false, code: 'FAILED' };
  try {
    const me = await adminApi.me({ workspace: accountId });
    if (!isAdminRole(me.role)) return { ok: false, code: 'FORBIDDEN' };
    if (id === me.memberId) return { ok: false, code: 'FORBIDDEN' };
    await adminApi.updateMember(id, { role }, { workspace: accountId });
    revalidateWorkspace(accountId);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return manageError(e);
  }
}

/**
 * Enable / disable a member (never back to `invited`). Admin/owner only; the
 * last active owner cannot be disabled (LAST_OWNER).
 */
export async function setMemberStatusAction(
  accountId: string,
  id: string,
  status: Extract<MemberStatus, 'active' | 'disabled'>,
): Promise<ManageMemberState> {
  if (status !== 'active' && status !== 'disabled') return { ok: false, code: 'FAILED' };
  if (!accountId) return { ok: false, code: 'FAILED' };
  try {
    const me = await adminApi.me({ workspace: accountId });
    if (!isAdminRole(me.role)) return { ok: false, code: 'FORBIDDEN' };
    if (id === me.memberId) return { ok: false, code: 'FORBIDDEN' };
    await adminApi.updateMember(id, { status }, { workspace: accountId });
    revalidateWorkspace(accountId);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return manageError(e);
  }
}

/**
 * Remove a member from the workspace. OWNER only for an accepted membership
 * (the identity service's rule, mirrored by the API on the local path too);
 * an admin may retract an `invited` row. You cannot remove yourself; the last
 * active owner cannot be removed (LAST_OWNER). Forms are account-owned, so
 * removing a member never deletes forms or submissions. The API is the gate
 * for the owner/invited distinction; here only the admin floor is mirrored.
 */
export async function removeMemberAction(accountId: string, id: string): Promise<ManageMemberState> {
  if (!accountId) return { ok: false, code: 'FAILED' };
  try {
    const me = await adminApi.me({ workspace: accountId });
    if (!isAdminRole(me.role)) return { ok: false, code: 'FORBIDDEN' };
    if (id === me.memberId) return { ok: false, code: 'FORBIDDEN' };
    await adminApi.removeMember(id, { workspace: accountId });
    revalidateWorkspace(accountId);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return manageError(e);
  }
}

/** Resend a pending invitation (identity-service deployments). */
export async function resendInvitationAction(accountId: string, id: string): Promise<{ ok: boolean }> {
  if (!accountId) return { ok: false };
  try {
    await adminApi.resendInvitation(id, { workspace: accountId });
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false };
  }
}
