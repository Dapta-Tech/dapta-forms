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
 * browser visits this URL. Per Orbit's contract NO current caller follows it
 * (skipIdpRedirect = true everywhere: sign-out stays inside Forms and the
 * shared Dapta session deliberately survives, same as the Dapta platform app). The URL
 * is returned for the one flow that would need Orbit's skipIdpRedirect =
 * false mode, a future switch-account (`idpLogoutTarget` shapes it).
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
 * The WorkOS session id, read from the IAM access token's claims.
 *
 * The callback's `?session=` blob carries `session_id` = the IAM's OWN session
 * row id (a UUID), and no `workos_session_id` field at all: the only place the
 * IAM puts the real WorkOS id (`session_01...`) is inside the JWT it mints
 * (`create-unified-session` adds the claim for the workos provider). Orbit
 * reads it from exactly this claim. Sending the IAM's UUID to WorkOS's logout
 * endpoint is a silent no-op: WorkOS answers 200 with an empty body for an id
 * it cannot resolve, so the browser strands on a blank api.workos.com page and
 * the AuthKit cookie survives, silently re-authenticating the next sign-in.
 *
 * Decoded WITHOUT verifying the signature, deliberately: this runs in the
 * callback on a token the IAM just handed over a state-checked redirect, the
 * API re-verifies the token (HS256) on every request that uses it, and the web
 * holds no JWT secret to verify with. A malformed token yields null, never a
 * throw.
 */
export function workosSessionIdFromJwt(accessToken: string): string | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      workos_session_id?: unknown;
    };
    const id = claims?.workos_session_id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * The IdP logout redirect for Orbit's skipIdpRedirect = false mode (a full
 * logout that also ends the shared Dapta session, e.g. a future
 * switch-account): the IAM's logout URL with return_to pointing back at our
 * login landing. UNUSED by the sign-out button and the logout route on
 * purpose: per Orbit's contract those never send the browser to WorkOS, which
 * is also what keeps them independent of the WorkOS dashboard's
 * "Logout redirect URIs" allowlist (return_to is only honored when
 * allowlisted). Null when the logout URL is absent or unparseable
 * (NextResponse.redirect and the action redirect would both throw on it):
 * callers land locally.
 *
 * Also null when the URL's session_id does not look like a WorkOS session id
 * (`session_...`). The IAM builds the logout URL by echoing whatever id it was
 * sent, without resolving it, and WorkOS answers an unresolvable id with a
 * blank 200: no redirect back, nothing revoked. That is precisely the sessions
 * minted before `workosSessionIdFromJwt` existed (30-day cookies carrying the
 * IAM's UUID), so those land locally instead of on the blank page.
 */
export function idpLogoutTarget(logoutUrl: string | null, origin: string): string | null {
  if (!logoutUrl) return null;
  try {
    const target = new URL(logoutUrl);
    if (!isBrowserNavigable(target)) return null;
    const sessionId = target.searchParams.get('session_id');
    if (sessionId !== null && !sessionId.startsWith('session_')) return null;
    target.searchParams.set('return_to', new URL('/login?signedout=1', origin).toString());
    return target.toString();
  } catch {
    return null;
  }
}

/**
 * Whether a URL is one we are willing to send a browser to.
 *
 * `revokeUpstreamSession` returns the IAM's `logoutUrl` field verbatim, and it
 * goes straight into `NextResponse.redirect` and the action `redirect()`. The
 * IAM is first-party and env-configured, so this is defence in depth rather
 * than a live hole, but an unvalidated redirect target on the auth path is
 * worth closing, and `javascript:` and `data:` are one bad response away.
 *
 * The scheme is all that is checked. The host deliberately is NOT pinned to
 * `IAM_BASE_URL`: the logout URL points at the IdP (`api.workos.com`), not at
 * the IAM, so a strict same-host pin would break sign-out outright. An
 * allowlist would have to name both hosts and be configurable.
 */
function isBrowserNavigable(target: URL): boolean {
  if (target.protocol === 'https:') return true;
  const local = target.hostname === 'localhost' || target.hostname === '127.0.0.1';
  return target.protocol === 'http:' && local;
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
 * Trade the refresh token for a fresh access token (Orbit's refreshToken()
 * flow): POST {IAM}/auth/refresh, a public route like login/logout, no Bearer.
 * The IAM ROTATES the refresh token on every call, so the returned session
 * must always be stored: keeping the old one guarantees the next refresh 401s.
 * The workos_session_id claim is re-read from the new JWT (the IAM re-mints it
 * with the claim intact); the old id is kept as fallback so a logout after a
 * refresh still revokes.
 *
 * Concurrent server actions can race this (no single process to single-flight
 * in, unlike Orbit's in-memory refreshPromise); the IAM's rotation grace
 * window is what makes that safe, with both racers ending on valid tokens.
 *
 * Returns null and never throws on anything short of success: a 401 (refresh
 * expired or revoked), a down IAM, a timeout, a local session, or a session
 * that never carried a refresh token. Callers treat null as "sign in again".
 */
export async function refreshUpstreamSession(session: Session | null): Promise<Session | null> {
  const iam = process.env.IAM_BASE_URL?.replace(/\/$/, '');
  if (!iam || session?.provider !== 'workos' || !session.refreshToken) return null;
  const res = await fetch(`${iam}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const out = (await res.json().catch(() => null)) as {
    access_token?: unknown;
    refresh_token?: unknown;
  } | null;
  if (typeof out?.access_token !== 'string' || !out.access_token) return null;
  return {
    provider: 'workos',
    accessToken: out.access_token,
    refreshToken:
      typeof out.refresh_token === 'string' && out.refresh_token
        ? out.refresh_token
        : session.refreshToken,
    sessionId: workosSessionIdFromJwt(out.access_token) ?? session.sessionId,
  };
}

/**
 * Authenticated host fetch for SERVER ACTIONS (AUTH-WEB-CONTRACT §1 + §4):
 * attaches identity, and on a `401` first tries to refresh the session in
 * place (Orbit's interceptor contract: 401 -> refresh -> retry once) before
 * treating it as a logout. Only when the refresh fails, or the retried
 * request 401s again, does it clear the session and bounce to /login. The
 * thrown redirect must be re-thrown past any action catch (use
 * `unstable_rethrow(e)` first in the catch). Only call from an action/route
 * handler (it may write the cookie).
 */
export async function hostFetch(path: string, init?: RequestInit): Promise<Response> {
  let res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...((init?.headers as Record<string, string>) ?? {}), ...(await hostHeaders()) },
    cache: 'no-store',
  });
  if (res.status === 401) {
    // One refresh attempt, never a loop: a 401 on the RETRIED request means
    // the token the IAM just minted is being rejected, and refreshing again
    // cannot fix that.
    const expired = await getSession();
    const refreshed = await refreshUpstreamSession(expired);
    if (refreshed) {
      await setSession(refreshed);
      res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: { ...((init?.headers as Record<string, string>) ?? {}), ...(await hostHeaders()) },
        cache: 'no-store',
      });
    }
  }
  if (res.status === 401) {
    // Same shape as `signOutAction` (Orbit contract): read the session BEFORE
    // clearing (the revoke needs its id), clear unconditionally, revoke
    // best-effort. Inline rather than via /api/auth/logout, because an action
    // `redirect()` into a route handler strands the URL bar there. And per the
    // contract, a 401 anywhere never re-enters logout: one revoke, then /login.
    // The returned IdP logout URL is deliberately ignored (Orbit's
    // skipIdpRedirect = true, like every logout path): the browser never
    // bounces through WorkOS, so a Forms logout can never end the person's
    // whole Dapta session.
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
