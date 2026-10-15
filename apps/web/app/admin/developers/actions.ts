'use server';

import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { adminApi, ApiError, type CreatedApiKey } from '@/lib/admin-api';
import { API_KEY_NAME_MAX } from './limits';

/**
 * The writes behind the Developers page: create and revoke an API key in the
 * workspace the caller is in (the cookie's, like the rest of the admin). The
 * API is the gate for who may revoke what; these only turn its answer into a
 * stable code the page localizes, never a raw server string.
 */

const PAGE = '/admin/developers/keys';

export type CreateApiKeyState =
  | { ok: true; key: CreatedApiKey }
  | { ok: false; code: 'INVALID' | 'KEY_LIMIT' | 'FORBIDDEN' | 'FAILED' };

/**
 * Create a key named `name`. The result is the ONLY place the full key ever
 * appears: the page shows it once and drops it when the dialog closes, and
 * nothing here logs it.
 */
export async function createApiKeyAction(name: string): Promise<CreateApiKeyState> {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || trimmed.length > API_KEY_NAME_MAX) return { ok: false, code: 'INVALID' };
  try {
    const key = await adminApi.createApiKey(trimmed);
    revalidatePath(PAGE);
    return { ok: true, key };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) {
      if (e.code === 'KEY_LIMIT') return { ok: false, code: 'KEY_LIMIT' };
      if (e.status === 400) return { ok: false, code: 'INVALID' };
      if (e.status === 403) return { ok: false, code: 'FORBIDDEN' };
    }
    return { ok: false, code: 'FAILED' };
  }
}

export type RevokeApiKeyState = { ok: true } | { ok: false; code: 'GONE' | 'FORBIDDEN' | 'FAILED' };

/**
 * Revoke one key. A 404 is NOT reported as a revoke: the API answers 404 both
 * for a key that is already revoked and for a key of another workspace, and
 * the second happens when the workspace cookie changed in another tab after
 * this page loaded. Claiming "revoked" there would leave a leaked key alive
 * while the person believes it is dead. So a 404 is `GONE`: the page says the
 * key is no longer in this workspace's list and refreshes it.
 */
export async function revokeApiKeyAction(id: string): Promise<RevokeApiKeyState> {
  if (typeof id !== 'string' || !id) return { ok: false, code: 'FAILED' };
  try {
    await adminApi.revokeApiKey(id);
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) {
      if (e.status === 404) {
        revalidatePath(PAGE);
        return { ok: false, code: 'GONE' };
      }
      if (e.status === 403) return { ok: false, code: 'FORBIDDEN' };
    }
    return { ok: false, code: 'FAILED' };
  }
}
