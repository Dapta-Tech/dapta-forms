import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getMessages } from '@quill/shared';
import { adminApi, ApiError } from '@/lib/admin-api';
import { AdminShell } from '@/components/admin-shell';
import { getLocale } from '@/lib/locale';
import { getThemePref } from '@/lib/theme.server';
import { ToastProvider } from '@/components/toast';
import { PH_ID_COOKIE, sanitizeLandingDistinctId } from '@/lib/attribution';
import { resolveProductAnalytics } from '@/lib/product-analytics';
import { ProductAnalytics } from '@/components/analytics/product-analytics';
import { PlatformGtm, resolvePlatformGtmId } from '@/components/analytics/platform-gtm';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();

  // The real auth gate: identity is whatever `/v1/me` resolves. A 401 (no/invalid
  // session — e.g. after logout, or an expired token) → /login. A non-401 error
  // (API down) surfaces to the error boundary.
  let me: Awaited<ReturnType<typeof adminApi.me>>;
  try {
    me = await adminApi.me();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/login');
    throw e;
  }

  // The first-run gate. The API decides — `onboardingRequired` already folds in
  // the feature flag — so the dashboard never carries a second copy of the
  // switch that could disagree with it.
  //
  // The wizard lives at `/onboarding`, NOT under `/admin`, and that is what
  // keeps this from looping: a child of this route would re-enter this layout,
  // be redirected again, and the person would never reach a page. It also wants
  // none of the chrome below — no sidebar to wander off into before the first
  // form exists.
  if (me.onboardingRequired) redirect('/onboarding');

  // Server-read the collapse pref so the sidebar renders at the right width on
  // first paint (no rail FOUC).
  const initialCollapsed = jar.get('forms.nav.collapsed')?.value === '1';
  const chrome = getMessages(await getLocale()).admin.chrome;

  // Best-effort: a failure here must never take down the dashboard. Without the
  // list the switcher simply does not render, which is exactly how it behaves
  // for the single-workspace majority anyway.
  const workspaces = await adminApi.listWorkspaces().catch(() => []);

  // Product analytics is scoped to the dashboard on purpose — mounting it here
  // (never in the root layout) is what keeps it off public form pages, where
  // the visitor is a form owner's respondent and not a user of this product.
  const analytics = resolveProductAnalytics();

  return (
    <ToastProvider>
      {/* Same tags GTM gets on the wizard, minus the signup event: this layout
          wraps every dashboard page, so the campaign is available to any tag
          the container fires later — but the account here is of any age. */}
      <PlatformGtm gtmId={resolvePlatformGtmId()} attribution={me.attribution} />
      <ProductAnalytics
        analytics={analytics}
        identity={{
          email: me.email,
          memberId: me.memberId,
          accountId: me.accountId,
          accountCode: me.accountCode,
          role: me.role,
          // The campaign tags belong on the `forms_account` GROUP, and this is
          // where nearly every product event is emitted from — the wizard is a
          // handful of screens, the dashboard is the rest of the product.
          // Passing them only on the wizard would leave every funnel that starts
          // after onboarding un-sliceable by campaign, which is most of them.
          attribution: me.attribution,
          // The landing's PostHog id, if this login started on a landing CTA.
          // Re-sanitized on read — the cookie is ours, but the ten minutes
          // between write and read are not a chain of custody.
          landingDistinctId: sanitizeLandingDistinctId(jar.get(PH_ID_COOKIE)?.value),
        }}
      />
      <AdminShell
        initialCollapsed={initialCollapsed}
        themePref={await getThemePref()}
        messages={chrome}
        workspaces={workspaces}
        currentAccountId={me.accountId}
        user={{ displayName: me.displayName, handle: me.handle, accountCode: me.accountCode }}
      >
        {children}
      </AdminShell>
    </ToastProvider>
  );
}
