'use server';

import { postSubmission, postFormEvent } from '@/lib/api';
import { postBookingCallback } from '@/lib/booking-embed';
import type { BookingCallbackInput } from '@quill/types';

/**
 * Submit a form — partial (past the lead-capture threshold) or complete. The
 * score is always recomputed server-side; the client value is never trusted.
 */
export async function submitFormAction(
  accountCode: string,
  slug: string,
  payload: { sessionId: string; data: Record<string, unknown>; partial?: boolean },
): Promise<{ ok: boolean; score?: number; outcome?: string | null; message?: string }> {
  const res = await postSubmission(accountCode, slug, payload);
  return { ok: res.ok, score: res.score, outcome: res.outcome, message: res.message };
}

/** Record a funnel event (best-effort). */
export async function recordEventAction(
  accountCode: string,
  slug: string,
  payload: { sessionId: string; type: string; stepIndex?: number | null; stepKey?: string | null },
): Promise<void> {
  await postFormEvent(accountCode, slug, payload);
}

/** Report a booked meeting to the API (best-effort; never blocks the redirect). */
export async function recordBookingAction(
  accountCode: string,
  slug: string,
  payload: BookingCallbackInput,
): Promise<void> {
  await postBookingCallback(accountCode, slug, payload);
}
