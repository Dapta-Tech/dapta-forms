import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminApi, ApiError } from '@/lib/admin-api';
import { ToastProvider } from '@/components/toast';

// Customer-facing name (build-time inlined); the codename never surfaces in the UI.
const productName = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Forms';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // The real auth gate: identity is whatever `/v1/me` resolves. A 401 → /login.
  let me: Awaited<ReturnType<typeof adminApi.me>>;
  try {
    me = await adminApi.me();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/login');
    throw e;
  }

  return (
    <ToastProvider>
      <div className="min-h-dvh">
        <header className="flex items-center justify-between border-b border-border px-6 py-3">
          <Link href="/admin" className="flex items-center gap-2 font-semibold">
            <span className="rounded-md bg-primary px-2 py-0.5 text-sm text-primary-foreground">
              {productName}
            </span>
          </Link>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>{me.displayName ?? me.email ?? me.handle}</span>
            <a href="/api/auth/logout" className="hover:text-foreground">
              Sign out
            </a>
          </div>
        </header>
        {children}
      </div>
    </ToastProvider>
  );
}
