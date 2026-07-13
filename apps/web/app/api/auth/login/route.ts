import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { authProvider } from '@/lib/auth-session';
import { requestOrigin } from '@/lib/request-origin';

const OAUTH_STATE_COOKIE = 'quill_oauth_state';

/**
 * WorkOS login hand-off (AUTH-WEB-CONTRACT §3.1). The web holds NO WorkOS secret;
 * IAM builds the AuthKit login URL. We mint a random `state`, stash it in a
 * short-lived httpOnly cookie, and pass it along — the callback rejects any
 * response whose `state` doesn't match (login-CSRF / session-fixation guard).
 * OSS / local builds have no IAM → bounce to /login (vendor-clean).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = requestOrigin(req);
  const iam = process.env.IAM_BASE_URL?.replace(/\/$/, '');
  if (authProvider() !== 'workos' || !iam) {
    return NextResponse.redirect(new URL('/login', origin));
  }

  const state = randomBytes(24).toString('base64url');
  (await cookies()).set(OAUTH_STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600, // 10 min — just long enough to finish the round-trip
  });

  const returnTo = `${origin}/api/auth/callback`;
  const res = await fetch(
    `${iam}/auth/login-url?returnTo=${encodeURIComponent(returnTo)}&state=${encodeURIComponent(state)}`,
    { cache: 'no-store' },
  ).catch(() => null);
  const loginUrl = res && res.ok ? ((await res.json().catch(() => ({}))) as { loginUrl?: string }).loginUrl : undefined;
  if (!loginUrl) return NextResponse.redirect(new URL('/login?error=login', origin));
  return NextResponse.redirect(loginUrl);
}
