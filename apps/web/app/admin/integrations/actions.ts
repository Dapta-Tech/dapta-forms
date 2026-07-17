'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import {
  adminApi,
  ApiError,
  type IntegrationProvider,
  type IntegrationStatus,
} from '@/lib/admin-api';

/**
 * Account-level connection actions for the global connections surface
 * (/admin/integrations). The pasted token travels client → server action → API
 * and is never returned to the browser: `connect` echoes only the token-free
 * status (label + last4). `unstable_rethrow` lets a `req()` 401→redirect escape
 * the catch (a mid-session expiry bounces to /login instead of a dead toast).
 */

export type ConnectResult =
  | { ok: true; status: IntegrationStatus }
  | { ok: false; code?: string; message?: string };

export async function connectIntegrationAction(
  provider: IntegrationProvider,
  token: string,
): Promise<ConnectResult> {
  try {
    const status = await adminApi.connectIntegration(provider, token);
    revalidatePath('/admin/integrations');
    return { ok: true, status };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) return { ok: false, code: e.code, message: e.message };
    return { ok: false };
  }
}

export async function disconnectIntegrationAction(
  provider: IntegrationProvider,
): Promise<{ ok: boolean; message?: string }> {
  try {
    await adminApi.disconnectIntegration(provider);
    revalidatePath('/admin/integrations');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) return { ok: false, message: e.message };
    return { ok: false };
  }
}
