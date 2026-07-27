import Link from 'next/link';
import type { ReactNode } from 'react';
import { getMessages, t } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { CopyLink } from '@/components/copy-link';
import { CreateForm } from './forms/create-form';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const locale = await getLocale();
  const messages = getMessages(locale).admin;
  const h = messages.home;
  const [me, forms] = await Promise.all([adminApi.me(), adminApi.listForms()]);

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

  // The dashboard's shareable link points at the most recently updated form.
  const latest = [...forms].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const publicUrl = latest ? `/${me.accountCode}/${me.handle ?? 'me'}/${latest.slug}` : null;
  const brandingHref = latest ? `/admin/forms/${latest.id}/edit` : '/admin/forms';

  const firstName = me.displayName?.split(' ')[0];
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

  return (
    <div className="mx-auto max-w-[1520px] px-6 py-10 sm:px-8">
      <h1 className="mb-1 text-3xl font-semibold tracking-tight">
        {firstName ? t(h.welcomeNamed, { name: firstName }) : h.welcome}
      </h1>
      <p className="mb-8 text-muted-foreground">{h.subtitle}</p>

      {publicUrl ? (
        <div className="mb-8 flex flex-col gap-2 rounded-md border border-border bg-card p-5">
          <span className="text-sm text-muted-foreground">{h.publicLink}</span>
          <CopyLink path={publicUrl} labels={{ copy: h.copy, copied: h.copied, open: h.open }} />
        </div>
      ) : null}

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label={h.statForms} value={String(forms.length)} href="/admin/forms" />
        <Stat label={h.statSubmissions} value={String(totalSubmissions)} href="/admin/submissions" />
        <Stat label={h.statCompletion} value={`${completionRate}%`} href="/admin/analytics" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CreateForm labels={createLabels} variant="card" cardTitle={h.createForm} cardDesc={h.createFormDesc} />
        <Shortcut href={brandingHref} icon="pi-palette" title={h.branding} desc={h.brandingDesc} />
        <Shortcut href="/admin/integrations" icon="pi-link" title={h.integrations} desc={h.integrationsDesc} />
        <Shortcut href="/admin/analytics" icon="pi-chart-bar" title={h.analytics} desc={h.analyticsDesc} />
      </div>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href: string }): ReactNode {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-md border border-border bg-card p-5 transition-transform hover:border-primary active:scale-[0.99]"
    >
      <span className="text-3xl font-semibold tracking-tight">{value}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
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
      className="flex flex-col gap-1 rounded-md border border-border bg-card p-5 transition-transform hover:border-primary active:scale-[0.99]"
    >
      <span className="mb-1 flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground">
        <i aria-hidden className={`pi ${icon}`} style={{ fontSize: 14 }} />
      </span>
      <span className="font-medium">{title}</span>
      <span className="text-sm text-muted-foreground">{desc}</span>
    </Link>
  );
}
