'use server';

import { redirect } from 'next/navigation';
import { setSession, clearSession, getSession, authProvider, revokeUpstreamSession } from '@/lib/auth-session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Local dev login (AUTH_PROVIDER=local): establish a session that carries the
 * email. `admin-api.ts` sends it as `x-quill-email`; the API's local stub
 * resolves (or JIT-creates) that member's own account. Returns a field error
 * instead of throwing so the form can show it.
 */
export async function signInAction(
  _prev: { error?: string } | null,
  form: FormData,
): Promise<{ error?: string }> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: 'invalid' };
  await setSession({ provider: 'local', email });
  redirect('/admin');
}

/**
 * Logout (AUTH-WEB-CONTRACT §2/§3.5) — Orbit-parity contract: read the session,
 * clear the cookie, tell the IAM to revoke upstream (best-effort, see
 * `revokeUpstreamSession`), and land on /login?signedout=1. The order matters:
 * the session must be READ before `clearSession()` lands its Set-Cookie, or the
 * revoke has no session id — that gap once left the upstream WorkOS session
 * alive and "sign in" silently re-authenticated the same person into /admin.
 *
 * Inline rather than via /api/auth/logout: an action `redirect()` into a route
 * handler soft-navigates, leaving the URL bar stranded on /api/auth/logout
 * while the login page renders. The browser never visits WorkOS
 * (skipIdpRedirect = true in Orbit's terms) — /login?signedout=1 is the landing,
 * and its param is what suppresses the login page's auto-redirect.
 */
export async function signOutAction(): Promise<void> {
  const session = await getSession();
  await clearSession();
  await revokeUpstreamSession(session);
  // Keyed on the configured provider, not the (possibly already-null) session:
  // in workos mode a bare /login auto-redirects straight back into the IAM.
  redirect(authProvider() === 'workos' ? '/login?signedout=1' : '/login');
}
