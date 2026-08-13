'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { adminApi } from '@/lib/admin-api';

/** Create a form and jump straight into its editor. */
export async function createFormAction(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim() || 'Untitled form';
  // Layout picked in the create dialog. Only 'vertical' is stored — an absent
  // `layout` already means slides (the engine's back-compat default), so a
  // slides form keeps the exact config shape every existing form has.
  const layout = String(formData.get('layout') ?? '');
  const created = await adminApi.createForm({
    name,
    ...(layout === 'vertical' ? { config: { version: 1, steps: [], layout: 'vertical' } } : {}),
  });
  revalidatePath('/admin');
  revalidatePath('/admin/forms');
  redirect(`/admin/forms/${created.id}/edit`);
}

export async function duplicateFormAction(id: string): Promise<void> {
  await adminApi.duplicateForm(id);
  revalidatePath('/admin');
  revalidatePath('/admin/forms');
}

export async function deleteFormAction(id: string): Promise<void> {
  await adminApi.deleteForm(id);
  revalidatePath('/admin');
  revalidatePath('/admin/forms');
}

/**
 * Editor autosave. Draft→publish split: `config` is stored as an UNPUBLISHED
 * draft (the live form the public page serves is untouched); `name` applies
 * immediately (metadata is not part of the draft flow). Publishing the draft is
 * a separate, explicit `publishFormAction`.
 */
export async function saveFormAction(
  id: string,
  patch: { name?: string; config?: unknown },
): Promise<{ ok: boolean; message?: string }> {
  try {
    await adminApi.updateForm(id, patch);
    // No revalidatePath here on purpose: this fires on every debounced
    // keystroke, every admin read is already `cache: 'no-store'`, and the
    // draft it writes is visible only to this editor. Publish revalidates.
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Failed to save.',
    };
  }
}

/**
 * Make the pending draft live: POST /v1/forms/:id/publish copies draft_config
 * over the live config, stamps published_at, and clears the draft (a no-op when
 * nothing is pending).
 */
export async function publishFormAction(id: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await adminApi.publishForm(id);
    revalidatePath(`/admin/forms/${id}/edit`);
    revalidatePath('/admin');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Failed to publish.',
    };
  }
}
