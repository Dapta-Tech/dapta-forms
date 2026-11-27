import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getSession, refreshUpstreamSession, setSession } from '@/lib/auth-session';
import { requestOrigin } from '@/lib/request-origin';
import { NEXT_COOKIE, NEXT_QUERY_KEY, playbookReturnPath, withNextPath } from '@/lib/return-path';

/**
 * Session refresh for the one context that cannot write cookies itself: a 401
 * during a Server Component render (`admin-api.ts`, where `cookies().set()`
 * throws). The render redirects here; this handler trades the refresh token
 * for a fresh access token, stores it, and sends the person back to /admin.
 * When the refresh fails (refresh token expired or revoked, IAM down) it
 * hands off to the logout route, which is exactly where the render-time 401
 * used to go before refresh existed.
 *
 * `?next=` is honored for the playbooks only (`playbookReturnPath`: a path of
 * this app under `/admin/playbooks`, nothing else, so it is no open
 * redirect), because their links arrive by email and ask for a download that
 * landing on /admin would lose. With one:
 *  - a refreshed session goes back to that page;
 *  - someone with no session at all goes straight to the hosted login, which
 *    comes back to it. Only once: if the destination is already parked
 *    (`quill_next`), the login was just tried, and going again could loop, so
 *    the signed-out landing answers instead;
 *  - a session that cannot be refreshed signs out as always, and the sign-in
 *    button of the landing keeps the destination.
 *
 * Every other page still lands on /admin. Server actions never come through
 * here; `hostFetch` refreshes inline.
 *
 * Only ever runs on the `PUBLIC_APP_URL` host when that is set: `proxy.ts`
 * hops a GET or HEAD from any other hostname here first, so the refresh reads
 * the cookie of the host that holds the session, and its redirects, which are
 * built on `PUBLIC_APP_URL`, never send another host's visitor to the
 * canonical host's logout.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = requestOrigin(req);
  const next = playbookReturnPath(new URL(req.url).searchParams.getAll(NEXT_QUERY_KEY));
  const session = await getSession();
  const refreshed = await refreshUpstreamSession(session);
  if (!refreshed) {
    if (next && !session && (await cookies()).get(NEXT_COOKIE)?.value !== next) {
      return NextResponse.redirect(new URL(withNextPath('/api/auth/login', next), origin));
    }
    return NextResponse.redirect(new URL(withNextPath('/api/auth/logout?reason=expired', next), origin));
  }
  await setSession(refreshed);
  return NextResponse.redirect(new URL(next ?? '/admin', origin));
}
