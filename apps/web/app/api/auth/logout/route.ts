import { NextResponse, type NextRequest } from 'next/server';
import { clearSession, getSession } from '@/lib/auth-session';
import { requestOrigin } from '@/lib/request-origin';

/**
 * Logout — full single-logout, platform-consistent (verified contract):
 * POST {IAM}/auth/logout { workos_session_id } -> { logoutUrl }, then send the
 * browser through WorkOS logout so the next login does NOT silently re-auth.
 * Fallbacks (no session id / IAM error): clear our cookie and land on
 * /login?signedout=1 — the login page suppresses its auto-redirect for that
 * param, otherwise logout would bounce straight back into /admin.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = requestOrigin(req);
  const session = await getSession();
  await clearSession();

  const iam = process.env.IAM_BASE_URL?.replace(/\/$/, '');
  const sessionId = session?.provider === 'workos' ? session.sessionId : undefined;
  if (iam && sessionId) {
    const res = await fetch(`${iam}/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workos_session_id: sessionId }),
      cache: 'no-store',
    }).catch(() => null);
    const out = res && res.ok ? ((await res.json().catch(() => ({}))) as { logoutUrl?: string }) : null;
    if (out?.logoutUrl) return NextResponse.redirect(out.logoutUrl);
  }

  return NextResponse.redirect(new URL('/login?signedout=1', origin));
}
