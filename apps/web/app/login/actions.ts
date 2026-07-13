'use server';

import { redirect } from 'next/navigation';
import { setSession, clearSession, authProvider } from '@/lib/auth-session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Local dev login (AUTH_PROVIDER=local): establish a session that carries the
 * email. `admin-api.ts` sends it as `x-slate-email`; the API's local stub
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
 * Logout (AUTH-WEB-CONTRACT §2/§3.5). Clearing the cookie is what makes logout
 * real in AUTH_LOCAL_STRICT mode (the next /v1/me is a 401 → /login). For workos
 * a cookie-only clear leaves the WorkOS session alive, so we must also redirect
 * through the IAM/WorkOS logout — handled by /api/auth/logout (scaffolded).
 */
export async function signOutAction(): Promise<void> {
  await clearSession();
  if (authProvider() === 'workos') redirect('/api/auth/logout');
  redirect('/login');
}
