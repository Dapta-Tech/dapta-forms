import { NextResponse, type NextRequest } from 'next/server';
import { getSession, refreshUpstreamSession, setSession } from '@/lib/auth-session';
import { requestOrigin } from '@/lib/request-origin';

/**
 * Session refresh for the one context that cannot write cookies itself: a 401
 * during a Server Component render (`admin-api.ts`, where `cookies().set()`
 * throws). The render redirects here; this handler trades the refresh token
 * for a fresh access token, stores it, and sends the person back to /admin.
 * When the refresh fails (refresh token expired or revoked, IAM down) it
 * hands off to the logout route, which is exactly where the render-time 401
 * used to go before refresh existed.
 *
 * No `next` parameter on purpose: a redirect target taken from the query is
 * an open-redirect surface on the auth path, and landing on /admin matches
 * what the pre-refresh flow already did. Server actions never come through
 * here; `hostFetch` refreshes inline.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = requestOrigin(req);
  const refreshed = await refreshUpstreamSession(await getSession());
  if (!refreshed) {
    return NextResponse.redirect(new URL('/api/auth/logout?reason=expired', origin));
  }
  await setSession(refreshed);
  return NextResponse.redirect(new URL('/admin', origin));
}
