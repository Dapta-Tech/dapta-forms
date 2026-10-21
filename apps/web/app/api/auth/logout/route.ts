import { NextResponse, type NextRequest } from 'next/server';
import { clearSession, getSession, revokeUpstreamSession } from '@/lib/auth-session';
import { canonicalOriginElsewhere, requestOrigin } from '@/lib/request-origin';

/**
 * Logout, Orbit's contract exactly: revoke upstream best-effort (see
 * `revokeUpstreamSession`), ALWAYS clear our cookie, land on
 * /login?signedout=1 (whose param suppresses the login page's auto-redirect).
 * The browser never visits WorkOS (Orbit's skipIdpRedirect = true), so nothing
 * here depends on the WorkOS logout-redirect allowlist. The accepted
 * consequence, same as the Dapta platform app: the AuthKit cookie on WorkOS's domain
 * stays alive and the next "sign in" re-authenticates the same person without
 * prompting. `?reason=expired` marks the session-expiry arrival from
 * `admin-api.ts` but no longer changes behavior; it stays for observability.
 *
 * The explicit sign-out button does NOT come through here: `signOutAction` and
 * `hostFetch` revoke + clear inline, because an action `redirect()` into a
 * route handler soft-navigates and strands the URL bar on /api/auth/logout.
 * This route serves the contexts that cannot touch the cookie themselves: the
 * 401 path inside a Server Component render (`admin-api.ts`, where
 * `cookies().delete()` throws) and direct navigation.
 *
 * On a host other than `PUBLIC_APP_URL` (an old domain still serving after a
 * move) it signs out of THAT host only: the cookie it clears is that host's,
 * `revokeUpstreamSession` leaves the upstream session alone there, and the
 * landing stays on that host too. The landing is a relative Location so the
 * browser resolves it against the host it asked, with no header trusted to
 * build it; an absolute one on `PUBLIC_APP_URL` would show a signed-out page
 * on a host where the person may still be signed in.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  await clearSession();
  await revokeUpstreamSession(session);
  if (canonicalOriginElsewhere((n) => req.headers.get(n))) {
    return new NextResponse(null, { status: 307, headers: { location: '/login?signedout=1' } });
  }
  return NextResponse.redirect(new URL('/login?signedout=1', requestOrigin(req)));
}
