import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { setSession } from '@/lib/auth-session';
import { requestOrigin } from '@/lib/request-origin';

const OAUTH_STATE_COOKIE = 'quill_oauth_state';

/** Constant-time string equality (guards length leak). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * WorkOS callback contract verified against the private deployment adapter:
 *
 * WorkOS redirects to IAM's OWN /auth/callback; IAM exchanges the code itself
 * and 302s back to our `returnTo` carrying the whole session base64-encoded in
 * a `?session=` query param: { success, access_token, refresh_token, ... }.
 * There is NO code→token exchange endpoint for us to call.
 *
 * CSRF binding (M1): /api/auth/login minted a random `state` into a short-lived
 * httpOnly cookie and passed it to IAM. Here we (1) require that cookie to be
 * present — the login MUST have started on this browser — and (2) when IAM
 * echoes the `state` back as a query param, require it to MATCH the cookie
 * (constant-time). That upgrades a stolen-cookie/fixation attempt from
 * presence-only binding to a full state check whenever the upstream round-trips
 * state. The token itself is additionally verified server-side (HS256) by the
 * API on every request — a forged/foreign `session` blob buys nothing.
 *
 * The raw JWT never persists in the URL: we immediately 302 to /admin, so the
 * `session` param never lands in browser history for the final page.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const origin = requestOrigin(req);

  // The login round-trip must have started here (cookie set by /api/auth/login).
  const jar = await cookies();
  const started = jar.get(OAUTH_STATE_COOKIE)?.value;
  jar.delete(OAUTH_STATE_COOKIE);
  if (!started) return NextResponse.redirect(new URL('/login?error=state', origin));

  // When IAM echoes our CSRF state back, it MUST match the cookie.
  const returnedState = url.searchParams.get('state');
  if (returnedState && !safeEqual(returnedState, started)) {
    return NextResponse.redirect(new URL('/login?error=state', origin));
  }

  const encoded = url.searchParams.get('session');
  if (!encoded) return NextResponse.redirect(new URL('/login?error=callback', origin));

  let tokens: { access_token?: string; refresh_token?: string; session_id?: string } | null = null;
  try {
    tokens = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8')) as {
      access_token?: string;
      refresh_token?: string;
      session_id?: string;
    };
  } catch {
    tokens = null;
  }
  if (!tokens?.access_token) {
    return NextResponse.redirect(new URL('/login?error=callback', origin));
  }

  await setSession({
    provider: 'workos',
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    sessionId: tokens.session_id,
  });
  return NextResponse.redirect(new URL('/admin', origin));
}
