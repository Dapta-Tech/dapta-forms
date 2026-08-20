import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SESSION_COOKIE, WORKSPACE_COOKIE } from './session';
import { signValue, unsignValue } from './signed-value';
import { serverApiUrl } from './api-url';

const API_URL = serverApiUrl;

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
      'WEB_SESSION_SECRET is required unless AUTH_PROVIDER=local. Refusing to issue an unsigned, forgeable session cookie.',
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
 * Best-effort upstream revoke (Orbit contract): POST {IAM}/auth/logout with
 * redirect=false so the IAM revokes the WorkOS session server-side and hands
 * back the IdP logout URL instead of redirecting anyone itself. Deliberately
 * unauthenticated: /auth/logout is a public IAM route (like login/refresh),
 * and sending an expired Bearer is what creates logout -> 401 -> logout loops.
 * Fired even without a session id ({} body): the IAM can still invalidate
 * server-side state.
 *
 * Returns the WorkOS logout URL (the IAM serializes it as logoutUrl or
 * logoutURL) or null. Server-side revocation alone is NOT a browser logout:
 * the AuthKit session cookie lives on WorkOS's domain and only dies when the
 * browser visits this URL. Callers choose per Orbit's skipIdpRedirect switch:
 * the explicit sign-out button follows it (a Forms logout must also end the
 * shared Dapta session, or the next "sign in" silently re-authenticates the
 * same person); the 401 expiry paths ignore it (a Forms token expiring must
 * not log the person out of the whole Dapta platform).
 *
 * Never throws and never hangs past its timeout: the caller's local cleanup
 * must not be hostage to the IAM being up.
 */
export async function revokeUpstreamSession(session: Session | null): Promise<string | null> {
  const iam = process.env.IAM_BASE_URL?.replace(/\/$/, '');
  if (!iam || session?.provider !== 'workos') return null;
  const sessionId = session.sessionId;
  const body = sessionId ? { workos_session_id: sessionId, session_id: sessionId } : {};
  const res = await fetch(`${iam}/auth/logout?redirect=false`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const out = (await res.json().catch(() => null)) as { logoutUrl?: unknown; logoutURL?: unknown } | null;
  const url = out?.logoutUrl ?? out?.logoutURL;
  return typeof url === 'string' && url ? url : null;
}

/**
 * The IdP logout redirect for the sign-out button: the IAM's logout URL with
 * return_to pointing back at our login landing, so WorkOS ends the browser
 * session and sends the person to /login?signedout=1 instead of stranding
 * them on a blank api.workos.com page. The URL must be allowlisted under
 * "Logout redirect URIs" in the WorkOS dashboard or WorkOS ignores it.
 * Null when the logout URL is absent or unparseable (NextResponse.redirect
 * and the action redirect would both throw on it): callers land locally.
 */
export function idpLogoutTarget(logoutUrl: string | null, origin: string): string | null {
  if (!logoutUrl) return null;
  try {
    const target = new URL(logoutUrl);
    target.searchParams.set('return_to', new URL('/login?signedout=1', origin).toString());
    return target.toString();
  } catch {
    return null;
  }
}

/**
 * Identity headers for a raw host `fetch()` that doesn't route through
 * admin-api's `req()` (a few server actions post directly). Same contract as
 * admin-api (§1): Bearer for workos, x-quill-email for local, nothing when
 * logged out (→ the API 401s → the gate redirects).
 */
export async function hostHeaders(): Promise<Record<string, string>> {
  const s = await getSession();
  const h: Record<string, string> = {};
  if (s?.provider === 'workos') h['authorization'] = `Bearer ${s.accessToken}`;
  else if (s?.provider === 'local') h['x-quill-email'] = s.email;
  // The workspace travels ALONGSIDE identity, never instead of it — and it is
  // sent even when there is no session, because the OSS `local` provider
  // resolves a developer who never signed in. It authorizes nothing on its own.
  const workspace = await getWorkspace();
  if (workspace) h['x-quill-workspace'] = workspace;
  return h;
}

// --- The chosen workspace -----------------------------------------------------
//
// Signed with the same secret as the session, but stored separately, because
// the two have different lifetimes: a session may not exist at all (the OSS
// local provider needs no cookie), and hanging the choice off one meant the
// switcher silently did nothing for precisely those users.

/** The account the person chose to act in, or null for their home one. */
export async function getWorkspace(): Promise<string | null> {
  const jar = await cookies();
  return unsignValue(jar.get(WORKSPACE_COOKIE)?.value, secret());
}

/** Record (or clear, with null) the chosen workspace. */
export async function setWorkspace(accountId: string | null): Promise<void> {
  const jar = await cookies();
  if (!accountId) {
    jar.delete(WORKSPACE_COOKIE);
    return;
  }
  jar.set(WORKSPACE_COOKIE, signValue(accountId, secret()), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  });
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
    // Same shape as `signOutAction` (Orbit contract): read the session BEFORE
    // clearing (the revoke needs its id), clear unconditionally, revoke
    // best-effort. Inline rather than via /api/auth/logout, because an action
    // `redirect()` into a route handler strands the URL bar there. And per the
    // contract, a 401 anywhere never re-enters logout: one revoke, then /login.
    // The returned IdP logout URL is deliberately ignored here (Orbit's
    // skipIdpRedirect = true): a Forms token expiring must not bounce the
    // browser through WorkOS and end the person's whole Dapta session. Only
    // the explicit sign-out button does that.
    const session = await getSession();
    await clearSession();
    await revokeUpstreamSession(session);
    redirect(authProvider() === 'workos' ? '/login?signedout=1' : '/login');
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
