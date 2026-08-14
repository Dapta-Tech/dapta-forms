import { NextResponse, type NextRequest } from 'next/server';
import { clearSession, getSession, revokeUpstreamSession } from '@/lib/auth-session';
import { requestOrigin } from '@/lib/request-origin';

/**
 * Logout — Orbit-parity contract (skipIdpRedirect = true): revoke upstream
 * best-effort (see `revokeUpstreamSession`), ALWAYS clear our cookie, land on
 * /login?signedout=1 — the browser never visits WorkOS. The login page
 * suppresses its auto-redirect for that param, otherwise logout would bounce
 * straight back into /admin.
 *
 * Server ACTIONS don't come through here — `signOutAction` and `hostFetch`
 * revoke + clear inline, because an action `redirect()` into a route handler
 * soft-navigates and strands the URL bar on /api/auth/logout. This route serves
 * the contexts that cannot touch the cookie themselves: the 401 path inside a
 * Server Component render (`admin-api.ts`, where `cookies().delete()` throws)
 * and direct navigation.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = requestOrigin(req);
  const session = await getSession();
  await clearSession();
  await revokeUpstreamSession(session);
  return NextResponse.redirect(new URL('/login?signedout=1', origin));
}
