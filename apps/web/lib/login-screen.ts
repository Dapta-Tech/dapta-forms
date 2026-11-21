/**
 * Which screen the hosted login opens on: sign-in (always, until now) or
 * sign-up.
 *
 * A product landing links into the app in two ways: a log-in link and a
 * "create an account" call to action. Both point at the app ROOT, not at the
 * login route: the root is the page that reads the campaign tags and the
 * landing's analytics id off the link and hands them to `/api/auth/login`
 * (`attributionHandoffQuery`, lib/attribution.ts). The call to action adds
 * `?screen=sign-up`; on a WorkOS build the root passes it on beside those tags,
 * and the login route asks the identity service for its sign-up screen (a local
 * build has no hosted screen to pick, and ignores it). Everything else opens on
 * sign-in exactly as before, including the `/login` redirect a signed-out visit
 * to a dashboard page goes through, which never carries it.
 *
 * One allowlisted value, compared exactly: the parameter arrives from any URL
 * and the route turns it into a parameter of the identity service. `screen` is
 * this app's own name for it; only the login route knows what the identity
 * service calls it.
 *
 * PURE on purpose (no `next/headers`): the root page, the login route and the
 * specs read it the same way, and route files may only export handlers.
 */

/** The query parameter the screen choice travels in. */
export const SCREEN_PARAM = 'screen';

/** The one value it takes: the sign-up screen. */
export const SIGN_UP_SCREEN = 'sign-up';

/**
 * Whether a raw `?screen=` value asks for the sign-up screen. Exactly `sign-up`,
 * nothing else: a repeated parameter (an array) is not a choice and reads as none.
 */
export function wantsSignUp(raw: unknown): boolean {
  return raw === SIGN_UP_SCREEN;
}

/**
 * The login route path the root hands an anonymous visitor to.
 *
 * `attributionQuery` is what `attributionHandoffQuery` built (`''` when there is
 * nothing to carry) and is kept exactly as it came. The sign-up choice is added
 * after it, rebuilt from the constants and never copied from the request.
 * Without it the path is byte for byte the one the root always built.
 */
export function loginHandoffPath(attributionQuery: string, signUp: boolean): string {
  const screen = signUp ? `${SCREEN_PARAM}=${SIGN_UP_SCREEN}` : '';
  const query = [attributionQuery, screen].filter(Boolean).join('&');
  return query ? `/api/auth/login?${query}` : '/api/auth/login';
}
