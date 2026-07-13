'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { adminApi } from '@/lib/admin-api';
import { hostFetch } from '@/lib/auth-session';

export type SaveResult = { ok: boolean; message?: string; field?: 'handle' | 'vanity' | 'branding' };

/**
 * Handle-availability check (server action) — `/v1/handle-available` is
 * identity-scoped, so the client CANNOT call it directly (the httpOnly session
 * cookie isn't readable cross-origin under workos). Routed through adminApi so
 * it carries identity + the global 401 guard.
 */
export async function checkHandleAction(
  handle: string,
): Promise<{ available: boolean; suggestion?: string | null }> {
  try {
    const r = await adminApi.handleAvailable(handle);
    return { available: r.available, suggestion: r.suggestion ?? null };
  } catch (e) {
    unstable_rethrow(e); // a 401 redirects to /login rather than reporting "taken"
    return { available: false };
  }
}

/** Show/hide an event type on the public booking page (studio Meetings panel). */
export async function toggleEventHiddenAction(id: string, hidden: boolean): Promise<{ ok: boolean; message?: string }> {
  try {
    await adminApi.updateEventType(id, { hidden });
    revalidatePath('/admin/settings/booking-page');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, message: e instanceof Error ? e.message : 'Could not update visibility.' };
  }
}

export interface StudioPayload {
  handle?: string;
  /** Vanity slug change: a string claims/changes it, null clears it, undefined = untouched. */
  vanitySlug?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  brandColor?: string | null;
  style?: Record<string, unknown>;
}

/**
 * Persist the studio (F20h ordering): rename the handle FIRST — only if that
 * succeeds do we save the branding, so a taken handle never partially saves.
 */
export async function saveStudioAction(payload: StudioPayload): Promise<SaveResult> {
  try {
    if (payload.handle) {
      const res = await hostFetch(`/v1/me/handle`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: payload.handle }),
      });
      if (res.status === 409) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        return { ok: false, field: 'handle', message: `Handle unavailable (${j.message ?? 'taken'}).` };
      }
      if (!res.ok) return { ok: false, field: 'handle', message: 'Could not update handle.' };
    }

    if (payload.vanitySlug !== undefined) {
      const res = await hostFetch(`/v1/account/vanity`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vanitySlug: payload.vanitySlug }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        return { ok: false, field: 'vanity', message: j.message ?? 'Could not update the link.' };
      }
    }

    await adminApi.updateBranding({
      displayName: payload.displayName,
      avatarUrl: payload.avatarUrl,
      coverUrl: payload.coverUrl,
      brandColor: payload.brandColor,
      style: payload.style,
    });
    revalidatePath('/admin/settings/booking-page');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, field: 'branding', message: e instanceof Error ? e.message : 'Failed' };
  }
}
