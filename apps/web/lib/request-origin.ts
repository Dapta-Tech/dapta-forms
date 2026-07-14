import type { NextRequest } from 'next/server';

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
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Misconfigured PUBLIC_APP_URL — fall through to header/req.url derivation
      // rather than crash the auth route.
    }
  }
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const host =
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    req.headers.get('host')?.trim();
  if (proto && host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}
