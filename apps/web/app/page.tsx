import Link from 'next/link';
import { redirect } from 'next/navigation';
import { authProvider, getSession } from '@/lib/auth-session';

// Customer-facing name (build-time inlined); "Quill" never surfaces in the UI.
const productName = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Forms';

// Per-request render: the workos-vs-local branch reads RUNTIME env + cookies.
// Without this, next build (no AUTH_PROVIDER in the builder) bakes the OSS
// landing statically and production serves it to anonymous users.
export const dynamic = 'force-dynamic';

/**
 * Root behavior depends on the deployment flavor:
 *  - workos (Dapta production): the root is an APP entry, never a marketing
 *    page — logged-in users land on /admin, anonymous users go STRAIGHT to the
 *    hosted login (no intermediate sign-in card).
 *  - local/OSS fork: keep the clone-and-run landing with the demo form.
 */
export default async function HomePage() {
  if (authProvider() === 'workos') {
    const session = await getSession();
    redirect(session ? '/admin' : '/api/auth/login');
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="rounded-md bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground">
          {productName}
        </span>
        <h1 className="text-4xl font-semibold tracking-tight">Open-source forms</h1>
        <p className="max-w-md text-muted-foreground">
          A clone-and-run forms platform. SQLite by default, deploy anywhere. This dev instance is
          seeded with a demo form.
        </p>
      </div>

      <Link
        href="/acme/alex-rivera/lead-qualifier"
        className="rounded-md bg-primary px-5 py-3 font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
      >
        Open the demo form →
      </Link>

      <p className="text-sm text-muted-foreground">
        Try <code className="rounded-sm bg-muted px-1.5 py-0.5">/acme/alex-rivera/lead-qualifier</code>
      </p>
    </main>
  );
}
