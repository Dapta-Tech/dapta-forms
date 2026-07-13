'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { hostFetch } from '@/lib/auth-session';

export interface HostBookingResult {
  ok: boolean;
  uid?: string;
  message?: string;
  /** HTTP status of the failed attempt (409 = the slot was just taken). */
  status?: number;
  /** Machine-readable API error code (e.g. CALENDAR_UNAVAILABLE, SLOT_TAKEN). */
  error?: string;
}

export interface HostSlotsResult {
  ok: boolean;
  slots: string[];
  /** Config-error reason when the API returned an empty list on purpose. */
  emptyReason?: string;
}

/**
 * The host's own slots for an event, via the authenticated host surface —
 * works even before the member sets a public handle (the public availability
 * endpoint requires one; that gap silently emptied this form's slot list).
 */
export async function loadHostSlotsAction(
  slug: string,
  from: string,
  to: string,
): Promise<HostSlotsResult> {
  try {
    const qs = `slug=${encodeURIComponent(slug)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await hostFetch(`/v1/me/availability?${qs}`);
    if (!res.ok) return { ok: false, slots: [] };
    const j = (await res.json().catch(() => ({}))) as {
      slots?: { startUtc: string }[];
      emptyReason?: string;
    };
    // emptyReason distinguishes a CONFIG error (missing schedule, no hours,
    // unreachable calendar) from a genuinely empty range — the form renders
    // an actionable notice instead of a bare "No slots in range."
    return { ok: true, slots: (j.slots ?? []).map((s) => s.startUtc), emptyReason: j.emptyReason };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, slots: [] };
  }
}

/**
 * R29 host on-behalf booking. Posts to the host surface (singular `attendee`
 * shape — the deliberate path-split from the machine `attendees[]` surface).
 * `handle` is optional: without it the API books the authenticated member.
 */
export async function createHostBookingAction(payload: {
  handle?: string;
  slug: string;
  startUtc: string;
  attendee: { name: string; email: string; timeZone: string; notes?: string };
  answers?: Record<string, string>;
}): Promise<HostBookingResult> {
  try {
    const res = await hostFetch(`/v1/host/bookings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 201) {
      revalidatePath('/admin/bookings');
      return { ok: true, uid: j.uid as string };
    }
    return {
      ok: false,
      status: res.status,
      error: j.error as string | undefined,
      message: (j.message as string) ?? 'Could not create the booking.',
    };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, message: e instanceof Error ? e.message : 'Failed' };
  }
}
