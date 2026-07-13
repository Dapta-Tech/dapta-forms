'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { adminApi, ApiError, type AccountRole, type MemberStatus } from '@/lib/admin-api';

export type ActionResult = { ok: boolean; message?: string };
/** Invite carries a stable code so the client can localize (email / duplicate / generic). */
export type InviteResult = { ok: boolean; code?: 'INVALID_EMAIL' | 'EMAIL_TAKEN' | 'FAILED'; message?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Invite a member by email with a role (admin or member). Creates an invited row. */
export async function inviteMemberAction(
  email: string,
  role: 'admin' | 'member',
): Promise<InviteResult> {
  const target = email.trim().toLowerCase();
  if (!target || !EMAIL_RE.test(target)) return { ok: false, code: 'INVALID_EMAIL' };
  try {
    await adminApi.inviteMember({ email: target, role });
    revalidatePath('/admin/settings/members');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    if (e instanceof ApiError && e.code === 'EMAIL_TAKEN') return { ok: false, code: 'EMAIL_TAKEN' };
    return { ok: false, code: 'FAILED', message: e instanceof Error ? e.message : undefined };
  }
}

/** Change a member's account role. The BE guards the last owner + admin-vs-owner. */
export async function setMemberRoleAction(id: string, role: AccountRole): Promise<ActionResult> {
  try {
    await adminApi.updateMember(id, { role });
    revalidatePath('/admin/settings/members');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof Error ? e.message : undefined };
  }
}

/** Enable/disable a member (soft access revocation). */
export async function setMemberStatusAction(id: string, status: MemberStatus): Promise<ActionResult> {
  try {
    await adminApi.updateMember(id, { status });
    revalidatePath('/admin/settings/members');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof Error ? e.message : undefined };
  }
}

/** Remove a member from the workspace (BE guards the last owner). */
export async function removeMemberAction(id: string): Promise<ActionResult> {
  try {
    await adminApi.removeMember(id);
    revalidatePath('/admin/settings/members');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof Error ? e.message : undefined };
  }
}
