'use server';

import { postSubmission, postFormEvent, postUploadPresign, type PresignResult } from '@/lib/api';
import { postBookingCallback } from '@/lib/booking-embed';
import { forwardedForChain } from '@/lib/forwarded-for';
import type { BookingCallbackInput, UploadPresignInput } from '@quill/types';

/**
 * Submit a form — partial (past the lead-capture threshold) or complete. The
 * score is always recomputed server-side; the client value is never trusted.
 */
export async function submitFormAction(
  accountCode: string,
  slug: string,
  payload: { sessionId: string; data: Record<string, unknown>; partial?: boolean; locale?: 'en' | 'es' },
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
  await postBookingCallback(accountCode, slug, payload, await forwardedForChain());
}

/**
 * Authorize one file upload and hand the browser the URL to PUT to.
 *
 * The bytes never come through here: this returns a signed URL and the browser
 * uploads straight to the bucket. That is the whole point of the flow, because
 * a Server Action body is capped at 1 MB and a real document is not.
 */
export async function presignUploadAction(
  accountCode: string,
  slug: string,
  payload: UploadPresignInput,
): Promise<PresignResult> {
  return postUploadPresign(accountCode, slug, payload);
}
