'use server';

import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { MemberProfile } from '@quill/types';
import { adminApi } from '@/lib/admin-api';

/**
 * Save (or clear) the caller's own public page. Scoped server-side to the
 * authenticated member — the id is never taken from the request.
 */
export async function saveMyProfileAction(
  profile: MemberProfile | null,
): Promise<{ ok: boolean; message?: string }> {
  try {
    await adminApi.saveMyProfile(profile);
    revalidatePath('/admin/account/public-page');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Could not save.',
    };
  }
}
