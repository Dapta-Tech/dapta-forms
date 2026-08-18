'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { setWorkspace } from '@/lib/auth-session';
import { adminApi, ApiError } from '@/lib/admin-api';

/**
 * Enter a different workspace.
 *
 * The choice is written into the signed session cookie and nothing else — no
 * new token is minted and no membership is granted here. The API re-derives
 * membership on every subsequent request and answers 403 if it does not hold,
 * so this action cannot widen anyone's access even if the id it is handed is
 * wrong or hostile.
 *
 * It still verifies BEFORE writing, because failing at the moment of the click
 * is far better than storing a choice that makes the next page 403 and bounce.
 * `enterWorkspace` is that check — and it also remembers the choice upstream
 * (when there is an upstream), so the Dapta app opens the same workspace next.
 */
export async function switchWorkspaceAction(accountId: string): Promise<{ error?: string }> {
  const id = accountId.trim();
  if (!id) return { error: 'unknown' };

  try {
    await adminApi.enterWorkspace(id);
  } catch (e) {
    unstable_rethrow(e);
    return { error: 'forbidden' };
  }

  await setWorkspace(id);
  // Every admin page is scoped to the account, so all of it is now stale.
  revalidatePath('/admin', 'layout');
  redirect('/admin');
}

export type CreateWorkspaceState =
  | null
  | { ok: true }
  | { ok: false; code: 'INVALID' | 'FORBIDDEN' | 'FAILED' };

/**
 * Create a workspace and enter it. Owner is the caller; with the identity
 * service configured the workspace is created THERE first (so the rest of the
 * Dapta estate sees it) and then projected here.
 */
export async function createWorkspaceAction(
  _prev: CreateWorkspaceState,
  formData: FormData,
): Promise<CreateWorkspaceState> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name || name.length > 80) return { ok: false, code: 'INVALID' };

  let accountId: string;
  try {
    const res = await adminApi.createWorkspace(name);
    accountId = res.accountId;
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) {
      if (e.status === 403) return { ok: false, code: 'FORBIDDEN' };
      if (e.status === 400) return { ok: false, code: 'INVALID' };
    }
    return { ok: false, code: 'FAILED' };
  }

  await setWorkspace(accountId);
  revalidatePath('/admin', 'layout');
  redirect('/admin');
}

/**
 * Re-read the workspace list from the identity service (when there is one) —
 * fired when the switcher opens, so a workspace created or joined in the Dapta
 * app shows up without waiting for the TTL.
 */
export async function refreshWorkspacesAction(): Promise<{ ok: boolean }> {
  try {
    await adminApi.refreshWorkspaces();
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false };
  }
  revalidatePath('/admin', 'layout');
  return { ok: true };
}

export type RenameWorkspaceState =
  | null
  | { ok: true }
  | { ok: false; code: 'INVALID' | 'FORBIDDEN' | 'FAILED' };

/** Rename the current workspace (admin/owner; the API is the real gate). */
export async function renameWorkspaceAction(
  _prev: RenameWorkspaceState,
  formData: FormData,
): Promise<RenameWorkspaceState> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name || name.length > 80) return { ok: false, code: 'INVALID' };
  try {
    await adminApi.renameWorkspace(name);
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) {
      if (e.status === 403) return { ok: false, code: 'FORBIDDEN' };
      if (e.status === 400) return { ok: false, code: 'INVALID' };
    }
    return { ok: false, code: 'FAILED' };
  }
  revalidatePath('/admin', 'layout');
  return { ok: true };
}
