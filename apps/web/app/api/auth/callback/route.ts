import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { serverApiUrl } from '@/lib/api-url';
import { setSession } from '@/lib/auth-session';
import { requestOrigin } from '@/lib/request-origin';

const OAUTH_STATE_COOKIE = 'quill_oauth_state';
const ATTRIBUTION_COOKIE = 'quill_attribution';

/**
 * Hand the parked acquisition tags to the API, which stores them write-once.
 *
 * Uses the freshly-minted access token directly instead of reading the session
 * back: `setSession` writes its cookie on the OUTGOING response, so a read in
 * this same request is not guaranteed to see it.
 *
 * It runs BEFORE the redirect for a mundane reason: a route handler cannot
 * outlive its own response, so work started here and not awaited may simply be
 * killed. Nothing races it — `claimAccountAttribution` is the column's only
 * writer, so the dashboard's first request cannot claim anything.
 *
 * The timeout is deliberately short. This is the one request where somebody is
 * already waiting on a login that has succeeded, and it is a same-cluster call:
 * attribution is an observer of the product, never a participant, so a slow API
 * must cost the person milliseconds, not seconds.
 */
async function recordAttribution(
  jar: Awaited<ReturnType<typeof cookies>>,
  accessToken: string,
): Promise<void> {
  const parked = jar.get(ATTRIBUTION_COOKIE)?.value;
  jar.delete(ATTRIBUTION_COOKIE);
  if (!parked) return;
  try {
    await fetch(`${serverApiUrl}/v1/account/attribution`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: parked,
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // Swallowed on purpose — see the note above.
  }
}

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
  await recordAttribution(jar, tokens.access_token);
  return NextResponse.redirect(new URL('/admin', origin));
}
