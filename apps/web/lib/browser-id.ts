/**
 * A first-party BROWSER id, for the referral program's same-browser rule: a
 * referral does not count when the new person signs up in a browser the
 * referrer was seen in (one person opening several accounts in their own
 * browser to reach the referral unlock).
 *
 * A random, opaque value (32 bytes, base64url) in a long-lived httpOnly
 * cookie on the app's own host. It carries no personal data and identifies
 * nothing but "this browser profile". It is minted when missing on the login
 * routes and on dashboard loads (`proxy.ts`), and it is NEVER cleared: not on
 * logout and not when switching accounts, because surviving those is the
 * whole point. A private window or another browser gets its own (an accepted
 * gap, see ADR 0005).
 *
 * The web forwards it in one header on its server-side API calls; the API
 * hashes it before storing anything (`apps/api/src/browser-id.ts`).
 */

/** The cookie. */
export const BROWSER_ID_COOKIE = 'dforms_bid';

/** The header the API reads. Kept in step with `apps/api/src/browser-id.ts`. */
export const BROWSER_ID_HEADER = 'x-quill-browser';

/** Two years, in seconds. */
export const BROWSER_ID_MAX_AGE = 2 * 365 * 24 * 60 * 60;

/** What the web mints, and what the API accepts. */
const BROWSER_ID = /^[A-Za-z0-9_-]{22,128}$/;

/** A fresh id: 32 random bytes, base64url, no padding (43 characters). Web Crypto, so it runs in the proxy too. */
export function newBrowserId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** The id in a raw cookie value, or null when missing or malformed. */
export function browserIdFromCookie(raw: string | undefined): string | null {
  return raw && BROWSER_ID.test(raw) ? raw : null;
}

/** The cookie's attributes: httpOnly, Lax, two years, Secure in production (as the other cookies). */
export function browserIdCookieOptions() {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: BROWSER_ID_MAX_AGE,
  };
}

/** Minimal cookie-jar shapes, so callers can pass `cookies()` or a request's jar. */
interface CookieReader {
  get(name: string): { value: string } | undefined;
}
interface CookieWriter extends CookieReader {
  set(name: string, value: string, options: ReturnType<typeof browserIdCookieOptions>): unknown;
}

/**
 * The browser's id, minted and set on `jar` when it has none (a route handler
 * may write cookies; a Server Component render may not, see `proxy.ts`).
 */
export function ensureBrowserId(jar: CookieWriter): string {
  const existing = browserIdFromCookie(jar.get(BROWSER_ID_COOKIE)?.value);
  if (existing) return existing;
  const id = newBrowserId();
  jar.set(BROWSER_ID_COOKIE, id, browserIdCookieOptions());
  return id;
}

/** The header to add to an API call, or an empty object without an id. Spread it into the request headers. */
export function browserIdHeaders(jar: CookieReader): Record<string, string> {
  const id = browserIdFromCookie(jar.get(BROWSER_ID_COOKIE)?.value);
  return id ? { [BROWSER_ID_HEADER]: id } : {};
}
