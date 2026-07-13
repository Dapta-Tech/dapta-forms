'use server';

import { revalidatePath } from 'next/cache';
import { adminApi } from '@/lib/admin-api';

export type ActionResult = { ok: boolean; message?: string };

export async function createConnectionAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  try {
    await adminApi.createConnection({
      provider: String(form.get('provider') ?? 'google'),
      externalId: String(form.get('externalId') ?? ''),
      primaryEmail: form.get('primaryEmail') ? String(form.get('primaryEmail')) : undefined,
      checkConflicts: form.get('checkConflicts') === 'on',
      isDestination: form.get('isDestination') === 'on',
    });
    revalidatePath('/admin/connections');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function deleteConnectionAction(id: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await adminApi.deleteConnection(id);
    revalidatePath('/admin/connections');
    return { ok: true };
  } catch (e) {
    // Surfaces LAST_DESTINATION_REQUIRED (409) and any other API error.
    return { ok: false, message: e instanceof Error ? e.message : 'Could not disconnect.' };
  }
}

export async function toggleConnectionAction(
  id: string,
  patch: { isDestination?: boolean; checkConflicts?: boolean },
): Promise<ActionResult> {
  try {
    await adminApi.updateConnection(id, patch);
    revalidatePath('/admin/connections');
    return { ok: true };
  } catch (e) {
    // Report failure so the client can roll back its optimistic update and
    // surface the reason instead of silently persisting the wrong state.
    return { ok: false, message: e instanceof Error ? e.message : 'Update failed.' };
  }
}

export async function pingConnectionAction(
  id: string,
): Promise<{ ok: boolean; enabled: boolean; message: string }> {
  try {
    const r = await adminApi.pingConnection(id);
    return { ok: r.ok, enabled: r.enabled, message: r.message };
  } catch (e) {
    // Never throw at the boundary: a failed probe is itself a health signal.
    return { ok: false, enabled: true, message: e instanceof Error ? e.message : 'Health check failed.' };
  }
}

export async function connectCalendarAction(
  provider: string,
): Promise<{ enabled: boolean; connectUrl: string | null; message: string }> {
  const r = await adminApi.connectionToken(provider);
  return { enabled: r.enabled, connectUrl: r.connectUrl, message: r.message };
}

/**
 * Called after the OAuth popup completes: persist the tenant's just-connected
 * account(s) and return how many connections are now on record so the client can
 * detect that the connect finished.
 */
export async function discoverConnectionsAction(
  provider: string,
): Promise<{ ok: boolean; count: number; message?: string }> {
  try {
    const conns = await adminApi.discoverConnections(provider);
    revalidatePath('/admin/connections');
    return { ok: true, count: conns.length };
  } catch (e) {
    return { ok: false, count: 0, message: e instanceof Error ? e.message : 'Discovery failed' };
  }
}
