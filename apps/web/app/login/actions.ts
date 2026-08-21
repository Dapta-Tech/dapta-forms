'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import {
  setSession,
  clearSession,
  getSession,
  authProvider,
  revokeUpstreamSession,
  idpLogoutTarget,
} from '@/lib/auth-session';
import { originFrom } from '@/lib/request-origin';

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
 * Logout (AUTH-WEB-CONTRACT §2/§3.5): read the session, clear the cookie, tell
 * the IAM to revoke upstream, then FOLLOW the returned IdP logout URL (Orbit's
 * skipIdpRedirect = false case, "logout completo"). The browser hop through
 * WorkOS is not optional for the sign-out button: the AuthKit session cookie
 * lives on WorkOS's domain, and with the shared Dapta session still alive the
 * next "sign in" silently re-authenticates the same person back into /admin,
 * with no way to switch accounts. WorkOS sends the browser back to
 * /login?signedout=1 via return_to (the URL must stay allowlisted under
 * "Logout redirect URIs" in the WorkOS dashboard).
 *
 * The order matters: the session must be READ before `clearSession()` lands its
 * Set-Cookie, or the revoke has no session id. That gap once left the upstream
 * WorkOS session alive (the pre-#82 bug). Local cleanup always runs, whatever
 * the IAM call does; when no logout URL comes back (IAM down, unparseable URL,
 * no session id) the person still lands signed out on /login?signedout=1, whose
 * param suppresses the login page's auto-redirect.
 */
export async function signOutAction(): Promise<void> {
  const session = await getSession();
  await clearSession();
  const logoutUrl = await revokeUpstreamSession(session);
  const hdrs = await headers();
  const origin = originFrom((n) => hdrs.get(n));
  const idp = origin ? idpLogoutTarget(logoutUrl, origin) : null;
  if (idp) redirect(idp);
  // Keyed on the configured provider, not the (possibly already-null) session:
  // in workos mode a bare /login auto-redirects straight back into the IAM.
  redirect(authProvider() === 'workos' ? '/login?signedout=1' : '/login');
}
