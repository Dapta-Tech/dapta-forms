'use server';

import { postSubmission, postFormEvent, postUploadPresign, type PresignResult } from '@/lib/api';
import { postBookingCallback } from '@/lib/booking-embed';
import { forwardedForChain } from '@/lib/forwarded-for';
import type { BookingCallbackInput, SubmissionVisit, UploadPresignInput } from '@quill/types';

/**
 * Submit a form — partial (past the lead-capture threshold) or complete. The
 * score is always recomputed server-side; the client value is never trusted.
 *
 * `captchaToken` and `hp` are spam protection's (the human check's token and
 * strict mode's hidden field); the API decides whether it needs them. A
 * refusal comes back with the API's `error` code, which is what the renderer
 * localizes, never its English `message`.
 *
 * `visit` is the page the form was answered on (see `lib/host-visit.ts`); the
 * API checks it again, field by field, and never refuses a submit over it.
 */
export async function submitFormAction(
  accountCode: string,
  slug: string,
  payload: {
    sessionId: string;
    data: Record<string, unknown>;
    partial?: boolean;
    locale?: 'en' | 'es';
    captchaToken?: string;
    hp?: string;
    visit?: SubmissionVisit;
  },
): Promise<{ ok: boolean; score?: number; outcome?: string | null; message?: string; error?: string }> {
  const res = await postSubmission(accountCode, slug, payload);
  return { ok: res.ok, score: res.score, outcome: res.outcome, message: res.message, error: res.error };
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

/** More events than a screen of ten questions can record at once are not a screen's. */
const MAX_EVENTS_PER_CALL = 24;

/**
 * Record several funnel events in one round trip (best-effort). A screen of
 * several questions records one per question at once (a view each when it
 * shows, a completion each when it is submitted), and the browser runs server
 * actions one at a time: N separate calls would queue in front of whatever the
 * person does next, the final submit included. Sent to the API one by one and
 * in order, so the rows land exactly as separate calls would have written them.
 */
export async function recordEventsAction(
  accountCode: string,
  slug: string,
  payload: {
    sessionId: string;
    events: { type: string; stepIndex?: number | null; stepKey?: string | null }[];
  },
): Promise<void> {
  if (!Array.isArray(payload.events)) return;
  for (const event of payload.events.slice(0, MAX_EVENTS_PER_CALL)) {
    await postFormEvent(accountCode, slug, {
      sessionId: payload.sessionId,
      type: event.type,
      stepIndex: event.stepIndex ?? null,
      stepKey: event.stepKey ?? null,
    });
  }
}
