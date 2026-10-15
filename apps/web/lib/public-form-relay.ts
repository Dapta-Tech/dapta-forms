/**
 * The public form's server side: what the respondent's browser calls to submit
 * answers, record funnel events, report a booking and authorize an upload.
 *
 * WHY A ROUTE AND NOT SERVER ACTIONS. These used to be Server Actions, which
 * the browser reaches by an id compiled into the build. A deploy ships new ids
 * (every image is a clean build, so a fresh actions key), and a tab opened
 * before it keeps posting the old ones: the old pod is gone (504) and the new
 * one does not know the id (404), so every retry repeats the same dead call and
 * the person's answers never land. A route has an address that does not change
 * between builds, so the same request simply reaches the new pod.
 * See `app/api/public/forms/[accountCode]/[slug]/[op]/route.ts`.
 *
 * Everything below runs on the web server and calls the API exactly as the
 * actions did, through `lib/api.ts`, so the visitor's `X-Forwarded-For` still
 * reaches the API's per-IP rate limit (see `lib/forwarded-for.ts`).
 *
 * The answer to the browser is the server's VERDICT, always as JSON with a 200
 * (`{ ok: false, ... }` included). Anything else means the request never got
 * one: a malformed body (4xx) or the API out of reach (502). The browser treats
 * those as transport failures, never as a verdict (see `transport.ts`).
 */
import { postFormEvent, postSubmission, postUploadPresign } from '@/lib/api';
import { postBookingCallback } from '@/lib/booking-embed';
import { forwardedForChain } from '@/lib/forwarded-for';
import type { BookingCallbackInput, UploadPresignInput } from '@quill/types';
import { EVENTS_PER_CALL } from '@/app/[accountCode]/[handle]/[slug]/event-batches';

/** The four calls the public form makes, by the last segment of the route. */
export const PUBLIC_FORM_OPS = ['submissions', 'events', 'booking', 'uploads'] as const;
export type PublicFormOp = (typeof PUBLIC_FORM_OPS)[number];

export const isPublicFormOp = (op: string): op is PublicFormOp =>
  (PUBLIC_FORM_OPS as readonly string[]).includes(op);

/**
 * The largest body the route reads. The same ceiling a Server Action had, and
 * far above any real submission: file bytes never come through here (the
 * browser uploads them straight to the bucket).
 */
export const MAX_PUBLIC_FORM_BODY_BYTES = 1_000_000;

export interface RelayResult {
  status: number;
  body: Record<string, unknown>;
}

type JsonObject = Record<string, unknown>;

const verdict = (body: JsonObject): RelayResult => ({ status: 200, body });

interface EventInput {
  type?: unknown;
  stepIndex?: unknown;
  stepKey?: unknown;
}

function eventFor(sessionId: unknown, event: EventInput) {
  return {
    sessionId: sessionId as string,
    type: event.type as string,
    stepIndex: (event.stepIndex as number | null | undefined) ?? null,
    stepKey: (event.stepKey as string | null | undefined) ?? null,
  };
}

/**
 * Run one public form call against the API. `body` is the parsed JSON object;
 * the API validates every field, as it did when the actions forwarded them.
 * Throws only when the API cannot be reached; the route turns that into a 502.
 */
export async function relayPublicFormCall(
  op: PublicFormOp,
  accountCode: string,
  slug: string,
  body: JsonObject,
): Promise<RelayResult> {
  switch (op) {
    case 'submissions': {
      // Idempotent per session: the API keeps one row per (form, session), so
      // a browser retrying after a lost answer cannot make a second response.
      const res = await postSubmission(
        accountCode,
        slug,
        body as Parameters<typeof postSubmission>[2],
      );
      // A 5xx is the API (or a proxy in front of it, mid-rollout) failing to
      // answer, not refusing: throwing makes the route answer 502, which the
      // browser retries. A 4xx (rate limit, human check, bad input) is a real
      // refusal and goes back as the verdict.
      if (!res.ok && res.status >= 500) throw new Error(`submissions: API answered ${res.status}`);
      return verdict({
        ok: res.ok,
        score: res.score,
        outcome: res.outcome,
        message: res.message,
        error: res.error,
      });
    }
    case 'events': {
      // One event, or a screen's worth at once (`events`), never more than one
      // batch per call. They go to the API together: each is its own row and
      // no metric reads their order.
      if (Array.isArray(body.events)) {
        await Promise.all(
          (body.events as EventInput[])
            .slice(0, EVENTS_PER_CALL)
            .map((event) =>
              postFormEvent(accountCode, slug, eventFor(body.sessionId, event ?? {})),
            ),
        );
      } else if (!('events' in body)) {
        await postFormEvent(accountCode, slug, eventFor(body.sessionId, body));
      }
      return verdict({ ok: true });
    }
    case 'booking': {
      // NOT idempotent (a plain insert, no dedupe): the browser sends it once
      // and never retries it. Best-effort, like the event POST.
      await postBookingCallback(
        accountCode,
        slug,
        body as BookingCallbackInput,
        await forwardedForChain(),
      );
      return verdict({ ok: true });
    }
    case 'uploads': {
      const res = await postUploadPresign(accountCode, slug, body as UploadPresignInput);
      return verdict(res as unknown as JsonObject);
    }
  }
}
