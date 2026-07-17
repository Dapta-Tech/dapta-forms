'use server';

import {
  adminApi,
  ApiError,
  isAdminRole,
  type FormNotificationView,
  type NotificationEmailKey,
  type NotificationPatch,
} from '@/lib/admin-api';

/**
 * Server actions behind the Connect tab's Emails section (per-form template
 * overrides, /v1/forms/:id/notifications*). Same shape as the Settings →
 * Notifications actions: the API is the real gate (assertAdmin + the form must
 * belong to the principal's account); the mirrored admin check here is
 * defence-in-depth, and failures map to stable codes the client localizes.
 */

export type FormNotificationsLoadState =
  | { ok: true; settings: FormNotificationView[] }
  | { ok: false; code: 'FORBIDDEN' | 'FAILED' };

export type FormNotificationSaveState =
  | { ok: true; setting: FormNotificationView }
  | { ok: false; code: 'FORBIDDEN' | 'FAILED' };

function failure(e: unknown): { ok: false; code: 'FORBIDDEN' | 'FAILED' } {
  if (e instanceof ApiError && (e.status === 403 || e.code === 'FORBIDDEN')) {
    return { ok: false, code: 'FORBIDDEN' };
  }
  return { ok: false, code: 'FAILED' };
}

/** Both emails as seen from this form: account baseline + override (if any). */
export async function loadFormNotificationsAction(
  formId: string,
): Promise<FormNotificationsLoadState> {
  try {
    const me = await adminApi.me();
    if (!isAdminRole(me.role)) return { ok: false, code: 'FORBIDDEN' };
    const res = await adminApi.getFormNotifications(formId);
    return { ok: true, settings: res.settings };
  } catch (e) {
    return failure(e);
  }
}

/** Create/update this form's override for one email (subject/body/enabled). */
export async function saveFormNotificationAction(
  formId: string,
  emailKey: NotificationEmailKey,
  patch: NotificationPatch,
): Promise<FormNotificationSaveState> {
  try {
    const me = await adminApi.me();
    if (!isAdminRole(me.role)) return { ok: false, code: 'FORBIDDEN' };
    const setting = await adminApi.updateFormNotification(formId, emailKey, patch);
    return { ok: true, setting };
  } catch (e) {
    return failure(e);
  }
}

/** Remove this form's override — the form follows the account template again. */
export async function resetFormNotificationAction(
  formId: string,
  emailKey: NotificationEmailKey,
): Promise<FormNotificationSaveState> {
  try {
    const me = await adminApi.me();
    if (!isAdminRole(me.role)) return { ok: false, code: 'FORBIDDEN' };
    const setting = await adminApi.resetFormNotification(formId, emailKey);
    return { ok: true, setting };
  } catch (e) {
    return failure(e);
  }
}
