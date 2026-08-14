import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { parseAttribution } from '@quill/types';
import { PH_ID_COOKIE, PH_ID_QUERY_KEY, sanitizeLandingDistinctId } from '@/lib/attribution';
import { authProvider } from '@/lib/auth-session';
import { requestOrigin } from '@/lib/request-origin';

const OAUTH_STATE_COOKIE = 'quill_oauth_state';
/**
 * Acquisition tags, parked for the identity round-trip.
 *
 * A cookie and not the `returnTo` URL: `returnTo` is handed to an external
 * service and echoed back, so anything in it is visible and editable by whoever
 * holds the link. The cookie stays on this origin, is httpOnly, and expires with
 * the login attempt — the callback is the only reader.
 */
const ATTRIBUTION_COOKIE = 'quill_attribution';

/**
 * WorkOS login hand-off (AUTH-WEB-CONTRACT §3.1). The web holds NO WorkOS secret;
 * IAM builds the AuthKit login URL. We mint a random `state`, stash it in a
 * short-lived httpOnly cookie, and pass it to IAM — the callback requires that
 * cookie to be present AND, when IAM echoes the `state` back, requires it to
 * match the cookie (constant-time): a login-CSRF / session-fixation guard.
 * OSS / local builds have no IAM → bounce to /login (vendor-clean).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = requestOrigin(req);
  const iam = process.env.IAM_BASE_URL?.replace(/\/$/, '');
  if (authProvider() !== 'workos' || !iam) {
    return NextResponse.redirect(new URL('/login', origin));
  }

  const state = randomBytes(24).toString('base64url');
  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600, // 10 min — just long enough to finish the round-trip
  });

  // Park the acquisition tags the root page forwarded. Same lifetime as the CSRF
  // state: they are only meaningful for THIS login attempt, and a stale cookie
  // would attribute a later signup to a campaign the person saw days ago.
  // Absent tags set no cookie — the callback then has nothing to send, which is
  // what keeps a direct visit from spending the write-once first-touch claim.
  // `getAll` per key, not `Object.fromEntries`: that collapses a repeated param to
  // the LAST value, which would quietly invert `parseAttribution`'s first-wins rule
  // — and this route is directly reachable, so it is the one surface that sees a
  // raw query string somebody else composed.
  const sp = new URL(req.url).searchParams;
  const attribution = parseAttribution(
    Object.fromEntries([...new Set(sp.keys())].map((k) => [k, sp.getAll(k)])),
  );
  // An already-parked value is NOT overwritten. The account-level claim is genuine
  // first-touch, but at this point no account exists yet, so nothing else enforces
  // it ACROSS login attempts: arrive from campaign A, abandon at the provider, come
  // back from campaign B inside ten minutes, and last-wins would credit B.
  if (attribution && !jar.get(ATTRIBUTION_COOKIE)) {
    jar.set(ATTRIBUTION_COOKIE, JSON.stringify(attribution), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600,
    });
  }

  // The landing's PostHog anonymous id, parked beside the tags with the same
  // rules: sanitized (this query is composable by anyone), first attempt wins
  // (the id of the visit that STARTED the login is the one worth joining), and
  // absent sets nothing. Unlike the tags it never touches the API or the
  // database — its whole life is browser-side, ending in one `alias` call.
  const landingId = sanitizeLandingDistinctId(sp.getAll(PH_ID_QUERY_KEY));
  if (landingId && !jar.get(PH_ID_COOKIE)) {
    jar.set(PH_ID_COOKIE, landingId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600,
    });
  }

  const returnTo = `${origin}/api/auth/callback`;
  const res = await fetch(
    `${iam}/auth/login-url?returnTo=${encodeURIComponent(returnTo)}&state=${encodeURIComponent(state)}`,
    { cache: 'no-store' },
  ).catch(() => null);
  const loginUrl = res && res.ok ? ((await res.json().catch(() => ({}))) as { loginUrl?: string }).loginUrl : undefined;
  if (!loginUrl) return NextResponse.redirect(new URL('/login?error=login', origin));
  return NextResponse.redirect(loginUrl);
}
