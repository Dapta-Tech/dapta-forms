import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SESSION_COOKIE } from './session';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Web session lifecycle (per AUTH-WEB-CONTRACT §1–4). The web owns the session;
 * the API owns identity resolution. Two shapes, one per provider:
 *  - local  → carries the dev-login email (sent as `x-quill-email`).
 *  - workos → carries the IAM-minted platform JWT (sent as `Authorization: Bearer`).
 * Stored ONLY in an httpOnly cookie — never exposed to client JS.
 */
export type Session =
  | { provider: 'local'; email: string }
  | { provider: 'workos'; accessToken: string; refreshToken?: string; sessionId?: string };

export const authProvider = (): 'local' | 'workos' =>
  process.env.AUTH_PROVIDER === 'workos' ? 'workos' : 'local';

const secret = () => process.env.WEB_SESSION_SECRET ?? '';

/**
 * Default-deny: an UNSIGNED session cookie is a forgeable `x-quill-email`/JWT
 * carrier, so we only permit it for the zero-risk `local` dev provider. Any
 * non-local deployment MUST set WEB_SESSION_SECRET — otherwise we fail loud
 * rather than silently accept forgeable sessions.
 */
function requireSecretUnlessLocal(): void {
  if (!secret() && authProvider() !== 'local') {
    throw new Error(
      'WEB_SESSION_SECRET is required unless AUTH_PROVIDER=local — refusing to issue an unsigned, forgeable session cookie.',
    );
  }
}

/** `base64url(payload).hmac` — tamper-evident when WEB_SESSION_SECRET is set; a
 *  bare OSS `local` fork with no secret uses the payload alone (dev only). */
export function encodeSession(s: Session): string {
  const payload = Buffer.from(JSON.stringify(s)).toString('base64url');
  if (!secret()) return payload;
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function decodeSession(raw: string | undefined): Session | null {
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload) return null;
  if (secret()) {
    const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
    if (!sig || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null; // forged / secret-rotated → treat as no session
    }
  }
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    // Validate the required field per branch — a corrupt/stale-format cookie must
    // read as "no session" (→ clean 401 → login), not a half-authenticated state.
    if (s?.provider === 'local' && typeof s.email === 'string' && s.email) return s;
    if (s?.provider === 'workos' && typeof s.accessToken === 'string' && s.accessToken) return s;
    return null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

/**
 * Identity headers for a raw host `fetch()` that doesn't route through
 * admin-api's `req()` (a few server actions post directly). Same contract as
 * admin-api (§1): Bearer for workos, x-quill-email for local, nothing when
 * logged out (→ the API 401s → the gate redirects).
 */
export async function hostHeaders(): Promise<Record<string, string>> {
  const s = await getSession();
  if (s?.provider === 'workos') return { authorization: `Bearer ${s.accessToken}` };
  if (s?.provider === 'local') return { 'x-quill-email': s.email };
  return {};
}

/**
 * Authenticated host fetch for SERVER ACTIONS (AUTH-WEB-CONTRACT §1 + §4):
 * attaches identity, and on a `401` clears the (now-invalid) session and bounces
 * to /login — so a mid-session expiry logs the user out instead of a dead-end
 * "Failed" toast. The thrown redirect must be re-thrown past any action catch
 * (use `unstable_rethrow(e)` first in the catch). Only call from an action/route
 * handler (it may clear the cookie).
 */
export async function hostFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...((init?.headers as Record<string, string>) ?? {}), ...(await hostHeaders()) },
    cache: 'no-store',
  });
  if (res.status === 401) {
    await clearSession();
    redirect(authProvider() === 'workos' ? '/api/auth/logout' : '/login');
  }
  return res;
}

/** Set the session cookie (only valid in a Server Action or Route Handler). */
export async function setSession(s: Session): Promise<void> {
  requireSecretUnlessLocal();
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeSession(s), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30d, matching the workos refresh-token TTL
  });
}

/** Clear the session cookie (only valid in a Server Action or Route Handler). */
export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
