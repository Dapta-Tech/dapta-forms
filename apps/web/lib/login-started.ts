/**
 * `forms_login_started`: the login route sent someone to the hosted sign-in or
 * sign-up screen.
 *
 * The one funnel step no page can record. A landing's call to action goes to
 * the app root, which redirects to `/api/auth/login`, which redirects to the
 * identity provider: no page in between loads the browser snippet, so a person
 * who opened the hosted screen and gave up there left no event at all, and
 * drop-off on that screen could not be measured. The route records the start
 * itself, on the server.
 *
 * Never on the login's clock. The route hands the send to Next's `after`, which
 * runs once the redirect has gone out; the request has a short timeout, and any
 * failure is logged and dropped. Analytics observes the login and must never
 * slow it or fail it.
 *
 * Who it is about:
 *  - With a landing id (`ph_id`, parked in `quill_ph_id` by the same route), the
 *    event is filed under it, the id the landing's own events carry. The first
 *    admin page aliases it onto the member's email (`identifyMember`), so
 *    "visited the landing, started a sign-up, signed up" is one person.
 *  - Without one, under a random id with no person profile: a count of starts
 *    that never mints a person.
 *
 * What it carries: `screen` (`sign-up` or `sign-in`), `has_ph_id`, the campaign's
 * `utm_source` when there is one (the value `forms_attribution_captured` already
 * sends), `product` and `$host`. No email, no URL, no query string, no click id.
 * `$geoip_disable` because the request comes from this server, whose address
 * says nothing about where the person is.
 *
 * PURE apart from the send (no `next/headers`): route files may only export
 * handlers, and the spec drives this directly.
 */
import { randomUUID } from 'node:crypto';
import { sanitizeLandingDistinctId } from './attribution';
import type { ResolvedProductAnalytics } from './product-analytics';

/** The event name, `forms_` prefixed like every event this product sends. */
export const LOGIN_STARTED_EVENT = 'forms_login_started';

/** Give up on a slow vendor; this runs after the response, but must not linger. */
const REQUEST_TIMEOUT_MS = 3_000;

/** Which hosted screen the login opens on. */
export type LoginScreen = 'sign-up' | 'sign-in';

/** What the login route knows about one login start. */
export interface LoginStart {
  screen: LoginScreen;
  /** The landing id for this attempt (parked or arriving), unchecked. */
  landingId: string | null | undefined;
  /** The campaign source of this attempt, as `parseAttribution` stored it. */
  utmSource: string | null | undefined;
  /** This request's public origin (`requestOrigin`). */
  origin: string;
  /** The `user-agent` header. */
  userAgent: string | null;
}

/**
 * Clients that are not a person opening a login: crawlers and link previewers
 * follow the root's redirect too, and every one would be a start that can never
 * finish. The browser snippet drops these on its own; a server event has to do
 * it here.
 */
const AUTOMATED_AGENT =
  /bot\b|bot\/|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|embedly|curl\/|wget\/|python-|go-http-client|okhttp|axios\/|node-fetch|undici/i;

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host || null;
  } catch {
    return null;
  }
}

/**
 * The capture body for one login start, or null when it is not worth sending
 * (no user agent, or an automated one). Pure, apart from the random id.
 */
export function loginStartedEvent(
  start: LoginStart,
  newId: () => string = randomUUID,
): { event: string; distinct_id: string; properties: Record<string, unknown> } | null {
  if (!start.userAgent || AUTOMATED_AGENT.test(start.userAgent)) return null;
  const landingId = sanitizeLandingDistinctId(start.landingId);
  const utmSource = typeof start.utmSource === 'string' ? start.utmSource.trim() : '';
  const host = hostOf(start.origin);
  return {
    event: LOGIN_STARTED_EVENT,
    distinct_id: landingId ?? `forms-login-${newId()}`,
    properties: {
      product: 'forms',
      screen: start.screen,
      has_ph_id: landingId !== null,
      ...(utmSource ? { utm_source: utmSource } : {}),
      ...(host ? { $host: host } : {}),
      $geoip_disable: true,
      // Personless without a landing id: a random id must never become a person.
      ...(landingId ? {} : { $process_person_profile: false }),
    },
  };
}

/**
 * Send one login start. Never throws: with analytics off it does nothing, and
 * every failure, a refused key included, is one warning in the log.
 */
export async function recordLoginStarted(
  start: LoginStart,
  analytics: ResolvedProductAnalytics,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    if (!analytics.key) return;
    const body = loginStartedEvent(start);
    if (!body) return;
    const res = await fetchImpl(`${analytics.host.replace(/\/+$/, '')}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: analytics.key, ...body }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) console.warn(`${LOGIN_STARTED_EVENT} was not delivered: HTTP ${res.status}`);
  } catch (error) {
    console.warn(
      `${LOGIN_STARTED_EVENT} was not delivered: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
