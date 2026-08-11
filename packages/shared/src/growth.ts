/**
 * Growth loop — the "Powered by Dapta" attribution on public pages.
 *
 * Open-core rule: like the app-switcher's platform URL, the signup destination
 * comes ONLY from the deployment (NEXT_PUBLIC_SIGNUP_URL) — no internal host
 * is hardcoded in the open tree (publish-gate). Unset → the badge/CTA don't
 * render, so a bare fork carries no Dapta branding and no dead link; Dapta's
 * cloud sets it and can still opt out per deployment with the hide flag.
 * All URL construction is pure here so the UTM scheme is testable and
 * identical on every surface.
 */

/** UTM values are fixed product-wide; only the medium varies by surface. */
export type SignupMedium = 'badge' | 'confirmation';

export const UTM_SOURCE = 'dapta-forms';
export const UTM_CAMPAIGN = 'made-with-dapta';

/**
 * The signup destination carrying the growth-loop UTM tags, or null when no
 * (or a non-http(s)) base is configured — callers hide the surface then.
 * `accountCode` (already public — it's in the page URL) rides along as
 * utm_content for attribution; nothing else about the tenant is leaked.
 * String-built (no URL/URLSearchParams): this package stays lib-ES2022-only.
 */
export function buildSignupUrl(opts: {
  baseUrl?: string | null;
  medium: SignupMedium;
  accountCode?: string | null;
}): string | null {
  const base = (opts.baseUrl ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(base)) return null;
  const pairs: Array<[string, string]> = [
    ['utm_source', UTM_SOURCE],
    ['utm_medium', opts.medium],
    ['utm_campaign', UTM_CAMPAIGN],
  ];
  if (opts.accountCode) pairs.push(['utm_content', opts.accountCode]);
  const query = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  // Preserve an existing query and keep any fragment at the very end.
  const hashAt = base.indexOf('#');
  const path = hashAt === -1 ? base : base.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : base.slice(hashAt);
  return `${path}${path.includes('?') ? '&' : '?'}${query}${hash}`;
}

/**
 * Where the growth loop actually sends someone, given both configured URLs.
 *
 * Two different questions, deliberately kept apart:
 *  - **Is the loop on?** Answered by `signupUrl` alone. Unset → null → no badge
 *    and no CTA. That is the open-core opt-in and it does not move: a bare fork
 *    still carries no Dapta branding and no dead link.
 *  - **Where does it point?** `landingUrl` when the deployment has one,
 *    `signupUrl` otherwise.
 *
 * They were the same value once, and that was the bug: both surfaces greet a
 * STRANGER — the badge says "Powered by Dapta", the CTA asks "Want your own
 * form?" — and both were dropping that person on the app's login screen for a
 * product they had never heard of. A landing page is written for exactly that
 * reader; a login screen is written for someone who already decided.
 */
export function growthTarget(opts: {
  signupUrl?: string | null;
  landingUrl?: string | null;
}): string | null {
  const signup = (opts.signupUrl ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(signup)) return null;
  const landing = (opts.landingUrl ?? '').trim();
  return /^https?:\/\/\S+$/i.test(landing) ? landing : signup;
}

/**
 * Parse the badge kill-switch (NEXT_PUBLIC_HIDE_BADGE). Truthy spellings
 * ("1", "true", "yes", any case) hide it; everything else keeps it on —
 * shown-by-default is the open-core contract.
 */
export function badgeHidden(flag: string | undefined | null): boolean {
  if (!flag) return false;
  return ['1', 'true', 'yes'].includes(flag.trim().toLowerCase());
}
