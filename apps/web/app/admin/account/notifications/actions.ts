'use server';

import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  adminApi,
  ApiError,
  isAdminRole,
  type NotificationEmailKey,
  type NotificationPatch,
  type NotificationSettingView,
} from '@/lib/admin-api';

/**
 * Outcome of a notification-email write. On success the freshly-persisted setting
 * is returned so the client can reconcile its state (e.g. a reset flips subject/
 * body back to null). Admin/owner only; the API is the real gate, this mirrored
 * check is defence-in-depth.
 */
export type NotificationSaveState =
  | { ok: true; setting: NotificationSettingView }
  | { ok: false; code: 'FORBIDDEN' | 'FAILED' };

/** Save one submission email's toggle + custom subject/body (null resets a field). */
export async function saveNotificationAction(
  emailKey: NotificationEmailKey,
  patch: NotificationPatch,
): Promise<NotificationSaveState> {
  const me = await adminApi.me();
  if (!isAdminRole(me.role)) return { ok: false, code: 'FORBIDDEN' };
  try {
    const setting = await adminApi.updateNotification(emailKey, patch);
    revalidatePath('/admin/account/notifications');
    return { ok: true, setting };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError && (e.status === 403 || e.code === 'FORBIDDEN')) {
      return { ok: false, code: 'FORBIDDEN' };
    }
    return { ok: false, code: 'FAILED' };
  }
}

/** Reset one submission email's subject+body to the shipped default (keeps toggle). */
export async function resetNotificationAction(
  emailKey: NotificationEmailKey,
): Promise<NotificationSaveState> {
  const me = await adminApi.me();
  if (!isAdminRole(me.role)) return { ok: false, code: 'FORBIDDEN' };
  try {
    const setting = await adminApi.resetNotification(emailKey);
    revalidatePath('/admin/account/notifications');
    return { ok: true, setting };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError && (e.status === 403 || e.code === 'FORBIDDEN')) {
      return { ok: false, code: 'FORBIDDEN' };
    }
    return { ok: false, code: 'FAILED' };
  }
}
