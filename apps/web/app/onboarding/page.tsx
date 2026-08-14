import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getMessages } from '@quill/shared';
import { adminApi, ApiError } from '@/lib/admin-api';
import { PH_ID_COOKIE, sanitizeLandingDistinctId } from '@/lib/attribution';
import { preferredLocale } from '@/lib/locale';
import { currentOnboardingCohort } from '@/lib/dapta-onboarding';
import { resolveProductAnalytics } from '@/lib/product-analytics';
import { ProductAnalytics } from '@/components/analytics/product-analytics';
import { PlatformGtm, resolvePlatformGtmId } from '@/components/analytics/platform-gtm';
import { OnboardingWizard } from './wizard';

/**
 * The first-run wizard.
 *
 * Lives OUTSIDE `/admin` on purpose. The admin layout redirects here when the
 * API says onboarding is owed, so a route nested under it would re-enter that
 * layout, be redirected again, and loop forever. It also wants none of the admin
 * chrome — no sidebar to wander into before a first form exists.
 *
 * The guard runs in both directions: the layout sends people here, and this page
 * sends them back the moment the API says the wizard is done. That second half
 * is what makes the URL safe to hit directly, on a bookmark or a back button,
 * without re-running an onboarding that already happened.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  let me: Awaited<ReturnType<typeof adminApi.me>>;
  try {
    me = await adminApi.me();
  } catch (e) {
    // `req` already redirects to /login on a 401; anything else is a real
    // outage and belongs on the error boundary rather than silently swallowed.
    if (e instanceof ApiError && e.status === 401) redirect('/login');
    throw e;
  }

  if (!me.onboardingRequired) redirect('/admin');

  // The wizard mirrors its screen into `?step=N` as it moves, but the answers
  // live only in client state — a reload or deep link restarts at question one
  // regardless, so honoring a stale `?step=5` here would only make the URL lie
  // to analytics. Normalize to the bare path; the wizard re-stamps `?step=1`
  // itself. AFTER the gates above, so a stale step URL from someone already
  // onboarded still exits to /admin in one hop. No loop: the target carries no
  // `step`.
  const { step } = await searchParams;
  if (step !== undefined) redirect('/onboarding');

  // Their browser's language, not the cookie's default — nobody arriving here
  // has ever seen the switcher.
  const locale = await preferredLocale();
  const messages = getMessages(locale).admin.onboarding;

  // Which questions this person gets. Resolved HERE, before the first paint,
  // because it decides the FIRST screen — a client-side probe would render the
  // cold wizard and then yank three screens out from under someone who came
  // from Dapta. Bounded and failure-tolerant by construction: see
  // `resolveOnboardingCohort`, which answers "dapta" (the shorter path) for any
  // failure rather than asking a Dapta customer what Dapta already knows.
  const cohort = await currentOnboardingCohort();

  return (
    <>
      {/* The only surface that passes `signupAccountId`: this page renders once
          per brand-new workspace, and its first paint is the conversion the ad
          platforms are optimizing for. The tags come from `account.attribution`
          — written by the callback moments ago, before this page ever ran. */}
      <PlatformGtm
        gtmId={resolvePlatformGtmId()}
        attribution={me.attribution}
        signupAccountId={me.accountId}
      />
      <ProductAnalytics
        analytics={resolveProductAnalytics()}
        identity={{
          email: me.email,
          memberId: me.memberId,
          accountId: me.accountId,
          accountCode: me.accountCode,
          role: me.role,
          attribution: me.attribution,
          // This is the page that usually spends the ph_id cookie: a fresh
          // signup lands HERE, not on the dashboard. Wired in both places
          // because which one renders first is the API's `onboardingRequired`
          // decision, not ours.
          landingDistinctId: sanitizeLandingDistinctId(
            (await cookies()).get(PH_ID_COOKIE)?.value,
          ),
        }}
      />
      <OnboardingWizard messages={messages} locale={locale} cohort={cohort} />
    </>
  );
}
