/**
 * How the public form reaches its server: plain same-origin `fetch` to a route
 * whose address never changes (`/api/public/forms/:accountCode/:slug/:op`).
 *
 * These replace the Server Actions the renderers used to import. An action is
 * called by an id compiled into the build, and every deploy ships new ids, so a
 * person who opened the form before a deploy could not finish it: the final
 * submit, and every retry of it, went to an id the new server did not know.
 * A route is addressed by its path, which every build shares.
 *
 * Same contract as the actions had, so the renderers' guards still apply: each
 * call either RESOLVES with the server's verdict or REJECTS when there was
 * none (network down, a gateway error while pods roll, a body that is not the
 * route's JSON). Call sites wrap them in `callAction` / `callActionWithRetry`
 * (lib/call-action.ts), which turn a rejection into a retryable value. Only
 * the submit retries, because only the submit is idempotent (one row per
 * session); the booking record goes once.
 *
 * Same-origin on purpose: an embed is an iframe of this very page, and the
 * builder preview's network fence blocks every same-origin write, so neither
 * needs anything of its own.
 */
import type { PresignResult } from '@/lib/api';
import type { BookingCallbackInput, SubmissionVisit, UploadPresignInput } from '@quill/types';

/** What the server answers to a submit (partial or complete). */
export interface SubmitVerdict {
  ok: boolean;
  score?: number;
  outcome?: string | null;
  message?: string;
  /** The API's stable code on a refusal (`CAPTCHA_FAILED`, `RATE_LIMITED`, ...). */
  error?: string;
}

export type PublicFormEvent = { type: string; stepIndex?: number | null; stepKey?: string | null };

/** The route for one call, the same in every build. */
export function publicFormEndpoint(accountCode: string, slug: string, op: string): string {
  return `/api/public/forms/${encodeURIComponent(accountCode)}/${encodeURIComponent(slug)}/${op}`;
}

async function post<T>(accountCode: string, slug: string, op: string, body: unknown): Promise<T> {
  const res = await fetch(publicFormEndpoint(accountCode, slug, op), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    credentials: 'same-origin',
  });
  // The route answers every verdict with a 200. Anything else never reached
  // one: a 502/504 from the proxy while pods roll, the API out of reach, a
  // server that does not have this route yet. Rejecting is what makes the
  // submit try again instead of telling the person their answers were refused.
  if (!res.ok) throw new Error(`${op}: HTTP ${res.status}`);
  const json = (await res.json()) as unknown;
  if (!json || typeof json !== 'object' || typeof (json as { ok?: unknown }).ok !== 'boolean') {
    throw new Error(`${op}: unexpected response`);
  }
  return json as T;
}

/**
 * Submit the answers, partial or complete. The score is recomputed by the API;
 * the client value is never trusted. Safe to retry: the API keeps one row per
 * (form, session), and a late partial never overwrites a complete.
 */
export function submitForm(
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
): Promise<SubmitVerdict> {
  return post<SubmitVerdict>(accountCode, slug, 'submissions', payload);
}

/** Record one funnel event (best-effort). */
export async function recordEvent(
  accountCode: string,
  slug: string,
  payload: { sessionId: string } & PublicFormEvent,
): Promise<void> {
  await post(accountCode, slug, 'events', payload);
}

/**
 * Record a screen's worth of funnel events in one request (best-effort). The
 * route forwards at most `EVENTS_PER_CALL` of them; the renderer sends a bigger
 * screen in batches (see `event-batches.ts`).
 */
export async function recordEvents(
  accountCode: string,
  slug: string,
  payload: { sessionId: string; events: PublicFormEvent[] },
): Promise<void> {
  await post(accountCode, slug, 'events', payload);
}

/**
 * Report a booked meeting. NOT idempotent (a plain insert server-side): call
 * it once, through `callAction`, never through a retry.
 */
export async function recordBooking(
  accountCode: string,
  slug: string,
  payload: BookingCallbackInput,
): Promise<void> {
  await post(accountCode, slug, 'booking', payload);
}

/**
 * Authorize one file upload and get the URL the browser PUTs the bytes to.
 * The bytes never come through here: the browser uploads straight to the
 * bucket.
 */
export function presignUpload(
  accountCode: string,
  slug: string,
  payload: UploadPresignInput,
): Promise<PresignResult> {
  return post<PresignResult>(accountCode, slug, 'uploads', payload);
}
