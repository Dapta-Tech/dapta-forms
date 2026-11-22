import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { after, NextResponse, type NextRequest } from 'next/server';
import { parseAttribution } from '@quill/types';
import { PH_ID_COOKIE, PH_ID_QUERY_KEY, sanitizeLandingDistinctId } from '@/lib/attribution';
import { authProvider } from '@/lib/auth-session';
import { recordLoginStarted, type LoginStart } from '@/lib/login-started';
import { resolveProductAnalytics } from '@/lib/product-analytics';
import { SCREEN_PARAM, wantsSignUp } from '@/lib/login-screen';
import { canonicalHop, requestOrigin } from '@/lib/request-origin';

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

/** The campaign source of an already-parked attribution cookie, or null. */
function parkedUtmSource(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parked = JSON.parse(raw) as { utmSource?: unknown } | null;
    return typeof parked?.utmSource === 'string' ? parked.utmSource : null;
  } catch {
    return null;
  }
}

/**
 * `forms_login_started` (lib/login-started.ts), sent after the redirect has gone
 * out, never in front of it. Outside a request (a script, a spec) `after`
 * throws, and there is then nothing to record.
 */
function scheduleLoginStarted(start: LoginStart): void {
  try {
    const analytics = resolveProductAnalytics();
    if (!analytics.key) return;
    after(() => recordLoginStarted(start, analytics));
  } catch {
    /* not in a request: nothing to record */
  }
}

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

  // Start the login where it ends. `returnTo` is always the PUBLIC_APP_URL
  // callback and the state cookie below is host-only, so a login started on any
  // other hostname (an old domain still serving after a move) can only come back
  // as /login?error=state. Hop to the same path and query, as this route got
  // them, on the PUBLIC_APP_URL origin BEFORE any cookie is written: the tags,
  // `ph_id`, `next` and `prompt` are then parked on the host whose callback
  // reads them, and `screen` reaches the request below unchanged. The target is the configured origin, never taken from a
  // header, so this is no open redirect (`canonicalHop` has the rest).
  const hop = canonicalHop(req);
  if (hop) return hop;

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
  // What this attempt is filed under for `forms_login_started`: what was parked
  // already wins, the same first-attempt rule as the cookies below. Read before
  // they are written.
  // It is the cookie's PRESENCE that decides, not its source: a parked blob with
  // a referrer and no `utmSource` is still the attribution the callback sends,
  // so this attempt's tags must not stand in for the missing source.
  const parkedLandingId = jar.get(PH_ID_COOKIE)?.value;
  const parkedAttribution = jar.get(ATTRIBUTION_COOKIE)?.value;
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

  // `prompt=login` makes AuthKit show its sign-in screen even when the shared
  // WorkOS session cookie is still alive, which is what turns the button on
  // the signed-out landing into a real "sign in as someone" instead of a
  // silent re-authentication (Orbit's promptLogin contract). Allowlisted to
  // the one value we mean: this route is directly reachable and the value
  // ends up on a WorkOS URL. The bare auto-redirect from /login sends no
  // prompt, keeping the arriving-from-Dapta silent SSO.
  const prompt = sp.get('prompt') === 'login' ? 'login' : null;
  // `?screen=sign-up` (lib/login-screen.ts): a landing's "create an account"
  // call to action, passed on by the root page beside the campaign tags.
  // Allowlisted the same way, and what goes on the wire is a constant, never
  // the value that arrived. The identity service already carries its sign-up
  // hint onto the authorize URL, so unlike `prompt` there is nothing to patch
  // on its answer. Every other arrival, the /login redirect of a signed-out
  // dashboard visit included, sends nothing and opens on the sign-in screen as
  // before. A repeated parameter is not a choice, as on the root page: it
  // reads as none.
  const screens = sp.getAll(SCREEN_PARAM);
  const signUp = screens.length === 1 && wantsSignUp(screens[0]);

  const returnTo = `${origin}/api/auth/callback`;
  const res = await fetch(
    `${iam}/auth/login-url?returnTo=${encodeURIComponent(returnTo)}&state=${encodeURIComponent(state)}` +
      (prompt ? `&prompt=${prompt}` : '') +
      (signUp ? '&screenHint=sign-up' : ''),
    { cache: 'no-store' },
  ).catch(() => null);
  const loginUrl = res && res.ok ? ((await res.json().catch(() => ({}))) as { loginUrl?: string }).loginUrl : undefined;
  if (!loginUrl) return NextResponse.redirect(new URL('/login?error=login', origin));
  // The only record of someone who opens the hosted screen and leaves. Called
  // right before each redirect there, never on the way to the error card; a
  // no-op with analytics off.
  const started = () =>
    scheduleLoginStarted({
      screen: signUp ? 'sign-up' : 'sign-in',
      landingId: parkedLandingId ?? landingId,
      utmSource: parkedAttribution ? parkedUtmSource(parkedAttribution) : attribution?.utmSource,
      origin,
      userAgent: req.headers.get('user-agent'),
    });
  // The IAM currently drops the prompt param instead of forwarding it to the
  // authorize URL, so patch it on ourselves, exactly like Orbit's
  // enforcePromptOnLoginUrl ("if IAM forgets to propagate prompt to WorkOS,
  // patch the returned loginUrl"). Harmless once the IAM learns to forward it.
  if (prompt) {
    try {
      const patched = new URL(loginUrl);
      patched.searchParams.set('prompt', prompt);
      const redirect = NextResponse.redirect(patched.toString());
      started();
      return redirect;
    } catch {
      return NextResponse.redirect(new URL('/login?error=login', origin));
    }
  }
  const redirect = NextResponse.redirect(loginUrl);
  started();
  return redirect;
}
