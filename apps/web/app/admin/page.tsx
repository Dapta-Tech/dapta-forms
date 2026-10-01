import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatDate, getMessages, t } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { greetingName } from '@/lib/person';
import { publishedPublicPagePath } from '@/lib/public-page';
import { CopyLink } from '@/components/copy-link';
import { CreateForm } from './forms/create-form';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const locale = await getLocale();
  const messages = getMessages(locale).admin;
  const h = messages.home;
  const [me, forms, myProfile] = await Promise.all([
    adminApi.me(),
    adminApi.listForms(),
    // Missing or unreadable profile reads as "not published": the box hides.
    adminApi.myProfile().catch(() => null),
  ]);

  // Aggregate submissions + completion across every form (reuse per-form
  // analytics — no new endpoint). Weighted completion = Σsubmissions / Σstarts.
  const analytics = await Promise.all(
    forms.map((f) => adminApi.getAnalytics(f.id).catch(() => null)),
  );
  const totalSubmissions = analytics.reduce((n, a) => n + (a?.submissions ?? 0), 0);
  const totalStarts = analytics.reduce((n, a) => n + (a?.starts ?? 0), 0);
  // Clamped for the same reason the per-form rate is (analytics.service.ts):
  // submissions and starts are windowed by different timestamps, so a session
  // that starts before a window and completes inside it can push the raw ratio
  // past 1. This surface computes its own rate, so it needs its own cap.
  const completionRate =
    totalStarts > 0 ? Math.min(100, Math.round((totalSubmissions / totalStarts) * 1000) / 10) : 0;

  // The dashboard's shareable link is the member's PUBLIC PAGE (the form list at
  // /{accountCode}/{handle}), and only while it is published in Account
  // settings. It used to point at the most recently updated form, which is not
  // what "your public link" means and could be a draft. Off or no handle: the
  // box hides rather than pointing at a 404.
  const publicUrl = publishedPublicPagePath(me, myProfile?.profile);

  // Null when `displayName` is really the address — the full one for local signup,
  // the local part for an invite. The email has to be passed to catch the second
  // case (see `person.ts`). The un-named greeting is the correct fallback.
  const firstName = greetingName(me.displayName, me.email);
  const createLabels = {
    create: messages.forms.create,
    createTitle: messages.forms.createTitle,
    nameLabel: messages.forms.nameLabel,
    namePlaceholder: messages.forms.namePlaceholder,
    nameRequired: messages.forms.nameRequired,
    cancel: messages.forms.cancel,
    layoutLabel: messages.forms.layoutLabel,
    layoutSlides: messages.forms.layoutSlides,
    layoutSlidesDesc: messages.forms.layoutSlidesDesc,
    layoutVertical: messages.forms.layoutVertical,
    layoutVerticalDesc: messages.forms.layoutVerticalDesc,
  };

  // The list beside the figures: the forms worked on most recently, each with
  // the two numbers the stat row totals. Same per-form analytics, no new call.
  const recent = forms
    .map((f, i) => ({ form: f, analytics: analytics[i] ?? null }))
    .sort((a, b) => b.form.updatedAt - a.form.updatedAt)
    .slice(0, RECENT_LIMIT);
  const picker = messages.picker;
  const zone = me.timezone ?? 'UTC';

  return (
    <div className="mx-auto max-w-[1520px] px-6 py-10 sm:px-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        {/* Two lines at ONE size: the greeting in ink, what the page is in grey.
            The grey line is the subtitle, promoted, so the page opens with a
            statement instead of a title and a caption. */}
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">
            {firstName ? t(h.welcomeNamed, { name: firstName }) : h.welcome}
          </h1>
          <p className="text-3xl font-bold tracking-tight text-faint">{h.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {publicUrl ? (
            <div
              data-testid="home-public-page"
              title={h.publicLink}
              className="flex h-10 min-w-0 max-w-full items-center rounded-full border border-border bg-sidebar pl-4 pr-3"
            >
              <CopyLink path={publicUrl} labels={{ copy: h.copy, copied: h.copied, open: h.open }} />
            </div>
          ) : null}
          <CreateForm labels={createLabels} />
        </div>
      </div>

      {/* One bordered band, three cells: the figures read as a row of one object
          rather than three separate cards competing for the eye. */}
      <div className="mb-10 grid grid-cols-1 divide-y divide-border overflow-hidden rounded-2xl border border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat label={h.statForms} value={String(forms.length)} href="/admin/forms" />
        <Stat label={h.statSubmissions} value={String(totalSubmissions)} href="/admin/submissions" />
        <Stat
          label={h.statCompletion}
          value={`${completionRate}%`}
          note={h.statCompletionNote}
          href="/admin/analytics"
        />
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(300px,420px)]">
        <section aria-labelledby="home-recent" className="min-w-0">
          <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
            <h2 id="home-recent" className={EYEBROW}>
              {h.recent}
            </h2>
            <Link href="/admin/forms" className="text-sm font-medium text-foreground hover:underline">
              {h.viewAll}
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="py-10 text-sm text-muted-foreground">{messages.forms.emptyBody}</p>
          ) : (
            <ul>
              {recent.map(({ form, analytics: a }) => {
                const submissions = a?.submissions ?? 0;
                const rate = a?.completionRate ?? null;
                return (
                  <li key={form.id} data-testid="home-recent-row">
                    <Link
                      href={`/admin/forms/${form.id}/edit`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 border-b border-border py-4 transition-colors hover:bg-sidebar sm:grid-cols-[minmax(0,1fr)_9rem_8rem_7rem] sm:px-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">{form.name}</span>
                        <span className="block truncate text-xs text-faint">/{form.slug}</span>
                      </span>
                      <span
                        className={
                          submissions > 0
                            ? 'text-sm tabular-nums text-foreground'
                            : 'text-sm text-faint'
                        }
                      >
                        {submissions > 0 ? t(picker.submissionsCount, { n: submissions }) : h.noSubmissions}
                      </span>
                      <span className="hidden items-center gap-2 sm:flex">
                        {rate == null ? null : (
                          <>
                            <span className="w-10 text-sm tabular-nums text-foreground">
                              {t(picker.completionValue, { n: Math.round(rate) })}
                            </span>
                            {/* The one saturated mark on the row: progress, in the
                                signal. A track under it so 0% still reads as a bar. */}
                            <span aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                              <span className="block h-full rounded-full bg-signal-edge" style={{ width: `${rate}%` }} />
                            </span>
                          </>
                        )}
                      </span>
                      <span className="hidden text-right text-xs text-faint sm:block">
                        {formatDate(form.updatedAt, { locale, timeZone: zone })}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="home-shortcuts">
          <h2 id="home-shortcuts" className={`${EYEBROW} pb-3`}>
            {h.shortcuts}
          </h2>
          <div className="flex flex-col gap-3">
            <Shortcut href="/admin/account/brand-kit" icon="pi-palette" title={h.branding} desc={h.brandingDesc} />
            <Shortcut href="/admin/integrations" icon="pi-link" title={h.integrations} desc={h.integrationsDesc} />
            <Shortcut href="/admin/analytics" icon="pi-chart-bar" title={h.analytics} desc={h.analyticsDesc} />
            <Shortcut href="/admin/account/public-page" icon="pi-globe" title={h.publicLink} desc={h.publicPageDesc} />
          </div>
        </section>
      </div>
    </div>
  );
}

/** How many forms the recent list shows before "View all" takes over. */
const RECENT_LIMIT = 6;

/** A section label: small, tracked, quiet. Sans, like every label in the app. */
const EYEBROW = 'text-xs font-medium uppercase tracking-wider text-faint';

function Stat({
  label,
  value,
  note,
  href,
}: {
  label: string;
  value: string;
  /** What the figure is a share of, set beside it in the quiet voice. */
  note?: string;
  href: string;
}): ReactNode {
  return (
    <Link href={href} className="flex flex-col gap-2 bg-card p-6 transition-colors hover:bg-sidebar">
      <span className={EYEBROW}>{label}</span>
      {/* Set in the SANS, not the mono: a headline figure is something you glance
          at, and a monospaced one reads as a code sample. `tabular-nums` is what
          actually stops the number jittering as it updates. */}
      <span className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tracking-tight tabular-nums">{value}</span>
        {note ? <span className="text-sm text-muted-foreground">{note}</span> : null}
      </span>
    </Link>
  );
}

function Shortcut({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: string;
  title: string;
  desc: string;
}): ReactNode {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-xl border border-border bg-sidebar p-4 transition-colors hover:border-input"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground">
        <i aria-hidden className={`pi ${icon}`} style={{ fontSize: 16 }} />
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{desc}</span>
      </span>
    </Link>
  );
}
