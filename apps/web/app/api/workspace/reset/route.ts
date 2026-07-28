import { NextResponse } from 'next/server';
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
 */
export async function GET(request: Request) {
  const res = NextResponse.redirect(new URL('/admin', request.url));
  res.cookies.delete(WORKSPACE_COOKIE);
  return res;
}
