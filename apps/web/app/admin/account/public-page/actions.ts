'use server';

import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { LinkPageInput } from '@quill/types';
import { adminApi } from '@/lib/admin-api';

/**
 * Save (or clear) the workspace link page. The workspace is the caller's own,
 * resolved server-side from the session; the API validates the page with
 * `linkPageSchema` and answers 400 with the field when something is off.
 */
export async function saveLinkPageAction(
  page: LinkPageInput | null,
): Promise<{ ok: boolean; message?: string }> {
  try {
    await adminApi.saveLinkPage(page);
    revalidatePath('/admin/account/public-page');
    // Home shows the page's link only while it is published, so a toggle here
    // has to reach that page too.
    revalidatePath('/admin');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Could not save.',
    };
  }
}
