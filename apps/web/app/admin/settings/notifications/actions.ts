'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { hostFetch } from '@/lib/auth-session';

export type ActionResult = { ok: boolean; message?: string };

export interface PreviewResult {
  ok: boolean;
  subject?: string;
  text?: string;
  unknownTokens?: string[];
  message?: string;
}

async function patchSetting(key: string, body: Record<string, unknown>): Promise<ActionResult> {
  try {
    const res = await hostFetch(`/v1/notification-settings/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      return { ok: false, message: j.message };
    }
    revalidatePath('/admin/settings/notifications');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, message: e instanceof Error ? e.message : 'Failed' };
  }
}

/** Flip one email type on/off. */
export async function toggleNotificationAction(key: string, enabled: boolean): Promise<ActionResult> {
  return patchSetting(key, { enabled });
}

/** Save a custom subject/body (empty strings reset that field to the default). */
export async function saveTemplateAction(
  key: string,
  subject: string | null,
  body: string | null,
): Promise<ActionResult> {
  return patchSetting(key, { subject, body });
}

/** Save lead times (reminders: minutes before start; follow_up: after end). */
export async function saveLeadsAction(key: string, leads: number[]): Promise<ActionResult> {
  return patchSetting(key, { reminderLeadMinutes: leads });
}

/** Reset a template to the shipped default (toggle untouched). */
export async function resetTemplateAction(key: string): Promise<ActionResult> {
  try {
    const res = await hostFetch(`/v1/notification-settings/${encodeURIComponent(key)}/template`, {
      method: 'DELETE',
    });
    if (!res.ok) return { ok: false };
    revalidatePath('/admin/settings/notifications');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof Error ? e.message : 'Failed' };
  }
}

/**
 * Server-side render of a draft template against sample data — the exact
 * renderer the outbox uses, so the preview is the email. Returns plain text
 * (never HTML — nothing is dangerously injected client-side).
 */
export async function previewTemplateAction(
  key: string,
  subject: string | null,
  body: string | null,
): Promise<PreviewResult> {
  try {
    const res = await hostFetch(`/v1/notification-settings/${encodeURIComponent(key)}/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject, body }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      return { ok: false, message: j.message };
    }
    const j = (await res.json()) as { subject: string; text: string; unknownTokens: string[] };
    return { ok: true, subject: j.subject, text: j.text, unknownTokens: j.unknownTokens };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof Error ? e.message : 'Failed' };
  }
}
