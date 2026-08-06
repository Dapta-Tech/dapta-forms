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
 * Do NOT read the timeout as "this is a cheap call". Being the first authenticated
 * request makes it the most expensive one in the product: `resolveHost` inserts the
 * account and the member, derives a unique handle, seeds the demo form, and fires
 * the signup event. The bound exists because somebody is sitting in front of a
 * login that already succeeded — attribution is an observer, never a participant —
 * not because the work is small.
 *
 * The cookie survives a transport failure on purpose. It is deleted once the API
 * has ANSWERED (2xx or 4xx — either way it had its say), but a timeout or a dead
 * connection leaves it in place, so the next login on this browser retries. That is
 * safe precisely because the write is claimed once and bounded by account age: a
 * replay cannot double-count or overwrite. The residual cost is that a DIFFERENT
 * person logging in on the same browser inside the cookie's 10 minutes inherits the
 * tags — the same window the CSRF state cookie already accepts.
 */
async function recordAttribution(
  jar: Awaited<ReturnType<typeof cookies>>,
  accessToken: string,
): Promise<void> {
  const parked = jar.get(ATTRIBUTION_COOKIE)?.value;
  if (!parked) return;
  try {
    const res = await fetch(`${serverApiUrl}/v1/account/attribution`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: parked,
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    // `fetch` resolves for EVERY status, so the status has to be read: a 500 from a
    // failed-over database, or a 502 from the ingress while a pod drains, is not the
    // API having its say — it is the same transient failure as a dead socket, and
    // deleting here would lose the tags for good.
    if (res.status < 500) jar.delete(ATTRIBUTION_COOKIE);
  } catch {
    // Kept for a retry — see the note above. Never rethrown: the login succeeded.
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
