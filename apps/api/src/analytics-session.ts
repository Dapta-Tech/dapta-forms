import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The product-analytics SESSION id of the browser behind the current request,
 * so a server-side event can link to the session recording it happened in.
 *
 * The web app reads the id from the vendor's own cookie and forwards it in one
 * header (see `apps/web/lib/analytics-session.ts`). This module keeps it for the
 * lifetime of the request, so `AnalyticsEffects` can stamp it on every event
 * the request enqueues without each call site having to thread it through.
 *
 * The value is attacker-controllable and is treated that way: it is never used
 * for anything but an analytics property, and only after a shape check. A
 * request without it (MCP, API keys, the public form path) simply produces
 * events without a `$session_id`, exactly as before.
 */

/** Kept in step with `apps/web/lib/analytics-session.ts`. */
export const ANALYTICS_SESSION_HEADER = 'x-quill-analytics-session';

/** The vendor's session ids are UUIDs (v7). Anything else is dropped. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const store = new AsyncLocalStorage<string | null>();

/** The session id for this request, or null outside a request or without the header. */
export function currentAnalyticsSessionId(): string | null {
  return store.getStore() ?? null;
}

/** A header value that is a well-formed session id, else null. */
export function parseAnalyticsSessionId(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && SESSION_ID.test(v) ? v : null;
}

/** Run `fn` with `sessionId` as the current request's session (tests and middleware). */
export function runWithAnalyticsSession<T>(sessionId: string | null, fn: () => T): T {
  return store.run(sessionId, fn);
}

/** Express-style middleware: scope the rest of the request to its session id. */
export function analyticsSessionMiddleware() {
  return (req: IncomingMessage, _res: ServerResponse, next: () => void): void => {
    runWithAnalyticsSession(parseAnalyticsSessionId(req.headers[ANALYTICS_SESSION_HEADER]), next);
  };
}
