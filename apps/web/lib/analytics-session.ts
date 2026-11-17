/**
 * The browser's product-analytics SESSION id, forwarded to the API so the
 * events the API emits link to the session recording they happened in.
 *
 * The milestones (signup, form created, form published, ...) are captured
 * server side, on purpose: a quarter of all forms are created over MCP or the
 * API with no browser at all, and an ad blocker cannot drop a server event. The
 * price was that those events carried no `$session_id`, so the vendor had no
 * recording to open from a chart point or a funnel step. The recording itself
 * existed; only the link was missing.
 *
 * The admin snippet mirrors the live session id into the `quill_ph_session`
 * cookie (see `buildAnalyticsSnippet`). A server action receives that cookie
 * with every request, so the id is read here and sent along as one header.
 *
 * Best effort and never trusted for anything: the API only copies the value
 * into an analytics property, after checking its shape again.
 */
import { ANALYTICS_SESSION_COOKIE, type ResolvedProductAnalytics } from './product-analytics';

/** The header the API reads. Kept in step with `apps/api/src/analytics-session.ts`. */
export const ANALYTICS_SESSION_HEADER = 'x-quill-analytics-session';

/** The vendor's session ids are UUIDs (v7). Anything else is not forwarded. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The session id in a raw cookie value, or null when missing or malformed. */
export function sessionIdFromCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return SESSION_ID.test(id) ? id : null;
}

/** Minimal cookie-jar shape, so callers can pass `cookies()` or a request's jar. */
interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/**
 * The header to add to an API call, or an empty object when analytics is off
 * or there is no session. Spread it into the request headers.
 */
export function analyticsSessionHeaders(
  jar: CookieReader,
  analytics: Pick<ResolvedProductAnalytics, 'key'>,
): Record<string, string> {
  if (!analytics.key) return {};
  const id = sessionIdFromCookie(jar.get(ANALYTICS_SESSION_COOKIE)?.value);
  return id ? { [ANALYTICS_SESSION_HEADER]: id } : {};
}
