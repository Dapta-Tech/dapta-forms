'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { hostFetch } from '@/lib/auth-session';

export type ActionResult = { ok: boolean; message?: string };

async function post(uid: string, action: 'confirm' | 'decline' | 'cancel'): Promise<ActionResult> {
  try {
    const res = await hostFetch(`/v1/host/bookings/${encodeURIComponent(uid)}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) {
      // Surface the failure instead of pretending it worked (was: no res.ok check).
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      return { ok: false, message: j.message ?? j.error ?? `Could not ${action} the booking.` };
    }
    revalidatePath('/admin/bookings');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, message: e instanceof Error ? e.message : `Could not ${action} the booking.` };
  }
}

export async function confirmBookingAction(uid: string): Promise<ActionResult> {
  return post(uid, 'confirm');
}
export async function declineBookingAction(uid: string): Promise<ActionResult> {
  return post(uid, 'decline');
}
export async function cancelBookingAction(uid: string): Promise<ActionResult> {
  return post(uid, 'cancel');
}
