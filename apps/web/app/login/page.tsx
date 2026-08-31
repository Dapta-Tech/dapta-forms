import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMessages } from '@quill/shared';
import { BrandLockup, PRODUCT_NAME } from '@/components/brand/brand';
import { getLocale } from '@/lib/locale';
import { authProvider } from '@/lib/auth-session';
import { PlatformGtm, resolvePlatformGtmId } from '@/components/analytics/platform-gtm';
import { LoginForm } from './login-form';

export const metadata = { title: `Sign in: ${PRODUCT_NAME}` };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; signedout?: string }>;
}) {
  const m = getMessages(await getLocale()).admin.login;
  const workos = authProvider() === 'workos';
  const { error, signedout } = await searchParams;

  // Dapta builds: no intermediate sign-in card — go straight to the hosted
  // login. The card only renders as an ERROR landing (?error=) so a failed
  // callback doesn't loop root -> /api/auth/login -> /login -> ...
  if (workos && !error && !signedout) redirect('/api/auth/login');

  return (
    <>
      {/* No tags to hand the container here, and that is not an oversight. On a
          Dapta build this page only renders as an ERROR landing or after a
          sign-out (the redirect above takes every other visit straight to the
          hosted login), so it is not a step of the acquisition funnel. The tags
          exist at this point — parked in the httpOnly attribution cookie — but
          publishing a campaign on a failed login would file the same click under
          two different pages. */}
      <PlatformGtm gtmId={resolvePlatformGtmId()} />
      <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
        {/* Sign-in is an entrance, so it gets the full company lockup at display
            size. Width-capped as well as height-capped: at ~6:1 a fixed height
            alone would push past the 24px gutters on a 320px screen. */}
        <BrandLockup className="h-11 w-auto max-w-[min(400px,86vw)] text-foreground" labelled />

        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6">
          <h1 className="mb-1 text-xl font-semibold">{m.title}</h1>
          <p className="mb-6 text-sm text-muted-foreground">{workos ? m.workosSubtitle : m.subtitle}</p>
          {/* A failed WorkOS login/callback comes back with ?error= — surface it
              with a retry CTA instead of a silent plain sign-in screen (R22). */}
          {error ? (
            <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {m.error}
            </p>
          ) : null}
          {workos ? (
            // WorkOS provider: hand off to IAM's hosted login (Google/Microsoft/
            // LinkedIn are rendered by WorkOS — nothing per-provider to build).
            // prompt=login: this button only renders on the signed-out and
            // error landings, where a silent re-authentication into the same
            // account is exactly what the person is trying to escape; the
            // hosted login must actually ask. The bare /login auto-redirect
            // above stays promptless (silent SSO from the Dapta platform).
            <Link
              href="/api/auth/login?prompt=login"
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              {m.workosCta}
            </Link>
          ) : (
            <LoginForm messages={m} />
          )}
        </div>

        {!workos ? <p className="max-w-sm text-center text-xs text-muted-foreground">{m.footnote}</p> : null}
      </main>
    </>
  );
}
