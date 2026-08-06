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
 * The query string to hand `/api/auth/login`, or `''` when there is nothing to
 * carry.
 *
 * `''` rather than an empty object is what keeps an untagged visit from spending
 * the claim: no query means the login route sets no cookie, so the callback has
 * nothing to POST.
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

  // Decide with the SAME parser the login route will use, so the two can never
  // disagree about what counts as "nothing to carry".
  if (!parseAttribution(candidate)) return '';

  const qs = new URLSearchParams();
  for (const key of ATTRIBUTION_QUERY_KEYS) {
    const raw = candidate[key];
    // First of a repeated param, matching the parser's first-wins rule.
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string' && value.trim()) qs.set(key, value.trim().slice(0, FORWARD_MAX));
  }
  return qs.toString();
}
