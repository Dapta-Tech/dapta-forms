'use server';

import { redirect } from 'next/navigation';
import {
  setSession,
  clearSession,
  getSession,
  authProvider,
  revokeUpstreamSession,
} from '@/lib/auth-session';

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
 * Logout (AUTH-WEB-CONTRACT §2/§3.5), Orbit's contract exactly: read the
 * session, clear the cookie, tell the IAM to revoke upstream, land on our own
 * /login. The browser never visits WorkOS (Orbit's skipIdpRedirect = true,
 * `logout({ skipWorkOSRedirect: true })` in its auth.service) so nothing here
 * depends on the WorkOS dashboard's logout-redirect allowlist. The accepted
 * consequence, same as the Dapta platform app: the AuthKit cookie on WorkOS's domain
 * stays alive, so the next "sign in" re-authenticates the same person without
 * prompting. The IdP logout URL the IAM returns is used only by a future
 * switch-account flow (`idpLogoutTarget`).
 *
 * The order matters: the session must be READ before `clearSession()` lands its
 * Set-Cookie, or the revoke has no session id. That gap once left the upstream
 * session alive (the pre-#82 bug). Local cleanup always runs, whatever the IAM
 * call does; /login?signedout=1's param suppresses the login page's
 * auto-redirect back into the IAM.
 */
export async function signOutAction(): Promise<void> {
  const session = await getSession();
  await clearSession();
  await revokeUpstreamSession(session);
  // Keyed on the configured provider, not the (possibly already-null) session:
  // in workos mode a bare /login auto-redirects straight back into the IAM.
  redirect(authProvider() === 'workos' ? '/login?signedout=1' : '/login');
}
