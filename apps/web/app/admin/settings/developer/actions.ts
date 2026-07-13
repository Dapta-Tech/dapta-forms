'use server';

import { unstable_rethrow } from 'next/navigation';

import { revalidatePath } from 'next/cache';
import { adminApi } from '@/lib/admin-api';

export async function createApiKeyAction(name: string, scopes: string[]): Promise<{ plaintext?: string; error?: string }> {
  try {
    const r = await adminApi.createApiKey({ name, scopes });
    revalidatePath('/admin/settings/developer');
    return { plaintext: r.plaintext };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function revokeApiKeyAction(id: string): Promise<void> {
  await adminApi.revokeApiKey(id);
  revalidatePath('/admin/settings/developer');
}

export async function createWebhookAction(subscriberUrl: string, triggers: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    await adminApi.createWebhook({ subscriberUrl, eventTriggers: triggers });
    revalidatePath('/admin/settings/developer');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function deleteWebhookAction(id: string): Promise<void> {
  await adminApi.deleteWebhook(id);
  revalidatePath('/admin/settings/developer');
}

export async function toggleWebhookAction(id: string, active: boolean): Promise<void> {
  await adminApi.updateWebhook(id, active);
  revalidatePath('/admin/settings/developer');
}

export async function pingWebhookAction(id: string): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await adminApi.pingWebhook(id);
    return { ok: r.ok, message: r.ok ? `Delivered (${r.status})` : (r.message ?? 'Failed') };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, message: e instanceof Error ? e.message : 'Failed' };
  }
}
