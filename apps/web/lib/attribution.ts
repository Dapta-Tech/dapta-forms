/**
 * Hop 1 of carrying acquisition tags to the server: the root page reads them off
 * the campaign URL and hands them to the login route.
 *
 * It lives here, apart from the page, because the page is a redirect and cannot be
 * unit-tested — and this is the seam that already broke once. Emitting the PARSED
 * (camelCase) shape instead of the wire (snake_case) one loses every `utm_*` tag
 * while `gclid`/`fbclid` survive, because only those two keys are spelled the same
 * in both. Nothing throws, no test fails, and the write-once claim is then spent
 * on a half-empty blob: unrecoverable. `attribution.spec.ts` pins both hops.
 */
import { parseAttribution, ATTRIBUTION_QUERY_KEYS } from '@quill/types';

/**
 * Forwarded values are capped here as well as at the far end. The inbound URL was
 * already this long, but a redirect turns it into a `Location` header, and header
 * limits are much smaller than URL limits.
 */
const FORWARD_MAX = 512;

/**
 * The referer, but only when it came from somewhere else.
 *
 * A SAME-ORIGIN referer is dropped: `account.attribution` is written once and
 * never again, so recording "came from our own page" would spend first touch on a
 * value that says nothing, and the real campaign could never be recorded.
 */
export function crossOriginReferer(
  referer: string | null | undefined,
  self: string | null,
): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).host === self ? undefined : referer;
  } catch {
    // Not a URL at all — nothing worth attributing to.
    return undefined;
  }
}

/**
 * The query key the landing uses to hand over its PostHog anonymous id.
 *
 * `daptaforms.ai` and this app are different origins, so the vendor's cookie
 * does not cross: without this the same human is two unrelated people and the
 * "visited the landing → signed up" funnel does not exist. The landing appends
 * its `distinct_id` to the CTA under this name; it rides the same hops as the
 * campaign tags and is aliased onto the identified person once, in
 * `identifyMember`.
 */
export const PH_ID_QUERY_KEY = 'ph_id';

/**
 * Where the login route parks that id for the round-trip. Unlike the
 * attribution cookie its reader is NOT the callback but the first
 * analytics-bearing page after login (admin layout / onboarding), which hands
 * it to `identifyMember` to alias onto the identified person. Nothing deletes
 * it — a Server Component cannot clear a cookie — so it simply expires with
 * the login attempt, and the alias itself is latched client-side.
 *
 * Lives here rather than in the route file because route files may only export
 * handlers, and both the route (writer) and the pages (readers) need the name.
 */
export const PH_ID_COOKIE = 'quill_ph_id';

/**
 * A landing distinct id fit to carry, or null.
 *
 * Strict on purpose: this value is attacker-composable (anyone can put anything
 * after `?ph_id=`), and the only legitimate producer is the landing's own
 * vendor snippet, whose ids are UUID-shaped. The allowlist covers every id that
 * snippet can mint — hex, dashes, and the vendor's occasional `$device:` prefix
 * — and refuses everything else. Losing the identity join for an exotic id is
 * a shrug; forwarding arbitrary text into cookies and analytics calls is not.
 */
export function sanitizeLandingDistinctId(raw: string | string[] | undefined | null): string | null {
  // First of a repeated param, same first-wins rule as the attribution parser.
  const value = (Array.isArray(raw) ? raw[0] : raw) ?? '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return /^[A-Za-z0-9$:._-]+$/.test(trimmed) ? trimmed : null;
}

/**
 * The query string to hand `/api/auth/login`, or `''` when there is nothing to
 * carry.
 *
 * `''` rather than an empty object is what keeps an untagged visit from spending
 * the claim: no query means the login route sets no cookie, so the callback has
 * nothing to POST.
 *
 * `ph_id` counts as something to carry on its own. It spends nothing — the
 * write-once claim is decided by `parseAttribution` over the attribution keys,
 * which an id-only query still leaves empty — and in practice it never arrives
 * alone anyway: the landing CTA that appends it also guarantees a `utm_source`.
 */
export function attributionHandoffQuery(
  params: Readonly<Record<string, string | string[] | undefined>>,
  referer: string | null | undefined,
  self: string | null,
): string {
  const candidate: Record<string, string | string[] | undefined> = {
    ...params,
    referrer: crossOriginReferer(referer, self),
  };
  const landingId = sanitizeLandingDistinctId(params[PH_ID_QUERY_KEY]);

  // Decide with the SAME parser the login route will use, so the two can never
  // disagree about what counts as "nothing to carry".
  if (!parseAttribution(candidate) && !landingId) return '';

  const qs = new URLSearchParams();
  for (const key of ATTRIBUTION_QUERY_KEYS) {
    const raw = candidate[key];
    // First of a repeated param, matching the parser's first-wins rule.
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string' && value.trim()) qs.set(key, value.trim().slice(0, FORWARD_MAX));
  }
  if (landingId) qs.set(PH_ID_QUERY_KEY, landingId);
  return qs.toString();
}
