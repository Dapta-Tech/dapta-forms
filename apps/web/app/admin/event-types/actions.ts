'use server';

import { unstable_rethrow } from 'next/navigation';

import { revalidatePath } from 'next/cache';
import { adminApi } from '@/lib/admin-api';

export type ActionResult = { ok: boolean; message?: string };

export interface EventTypePayload {
  id?: string;
  title: string;
  slug: string;
  description: string | null;
  lengthMinutes: number;
  location: string | null;
  minimumBookingNotice: number;
  slotInterval: number | null;
  beforeEventBuffer: number;
  afterEventBuffer: number;
  seatsPerTimeSlot: number | null;
  requiresConfirmation: boolean;
  hidden: boolean;
  scheduleId: string | null;
  bookingFields: Array<{ name: string; label: string; type: string; required: boolean }>;
  /** Team events: scheduling method + per-host round-robin detail. */
  schedulingType?: string | null;
  hosts?: Array<{ memberId: string; priority: number | null; weight: number | null; isFixed: boolean }>;
}

export async function saveEventTypeAction(p: EventTypePayload): Promise<ActionResult> {
  try {
    if (p.id) {
      await adminApi.updateEventType(p.id, p);
    } else {
      await adminApi.createEventType(p);
    }
    revalidatePath('/admin/event-types');
    if (p.id) revalidatePath(`/admin/event-types/${p.id}`);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, message: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function deleteEventTypeAction(id: string): Promise<ActionResult> {
  try {
    await adminApi.deleteEventType(id);
    revalidatePath('/admin/event-types');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, message: e instanceof Error ? e.message : 'Could not delete the event.' };
  }
}
