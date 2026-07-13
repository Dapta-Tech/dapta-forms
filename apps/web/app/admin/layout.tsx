import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getMessages } from '@slate/shared';
import { adminApi, ApiError } from '@/lib/admin-api';
import { AdminShell } from '@/components/admin-shell';
import { ToastProvider } from '@/components/toast';
import { getLocale } from '@/lib/locale';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();

  // The real auth gate (AUTH-WEB-CONTRACT §4): identity is whatever `/v1/me`
  // resolves. A 401 (no/invalid session — e.g. after logout in AUTH_LOCAL_STRICT
  // mode, or an expired token) → /login. This is the global guard that makes
  // logout real; a non-401 error (API down) surfaces to the error boundary.
  let me: Awaited<ReturnType<typeof adminApi.me>>;
  try {
    me = await adminApi.me();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/login');
    throw e;
  }

  // Server-read the collapse pref so the sidebar renders at the right width on
  // first paint (no rail FOUC).
  const initialCollapsed = jar.get('slate.nav.collapsed')?.value === '1';
  const messages = getMessages(await getLocale()).admin;

  return (
    <ToastProvider>
      <AdminShell
        initialCollapsed={initialCollapsed}
        messages={messages}
        user={{ displayName: me.displayName, handle: me.handle, accountCode: me.accountCode }}
      >
        {children}
      </AdminShell>
    </ToastProvider>
  );
}
