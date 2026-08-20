import { NextResponse, type NextRequest } from 'next/server';
import { requestOrigin } from '@/lib/request-origin';
import { WORKSPACE_COOKIE } from '@/lib/session';

/**
 * Drop the chosen workspace and go home.
 *
 * This exists because of WHERE cookies can be written. When the API answers
 * `WORKSPACE_FORBIDDEN` — the membership was revoked, or the account is gone —
 * the discovery happens inside a Server Component render, and `cookies().set()`
 * throws there. Redirecting without clearing produced an infinite loop: every
 * page load re-sent the dead workspace, got another 403, and redirected again.
 *
 * A Route Handler owns its response, so the cookie deletion actually lands.
 * Clearing is unconditional and idempotent, which is what makes the loop
 * impossible rather than merely unlikely.
 *
 * The redirect is built from `requestOrigin` (PUBLIC_APP_URL first), NOT from
 * `request.url`: behind the deployment's proxy the standalone server sees no
 * public Host, so `request.url` is `https://0.0.0.0:3000/...` and the browser
 * was sent there verbatim.
 */
export async function GET(request: NextRequest) {
  const res = NextResponse.redirect(new URL('/admin', requestOrigin(request)));
  res.cookies.delete(WORKSPACE_COOKIE);
  return res;
}
