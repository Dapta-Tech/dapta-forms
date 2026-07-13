'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adminApi } from '@/lib/admin-api';

/** Create a form and jump straight into its editor. */
export async function createFormAction(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim() || 'Untitled form';
  const created = await adminApi.createForm({ name });
  revalidatePath('/admin');
  redirect(`/admin/forms/${created.id}/edit`);
}

export async function duplicateFormAction(id: string): Promise<void> {
  await adminApi.duplicateForm(id);
  revalidatePath('/admin');
}

export async function deleteFormAction(id: string): Promise<void> {
  await adminApi.deleteForm(id);
  revalidatePath('/admin');
}

/** Save the raw config JSON from the placeholder editor (Phase 1 replaces this). */
export async function saveFormAction(
  id: string,
  patch: { name?: string; config?: unknown },
): Promise<{ ok: boolean; message?: string }> {
  try {
    await adminApi.updateForm(id, patch);
    revalidatePath(`/admin/forms/${id}/edit`);
    revalidatePath('/admin');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Failed to save.' };
  }
}
