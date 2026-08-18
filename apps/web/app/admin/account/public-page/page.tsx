import Link from 'next/link';
import type { ReactNode } from 'react';
import { getMessages } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { PublicPageSettings } from './public-page';

export const dynamic = 'force-dynamic';

/**
 * Account settings → Public page: the member's own `/[accountCode]/[handle]`
 * page (switch + headline + bio) and, below it, the read-only identity fields
 * that page is built from. Every member edits their OWN page, so nothing here
 * is admin-gated.
 */
export default async function PublicPagePage() {
  const locale = await getLocale();
  const messages = getMessages(locale).admin;
  const s = messages.settings;
  const a = messages.account;

  const me = await adminApi.me();
  const myProfile = await adminApi.myProfile().catch(() => null);
  const publicPath = me.handle ? `/${me.accountCode}/${me.handle}` : null;

  return (
    <div data-testid="account-public-page">
      <PublicPageSettings publicPath={publicPath} initial={myProfile?.profile ?? null} m={s} />

      <section
        data-testid="account-profile"
        className="rounded-xl border border-border bg-card p-6"
      >
        <h2 className="text-lg font-semibold tracking-tight">{a.profileHeading}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{a.profileSubtitle}</p>
        <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label={s.displayName} value={me.displayName ?? s.vanityNone} />
          <Field label={s.email} value={me.email ?? s.vanityNone} />
          <Field label={s.handle} value={me.handle ?? s.vanityNone} mono />
          <Field label={s.accountCode} value={me.accountCode} mono />
          <Field label={s.vanity} value={me.vanitySlug ?? s.vanityNone} mono />
        </dl>
        {publicPath ? (
          <div className="mt-6 border-t border-border pt-5">
            <span className="text-sm text-muted-foreground">{s.publicPage}</span>
            <Link
              href={publicPath}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="account-view-public"
              className="mt-1 flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <i aria-hidden className="pi pi-external-link" style={{ fontSize: 12 }} />
              {s.viewPublic}
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-2xs uppercase tracking-wide text-faint">{label}</dt>
      <dd className={`truncate text-sm text-foreground ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </dd>
    </div>
  );
}
