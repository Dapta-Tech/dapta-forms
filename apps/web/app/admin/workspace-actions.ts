'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { setWorkspace } from '@/lib/auth-session';
import { adminApi, ApiError, type WorkspaceSearchRow } from '@/lib/admin-api';

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

/**
 * Type-to-find over the workspaces the caller may enter (the switcher's search
 * box). Own workspaces always; the deployment's staff also get the estate. A
 * failure is an empty result, never an error the menu has to explain.
 */
export async function searchWorkspacesAction(
  q: string,
): Promise<{ rows: WorkspaceSearchRow[]; staff: boolean }> {
  try {
    const res = await adminApi.searchWorkspaces(q.slice(0, 120));
    return { rows: res.rows, staff: res.staff };
  } catch (e) {
    unstable_rethrow(e);
    return { rows: [], staff: false };
  }
}

/**
 * Staff only: enter an estate workspace the caller holds no membership in. The
 * API re-reads the workspace upstream, projects it, mints the access grant and
 * remembers the choice; then this is a plain switch.
 */
export async function enterEstateWorkspaceAction(workspaceId: string): Promise<{ error?: string }> {
  const id = workspaceId.trim();
  if (!id) return { error: 'unknown' };
  let accountId: string;
  try {
    accountId = (await adminApi.enterEstateWorkspace(id)).accountId;
  } catch (e) {
    unstable_rethrow(e);
    return { error: 'forbidden' };
  }
  await setWorkspace(accountId);
  revalidatePath('/admin', 'layout');
  redirect('/admin');
}

export type CreateWorkspaceState =
  | null
  | { ok: true }
  | { ok: false; code: 'INVALID' | 'FORBIDDEN' | 'FAILED' }
  /** The identity service refused, with its own reason (a plan limit, a rule). */
  | { ok: false; code: 'REJECTED'; message: string };

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
      // Upstream said no and said why: show that, it is the only actionable
      // text. Without a reason (ApiError falls back to the code itself), the
      // dialog's own localized copy is better than echoing a code.
      if (e.code === 'WORKSPACE_CREATE_REJECTED') {
        return e.message && e.message !== e.code
          ? { ok: false, code: 'REJECTED', message: e.message }
          : { ok: false, code: 'FAILED' };
      }
      // Created upstream, not visible yet: not the name's fault.
      if (e.code === 'WORKSPACE_NOT_VISIBLE') return { ok: false, code: 'FAILED' };
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

/**
 * Rename a workspace (admin/owner; the API is the real gate). The form may name
 * the workspace with a hidden `accountId` — Account settings manages any
 * workspace by id without switching into it; absent, the current one.
 */
export async function renameWorkspaceAction(
  _prev: RenameWorkspaceState,
  formData: FormData,
): Promise<RenameWorkspaceState> {
  const name = String(formData.get('name') ?? '').trim();
  const accountId = String(formData.get('accountId') ?? '').trim();
  if (!name || name.length > 80) return { ok: false, code: 'INVALID' };
  try {
    await adminApi.renameWorkspace(name, accountId ? { workspace: accountId } : undefined);
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
