'use server';

import { revalidatePath } from 'next/cache';
import { adminApi } from '@/lib/admin-api';
import type { FormDestination } from '@quill/types';

/**
 * Save the integrations (destinations) for a form. Uses the API's PARTIAL
 * `destinations` write (PUT /v1/forms/:id/destinations) which merges only that
 * key against the form's fresh config server-side in ONE request — a concurrent
 * editor save of steps/cover/scoring is never clobbered by this screen (the old
 * shape read the whole config here and wrote it back across two requests,
 * racing the editor).
 *
 * NOTE (optimistic locking): true write-write safety on the SAME key (e.g. two
 * integrations tabs) still needs config versioning / compare-and-set — a general
 * question for every config writer, tracked separately and out of scope here.
 */
export async function saveIntegrationsAction(
  id: string,
  destinations: FormDestination[],
): Promise<{ ok: boolean; message?: string }> {
  try {
    await adminApi.updateFormDestinations(id, destinations);
    revalidatePath(`/admin/forms/${id}/integrations`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Failed to save.' };
  }
}
