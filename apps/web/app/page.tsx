import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { parseAttribution } from '@quill/types';
import { BrandLockup } from '@/components/brand/brand';
import { authProvider, getSession } from '@/lib/auth-session';

/**
 * Carry the acquisition tags into the login hand-off.
 *
 * `redirect()` drops the query string, and the identity round-trip leaves our
 * origin entirely — so tags not forwarded HERE are gone for good. This is the
 * only surface the campaign link actually lands on.
 *
 * Only allowlisted keys travel: forwarding the raw query would let a crafted
 * link smuggle arbitrary params into the login route.
 */
async function loginHandoff(params: Record<string, string | string[] | undefined>): Promise<string> {
  const h = await headers();
  const referer = h.get('referer');
  let referrer: string | undefined;
  if (referer) {
    // Drop a SAME-ORIGIN referer. `attribution` is written once and never again,
    // so storing "came from our own page" would spend first touch on a value that
    // says nothing, and the real campaign could never be recorded afterwards.
    try {
      referrer = new URL(referer).host === h.get('host') ? undefined : referer;
    } catch {
      referrer = undefined;
    }
  }
  // `landing_path` is deliberately NOT set here: it would be '/' on every visit,
  // which would make the parse non-empty for a plain bookmark hit and burn the
  // claim. It is for surfaces where the path itself carries information.
  const attribution = parseAttribution({ ...params, referrer });
  if (!attribution) return '/api/auth/login';
  return `/api/auth/login?${new URLSearchParams(Object.entries(attribution)).toString()}`;
}

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
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (authProvider() === 'workos') {
    const session = await getSession();
    if (session) redirect('/admin');
    redirect(await loginHandoff(await searchParams));
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <div className="flex flex-col items-center gap-3">
        <BrandLockup className="h-12 w-auto max-w-[min(440px,86vw)] text-foreground" labelled />
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
