'use server';

import { revalidatePath } from 'next/cache';
import { adminApi } from '@/lib/admin-api';
import type { FormDestination } from '@quill/types';

/**
 * Merge the integrations (destinations) into the form's existing config WITHOUT
 * clobbering steps/cover/scoring/outcomes (those are owned by the editor). Reads
 * the current config, replaces only `destinations`, and saves.
 */
export async function saveIntegrationsAction(
  id: string,
  destinations: FormDestination[],
): Promise<{ ok: boolean; message?: string }> {
  try {
    const form = await adminApi.getForm(id);
    const config = { ...(form.config as Record<string, unknown>), destinations };
    await adminApi.updateForm(id, { config });
    revalidatePath(`/admin/forms/${id}/integrations`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Failed to save.' };
  }
}
