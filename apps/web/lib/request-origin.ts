import type { NextRequest } from 'next/server';

/**
 * Public origin of the running deployment. Behind the ALB, `req.url` reflects
 * the server's bind address (e.g. https://0.0.0.0:3000) — building redirects or
 * OAuth returnTo URLs from it silently breaks login. Prefer the standard
 * proxy headers (set by the ALB), fall back to req.url for local dev.
 */
export function requestOrigin(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const host =
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    req.headers.get('host')?.trim();
  if (proto && host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}
