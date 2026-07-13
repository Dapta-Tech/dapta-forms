'use server';

import { postManage } from '@/lib/api';

export async function cancelAction(
  _prev: { ok: boolean; message?: string } | null,
  formData: FormData,
): Promise<{ ok: boolean; message?: string }> {
  const uid = String(formData.get('uid') ?? '');
  const token = String(formData.get('token') ?? '');
  const reason = String(formData.get('reason') ?? '');
  return postManage(uid, token, 'cancel', { reason });
}

export async function rescheduleAction(
  _prev: { ok: boolean; message?: string; manageUrl?: string } | null,
  formData: FormData,
): Promise<{ ok: boolean; message?: string; manageUrl?: string }> {
  const uid = String(formData.get('uid') ?? '');
  const token = String(formData.get('token') ?? '');
  const newStartUtc = String(formData.get('newStartUtc') ?? '');
  if (!newStartUtc) return { ok: false, message: 'Pick a new date/time.' };
  // Returns the rotated manageUrl so the client can adopt the new token.
  return postManage(uid, token, 'reschedule', { newStartUtc: new Date(newStartUtc).toISOString() });
}
