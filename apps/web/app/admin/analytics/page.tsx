import Link from 'next/link';
import { getMessages, t } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPicker() {
  const locale = await getLocale();
  const p = getMessages(locale).admin.picker;
  const forms = await adminApi.listForms();
  const analytics = await Promise.all(
    forms.map((f) => adminApi.getAnalytics(f.id).catch(() => null)),
  );

  return (
    <div className="mx-auto max-w-[1520px] px-6 py-10 sm:px-8">
      <PageHeader title={p.analyticsTitle} subtitle={p.analyticsSubtitle} />
      {forms.length === 0 ? (
        <EmptyState title={p.emptyTitle} body={p.emptyBody} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {forms.map((f, i) => (
            <li key={f.id}>
              <Link
                href={`/admin/forms/${f.id}/analytics`}
                className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-5 transition-transform hover:border-primary-edge active:scale-[0.99]"
              >
                <div className="min-w-0">
                  <span className="block truncate font-semibold tracking-tight">{f.name}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {t(p.completionValue, { n: analytics[i]?.completionRate ?? 0 })} {p.completionLabel}
                  </span>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-sm text-primary">
                  {p.viewAnalytics}
                  <i aria-hidden className="pi pi-arrow-right" style={{ fontSize: 12 }} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <i aria-hidden className="pi pi-chart-bar" style={{ fontSize: 20 }} />
      </div>
      <p className="font-medium text-foreground">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
