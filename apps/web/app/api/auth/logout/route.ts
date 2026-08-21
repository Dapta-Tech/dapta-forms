import { NextResponse, type NextRequest } from 'next/server';
import { clearSession, getSession, idpLogoutTarget, revokeUpstreamSession } from '@/lib/auth-session';
import { requestOrigin } from '@/lib/request-origin';

/**
 * Logout: revoke upstream best-effort (see `revokeUpstreamSession`), ALWAYS
 * clear our cookie, then follow the IdP logout URL so WorkOS ends the browser
 * session too and returns the person to /login?signedout=1 (whose param
 * suppresses the login page's auto-redirect). Without the WorkOS hop the shared
 * Dapta session survives and the next "sign in" silently re-authenticates the
 * same person.
 *
 * `?reason=expired` skips the WorkOS hop (Orbit's skipIdpRedirect = true):
 * it marks a session-expiry logout, not a person asking to leave, and a Forms
 * token expiring must not end their whole Dapta platform session.
 *
 * The explicit sign-out button does NOT come through here: `signOutAction` and
 * `hostFetch` revoke + clear inline, because an action `redirect()` into a
 * route handler soft-navigates and strands the URL bar on /api/auth/logout.
 * This route serves the contexts that cannot touch the cookie themselves: the
 * 401 path inside a Server Component render (`admin-api.ts`, where
 * `cookies().delete()` throws, arriving with ?reason=expired) and direct
 * navigation (full logout).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = requestOrigin(req);
  const session = await getSession();
  await clearSession();
  const logoutUrl = await revokeUpstreamSession(session);
  const expired = req.nextUrl.searchParams.get('reason') === 'expired';
  const idp = expired ? null : idpLogoutTarget(logoutUrl, origin);
  if (idp) return NextResponse.redirect(idp);
  return NextResponse.redirect(new URL('/login?signedout=1', origin));
}
