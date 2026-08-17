'use server';

import { unstable_rethrow } from 'next/navigation';

import { revalidatePath } from 'next/cache';
import type { MemberProfile } from '@quill/types';
import {
  adminApi,
  ApiError,
  isAdminRole,
  type NotificationEmailKey,
  type NotificationPatch,
  type NotificationSettingView,
} from '@/lib/admin-api';

/** Machine-readable outcome of an invite so the client can localize the message. */
export type InviteMemberState =
  | { ok: true }
  | { ok: false; code: 'INVALID' | 'TAKEN' | 'FAILED' }
  | null;

/**
 * Invite a member by email with an account role. The API creates an `invited`
 * member row that is adopted (bound + activated, keeping the granted role) the
 * first time that email signs in — the JIT invite→adoption model. Admin/owner
 * only; the API enforces this too, this is a defence-in-depth re-check.
 *
 * Returns a stable code (never a raw server string) so the Settings UI renders a
 * localized message. Success revalidates the roster so the new member appears.
 */
export async function inviteMemberAction(
  _prev: InviteMemberState,
  formData: FormData,
): Promise<InviteMemberState> {
  const email = String(formData.get('email') ?? '').trim();
  const roleRaw = String(formData.get('role') ?? 'member');
  const role: 'admin' | 'member' = roleRaw === 'admin' ? 'admin' : 'member';

  // Cheap client-side-mirrored guard: a blank/invalid email never hits the API.
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, code: 'INVALID' };
  }

  // Only admins/owners can manage the roster (the API is the real gate).
  const me = await adminApi.me();
  if (!isAdminRole(me.role)) return { ok: false, code: 'FAILED' };

  try {
    await adminApi.inviteMember({ email, role });
    revalidatePath('/admin/settings');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) {
      if (e.code === 'EMAIL_TAKEN') return { ok: false, code: 'TAKEN' };
      if (e.status === 400) return { ok: false, code: 'INVALID' };
    }
    return { ok: false, code: 'FAILED' };
  }
}

/**
 * Machine-readable outcome of a roster management op (change-role / remove) so the
 * client localizes the message. `LAST_OWNER` = the guarded 409 (would leave the
 * workspace ownerless); `FORBIDDEN` = the guarded 403 (non-admin, or an admin
 * touching an owner); `FAILED` = anything else.
 */
export type ManageMemberState =
  | { ok: true }
  | { ok: false; code: 'LAST_OWNER' | 'FORBIDDEN' | 'FAILED' };

/** Map an API failure to a stable, localizable code (never a raw server string). */
function manageError(e: unknown): ManageMemberState {
  if (e instanceof ApiError) {
    if (e.code === 'LAST_OWNER') return { ok: false, code: 'LAST_OWNER' };
    if (e.status === 403 || e.code === 'FORBIDDEN') return { ok: false, code: 'FORBIDDEN' };
  }
  return { ok: false, code: 'FAILED' };
}

/**
 * Change a member's account role (Member ⇄ Admin). The API is the real gate:
 * admin/owner only, an admin cannot touch an owner, no self-service, and the
 * last active owner cannot be demoted (LAST_OWNER). This mirrored admin check is
 * defence-in-depth. Success revalidates the roster so the new role renders.
 */
export async function updateMemberRoleAction(
  id: string,
  role: 'admin' | 'member',
): Promise<ManageMemberState> {
  if (role !== 'admin' && role !== 'member') return { ok: false, code: 'FAILED' };
  const me = await adminApi.me();
  if (!isAdminRole(me.role)) return { ok: false, code: 'FORBIDDEN' };
  try {
    await adminApi.updateMember(id, { role });
    revalidatePath('/admin/settings');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return manageError(e);
  }
}

/**
 * Remove a member from the workspace. Admin/owner only; an admin cannot remove an
 * owner; you cannot remove yourself; the last active owner cannot be removed
 * (LAST_OWNER). Forms are account-owned, so removing a member never deletes
 * forms or submissions — only the roster row. Success revalidates the roster.
 */
export async function removeMemberAction(id: string): Promise<ManageMemberState> {
  const me = await adminApi.me();
  if (!isAdminRole(me.role)) return { ok: false, code: 'FORBIDDEN' };
  if (id === me.memberId) return { ok: false, code: 'FORBIDDEN' };
  try {
    await adminApi.removeMember(id);
    revalidatePath('/admin/settings');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return manageError(e);
  }
}

/**
 * Outcome of a notification-email write. On success the freshly-persisted setting
 * is returned so the client can reconcile its state (e.g. a reset flips subject/
 * body back to null). Admin/owner only; the API is the real gate, this mirrored
 * check is defence-in-depth.
 */
export type NotificationSaveState =
  | { ok: true; setting: NotificationSettingView }
  | { ok: false; code: 'FORBIDDEN' | 'FAILED' };

/** Save one submission email's toggle + custom subject/body (null resets a field). */
export async function saveNotificationAction(
  emailKey: NotificationEmailKey,
  patch: NotificationPatch,
): Promise<NotificationSaveState> {
  const me = await adminApi.me();
  if (!isAdminRole(me.role)) return { ok: false, code: 'FORBIDDEN' };
  try {
    const setting = await adminApi.updateNotification(emailKey, patch);
    revalidatePath('/admin/settings');
    return { ok: true, setting };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError && (e.status === 403 || e.code === 'FORBIDDEN')) {
      return { ok: false, code: 'FORBIDDEN' };
    }
    return { ok: false, code: 'FAILED' };
  }
}

/** Reset one submission email's subject+body to the shipped default (keeps toggle). */
export async function resetNotificationAction(
  emailKey: NotificationEmailKey,
): Promise<NotificationSaveState> {
  const me = await adminApi.me();
  if (!isAdminRole(me.role)) return { ok: false, code: 'FORBIDDEN' };
  try {
    const setting = await adminApi.resetNotification(emailKey);
    revalidatePath('/admin/settings');
    return { ok: true, setting };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError && (e.status === 403 || e.code === 'FORBIDDEN')) {
      return { ok: false, code: 'FORBIDDEN' };
    }
    return { ok: false, code: 'FAILED' };
  }
}

/**
 * Save (or clear) the caller's own public page. Scoped server-side to the
 * authenticated member — the id is never taken from the request.
 */
export async function saveMyProfileAction(
  profile: MemberProfile | null,
): Promise<{ ok: boolean; message?: string }> {
  try {
    await adminApi.saveMyProfile(profile);
    revalidatePath('/admin/settings');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Could not save.',
    };
  }
}

/** Resend a pending invitation (identity-service deployments). */
export async function resendInvitationAction(id: string): Promise<{ ok: boolean }> {
  try {
    await adminApi.resendInvitation(id);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false };
  }
}
