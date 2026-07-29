'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { setWorkspace } from '@/lib/auth-session';
import { adminApi } from '@/lib/admin-api';

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
 */
export async function switchWorkspaceAction(accountId: string): Promise<{ error?: string }> {
  const id = accountId.trim();
  if (!id) return { error: 'unknown' };

  const workspaces = await adminApi.listWorkspaces();
  const target = workspaces.find((w) => w.accountId === id);
  if (!target) return { error: 'forbidden' };

  await setWorkspace(id);
  // Every admin page is scoped to the account, so all of it is now stale.
  revalidatePath('/admin', 'layout');
  redirect('/admin');
}
