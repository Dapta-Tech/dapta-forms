'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { hostFetch } from '@/lib/auth-session';

export type ActionResult = { ok: boolean; message?: string };

export async function saveGeneralAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const displayName = String(form.get('displayName') ?? '');
    const timeZone = String(form.get('timeZone') ?? 'UTC');
    const handle = String(form.get('handle') ?? '').trim();

    // Rename handle first (if changed + present); only then save the rest.
    if (handle) {
      const r = await hostFetch(`/v1/me/handle`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle }),
      });
      if (!r.ok && r.status !== 409) {
        return { ok: false, message: 'Failed to update handle.' };
      }
      if (r.status === 409) {
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        return { ok: false, message: `Handle unavailable (${j.message ?? 'taken'}).` };
      }
    }

    const res = await hostFetch(`/v1/me/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName, timeZone }),
    });
    if (!res.ok) return { ok: false, message: 'Failed to save settings.' };
    revalidatePath('/admin/settings/general');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, message: e instanceof Error ? e.message : 'Failed' };
  }
}
