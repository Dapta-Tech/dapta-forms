'use server';

import { revalidatePath } from 'next/cache';
import { adminApi, ApiError, isAdminRole } from '@/lib/admin-api';

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
    if (e instanceof ApiError) {
      if (e.code === 'EMAIL_TAKEN') return { ok: false, code: 'TAKEN' };
      if (e.status === 400) return { ok: false, code: 'INVALID' };
    }
    return { ok: false, code: 'FAILED' };
  }
}
