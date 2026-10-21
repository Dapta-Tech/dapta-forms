import { NextResponse, type NextRequest } from 'next/server';

/**
 * Public origin of the running deployment, used to build OAuth `returnTo` URLs
 * and post-login redirects.
 *
 * SECURITY (B1): `Host` / `X-Forwarded-Host` are attacker-controllable — the ALB
 * does NOT strip a client-supplied `X-Forwarded-Host`. Building the login
 * `returnTo` from them lets an attacker redirect the post-auth `?session=` token
 * blob to their own host (session/account takeover), or open-redirect a victim.
 * So when `PUBLIC_APP_URL` is configured it is the ONLY origin we trust; the
 * request headers are used ONLY as a fallback for a self-host/dev clone that has
 * not set it (where there is no fronting proxy to spoof through).
 */
export function requestOrigin(req: NextRequest): string {
  const own = req.nextUrl.protocol.replace(/:$/, '') || undefined;
  return originFrom((n) => req.headers.get(n), own) ?? new URL(req.url).origin;
}

/**
 * Same trust order as `requestOrigin`, for callers that hold `headers()` instead
 * of a `NextRequest` (server actions have no request object). Null when nothing
 * trustworthy resolves; a caller building an OAuth or IdP redirect should then
 * skip the redirect rather than guess an origin.
 *
 * `fallbackProto` is the scheme to use when a host resolves but no
 * `X-Forwarded-Proto` came with it. It is NOT a trust decision: the host is
 * whatever the trust order already settled on, and this only picks the scheme
 * to pair with it.
 */
export function originFrom(
  get: (name: string) => string | null | undefined,
  fallbackProto?: string,
): string | null {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Misconfigured PUBLIC_APP_URL: fall through to header derivation rather
      // than crash the auth path.
    }
  }
  const proto = get('x-forwarded-proto')?.split(',')[0]?.trim();
  const host = selfHost(get);
  if (proto && host) return `${proto}://${host}`;
  // A bare self-host/dev clone with no proxy in front: the Host header is the
  // only signal there is. The request's OWN scheme is the next best thing and
  // callers holding a NextRequest pass it, because a deployment that forwards
  // Host but not X-Forwarded-Proto would otherwise downgrade an https OAuth
  // returnTo to http. Only the server-action caller, which has no request
  // object to read a scheme off, falls back to plain http.
  if (host) return `${fallbackProto ?? 'http'}://${host}`;
  return null;
}

/**
 * The host this deployment answers on, in the SAME trust order as `requestOrigin`:
 * `PUBLIC_APP_URL` when configured, request headers only as a fallback for a
 * self-host clone that has not set it.
 *
 * Takes a header getter rather than a `NextRequest` so a server component holding
 * `headers()` can call it too. Exported so there is ONE implementation: a second
 * copy is how a chained proxy's `x-forwarded-host: a.example, b.example` becomes a
 * "host" that equals nothing, and every same-origin check silently inverts.
 */
export function selfHost(get: (name: string) => string | null | undefined): string | null {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).host;
    } catch {
      // Same fall-through as above: a bad env var must not break the request.
    }
  }
  return headerHost(get);
}

/**
 * The host the request itself names, from the headers alone: the first hop of
 * `X-Forwarded-Host`, else `Host`. That is the order Next's own Server Actions
 * origin check reads them in, so a deployment whose admin can save at all
 * already hands the app its public host here.
 *
 * NOT an origin to build URLs from (see `selfHost` for that): the headers are
 * client-supplied. Only fit for a decision whose every outcome is safe for the
 * person who sent them.
 */
export function headerHost(get: (name: string) => string | null | undefined): string | null {
  return get('x-forwarded-host')?.split(',')[0]?.trim() || get('host')?.trim() || null;
}

/**
 * The `PUBLIC_APP_URL` origin when the request arrived on a different hostname,
 * else null (no `PUBLIC_APP_URL`, same hostname, or nothing parseable).
 *
 * Built for the login hand-off, whose state cookie is host-only: a login started
 * on any other hostname comes back to the `PUBLIC_APP_URL` callback without it.
 *
 * Hostnames only, case-insensitive (the URL parser lowercases them). Port and
 * scheme are ignored on purpose: cookies are not isolated by port, so a login on
 * another port of the same hostname already works; and behind TLS termination the
 * app cannot see the public scheme or port reliably, so comparing them could send
 * a login on the right host into a redirect loop.
 *
 * Safe on spoofed headers because the answer is never taken FROM them: it is the
 * configured origin or nothing. A forged `X-Forwarded-Host` can only send its
 * sender to `PUBLIC_APP_URL`, or keep today's behavior for its sender.
 */
export function canonicalOriginElsewhere(
  get: (name: string) => string | null | undefined,
): string | null {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (!configured) return null;
  let canonical: URL;
  try {
    canonical = new URL(configured);
  } catch {
    // Same rule as `originFrom`: a bad env var never breaks the request.
    return null;
  }
  const arrived = headerHost(get);
  if (!arrived) return null;
  let arrivedHostname: string;
  try {
    arrivedHostname = new URL(`http://${arrived}`).hostname;
  } catch {
    return null;
  }
  return arrivedHostname === canonical.hostname ? null : canonical.origin;
}

/**
 * The hop itself: a 302 to the same path and query on the `PUBLIC_APP_URL`
 * origin when a GET or HEAD arrives on another hostname, else null (see
 * `canonicalOriginElsewhere` for when that is). Used by the routes and pages
 * that only work where the session cookies live: the login hand-off, the
 * dashboard, the first-run wizard and the session refresh (`proxy.ts`).
 *
 * GET and HEAD only. A 302 turns a POST into a GET and drops its body, so a
 * Server Action or a form post sent from a tab opened before a domain move
 * keeps running on the host it was sent to.
 *
 * The path and query go over exactly as this request got them (Next has
 * already normalized the encoding, so the canonical host parses what it would
 * on a direct visit). No cookie is read or written. `no-store`: the answer
 * depends on request headers, and a cached hop served back to the canonical
 * host would loop.
 */
export function canonicalHop(req: NextRequest): NextResponse | null {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const canonical = canonicalOriginElsewhere((n) => req.headers.get(n));
  if (!canonical) return null;
  const { pathname, search } = new URL(req.url);
  const hop = NextResponse.redirect(`${canonical}${pathname}${search}`, 302);
  hop.headers.set('cache-control', 'no-store');
  return hop;
}
