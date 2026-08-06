import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getMessages } from '@quill/shared';
import { adminApi, ApiError } from '@/lib/admin-api';
import { AdminShell } from '@/components/admin-shell';
import { getLocale } from '@/lib/locale';
import { ToastProvider } from '@/components/toast';
import { resolveProductAnalytics } from '@/lib/product-analytics';
import { ProductAnalytics } from '@/components/analytics/product-analytics';

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
      <ProductAnalytics
        analytics={analytics}
        identity={{
          email: me.email,
          memberId: me.memberId,
          accountId: me.accountId,
          accountCode: me.accountCode,
          role: me.role,
        }}
      />
      <AdminShell
        initialCollapsed={initialCollapsed}
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
