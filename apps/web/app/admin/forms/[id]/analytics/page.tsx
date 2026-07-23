import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { AnalyticsResponse } from '@quill/types';
import { getMessages, type FormsMessages } from '@quill/shared';
import { adminApi, ApiError } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { FormTabs } from '@/components/ui/form-tabs';
import { Skeleton } from '@/components/skeleton';
import { AnalyticsFilter } from './analytics-filter';

export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;

type SP = { preset?: string; from?: string; to?: string };

/** Resolve the URL query into an epoch-ms range the API understands. */
function resolveRange(sp: SP): { from?: number; to?: number } {
  if (sp.preset === 'custom') {
    const from = sp.from ? Date.parse(`${sp.from}T00:00:00.000Z`) : NaN;
    const to = sp.to ? Date.parse(`${sp.to}T23:59:59.999Z`) : NaN;
    return {
      from: Number.isNaN(from) ? undefined : from,
      to: Number.isNaN(to) ? undefined : to,
    };
  }
  const days = sp.preset === '7' ? 7 : sp.preset === '30' ? 30 : sp.preset === '90' ? 90 : null;
  if (days) return { from: Date.now() - days * DAY_MS };
  return {};
}

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const m = getMessages(await getLocale()).admin;
  const range = resolveRange(sp);
  const rangeKey = `${sp.preset ?? 'all'}:${sp.from ?? ''}:${sp.to ?? ''}`;

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <FormTabs formId={id} active="analytics" labels={m.nav} />
      <div className="mb-6 flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{m.analytics.title}</h1>
          <p className="mt-1 text-muted-foreground">{m.analytics.subtitle}</p>
        </div>
        <AnalyticsFilter
          labels={{
            last7: m.analytics.rangeLast7,
            last30: m.analytics.rangeLast30,
            last90: m.analytics.rangeLast90,
            all: m.analytics.rangeAll,
            custom: m.analytics.rangeCustom,
            from: m.analytics.rangeFrom,
            to: m.analytics.rangeTo,
            apply: m.analytics.rangeApply,
          }}
        />
      </div>

      <Suspense key={rangeKey} fallback={<AnalyticsSkeleton />}>
        <AnalyticsData id={id} range={range} m={m.analytics} />
      </Suspense>
    </div>
  );
}

/** Format seconds as `Ns` or `Nm Ss`. */
function formatDuration(seconds: number, unit: string): string {
  if (seconds < 60) return `${seconds}${unit}`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}${unit}`;
}

async function AnalyticsData({
  id,
  range,
  m,
}: {
  id: string;
  range: { from?: number; to?: number };
  m: FormsMessages['admin']['analytics'];
}) {
  let a: AnalyticsResponse;
  try {
    a = await adminApi.getAnalytics(id, range);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const hasActivity = a.views + a.starts + a.submissions + a.partialSubmits > 0;
  if (!hasActivity) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-12 text-center">
        <p className="text-lg font-medium">{m.emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{m.emptyBody}</p>
      </div>
    );
  }

  const cards = [
    { label: m.metricViews, value: String(a.views) },
    { label: m.metricStarts, value: String(a.starts) },
    { label: m.metricSubmissions, value: String(a.submissions) },
    { label: m.metricCompletionRate, value: `${a.completionRate}%` },
    { label: m.metricAvgTime, value: formatDuration(a.timeToComplete, m.seconds) },
    { label: m.metricPartials, value: String(a.partialSubmits) },
  ];

  const maxViews = Math.max(1, ...a.dropoff.map((r) => r.views));

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="text-lg font-semibold">{m.dropoffTitle}</h2>
        <p className="mb-3 text-sm text-muted-foreground">{m.dropoffSubtitle}</p>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">{m.colStep}</th>
                <th className="w-[45%] px-4 py-3 font-medium">{m.colViews}</th>
                <th className="px-4 py-3 text-right font-medium">{m.colDropoff}</th>
              </tr>
            </thead>
            <tbody>
              {a.dropoff.map((row) => (
                <tr key={row.stepIndex} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3">
                    <span className="font-medium">{row.isCover ? m.coverRow : row.question}</span>
                    {!row.isCover ? (
                      <span className="ml-2 text-xs text-muted-foreground">#{row.stepIndex + 1}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="relative h-6 w-full overflow-hidden rounded bg-muted">
                      <div
                        className="absolute inset-y-0 left-0 rounded bg-primary/25"
                        style={{ width: `${Math.round((row.views / maxViews) * 100)}%` }}
                      />
                      <span className="absolute inset-0 flex items-center px-2 text-xs font-medium tabular-nums">
                        {row.views}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.dropoff > 0 ? (
                      <span className="text-destructive">
                        −{row.dropoff}{' '}
                        <span className="text-muted-foreground">({row.dropoffPercent}%)</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
