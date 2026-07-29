import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { AnalyticsResponse } from '@quill/types';
import { getMessages, type FormsMessages } from '@quill/shared';
import { adminApi, ApiError } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { FormTabs } from '@/components/ui/form-tabs';
import { Skeleton } from '@/components/skeleton';
import { AnalyticsFilter } from './analytics-filter';
import { TrendsChart } from './trends-chart';

export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;

type SP = { preset?: string; from?: string; to?: string };

/**
 * Resolve the URL query into an epoch-ms range the API understands.
 *
 * Day boundaries are UTC and resolved HERE, on the server, deliberately: an
 * analytics number has to be the same for every teammate reading it, so it
 * cannot depend on the viewer's local clock. (A per-account timezone is the
 * follow-up; until then UTC is the one shared reference.) "Last week/month/year"
 * are rolling 7/30/365-day windows, matching how the presets read in Typeform.
 */
function resolveRange(sp: SP): { from?: number; to?: number } {
  if (sp.preset === 'custom') {
    const from = sp.from ? Date.parse(`${sp.from}T00:00:00.000Z`) : NaN;
    const to = sp.to ? Date.parse(`${sp.to}T23:59:59.999Z`) : NaN;
    return {
      from: Number.isNaN(from) ? undefined : from,
      to: Number.isNaN(to) ? undefined : to,
    };
  }
  const now = Date.now();
  if (sp.preset === 'today') {
    const startOfDay = Math.floor(now / DAY_MS) * DAY_MS;
    return { from: startOfDay, to: startOfDay + DAY_MS - 1 };
  }
  const days = sp.preset === 'week' ? 7 : sp.preset === 'month' ? 30 : sp.preset === 'year' ? 365 : null;
  // Send BOTH bounds for a rolling window. With only `from`, the trend series
  // ended at the last day that happened to have data, so a quiet stretch made
  // the chart stop short of today and silently misrepresent the window.
  //
  // `from` snaps to a whole UTC day so the window is N COMPLETE days ending
  // today. Cutting at `now - N days` (an intra-day instant) left the oldest
  // bucket holding only part of its day while the chart drew it as a full one.
  if (days) {
    const startOfToday = Math.floor(now / DAY_MS) * DAY_MS;
    return { from: startOfToday - (days - 1) * DAY_MS, to: now };
  }
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
  const locale = await getLocale();
  const m = getMessages(locale).admin;
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
            today: m.analytics.rangeToday,
            week: m.analytics.rangeWeek,
            month: m.analytics.rangeMonth,
            year: m.analytics.rangeYear,
            all: m.analytics.rangeAll,
            custom: m.analytics.rangeCustom,
            from: m.analytics.rangeFrom,
            to: m.analytics.rangeTo,
            apply: m.analytics.rangeApply,
          }}
        />
      </div>

      <Suspense key={rangeKey} fallback={<AnalyticsSkeleton />}>
        <AnalyticsData id={id} range={range} m={m.analytics} locale={locale} />
      </Suspense>
    </div>
  );
}

/**
 * Format seconds as `Ns`, `Nm Ss` or `Nh Nm`. The hour tier matters: a session
 * left open across days used to render as "4440m", which reads as noise rather
 * than a duration.
 */
function formatDuration(seconds: number, unit: string): string {
  if (seconds < 60) return `${seconds}${unit}`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s === 0 ? `${m}m` : `${m}m ${s}${unit}`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  // Rounding the remainder can land on a full hour — "1h 60m" is not a duration.
  if (m === 60) return `${h + 1}h`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

async function AnalyticsData({
  id,
  range,
  m,
  locale,
}: {
  id: string;
  range: { from?: number; to?: number };
  m: FormsMessages['admin']['analytics'];
  locale: string;
}) {
  let a: AnalyticsResponse;
  try {
    a = await adminApi.getAnalytics(id, range);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const hasActivity = a.views + a.starts + a.submissions + a.partialSubmits + a.bookings > 0;
  if (!hasActivity) {
    // A filtered range with no activity is NOT the same as a form nobody has
    // ever opened — telling an owner with 500 responses "once people open your
    // form…" because they picked last week is simply wrong.
    const filtered = range.from != null || range.to != null;
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-12 text-center">
        <p className="text-lg font-medium">{filtered ? m.emptyRangeTitle : m.emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          {filtered ? m.emptyRangeBody : m.emptyBody}
        </p>
      </div>
    );
  }

  const cards = [
    { label: m.metricViews, value: String(a.views) },
    { label: m.metricStarts, value: String(a.starts) },
    { label: m.metricSubmissions, value: String(a.submissions) },
    {
      label: m.metricCompletionRate,
      // null = no starts in range, so the rate has no denominator.
      value: a.completionRate == null ? '—' : `${a.completionRate}%`,
    },
    {
      label: m.metricTimeToComplete,
      // null = no completed session in range had a derivable open time. Showing
      // "0s" there would state a duration nobody measured.
      value: a.timeToComplete == null ? '—' : formatDuration(a.timeToComplete, m.seconds),
    },
    { label: m.metricPartials, value: String(a.partialSubmits) },
    // Only when the form actually converts through a meeting: an eternal "0"
    // on every plain form would read as a broken metric, not an absent feature.
    ...(a.bookings > 0 ? [{ label: m.metricBookings, value: String(a.bookings) }] : []),
  ];

  const maxViews = Math.max(1, ...a.dropoff.map((r) => r.views));

  return (
    <div className="flex flex-col gap-8">
      <div
        className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${
          cards.length === 7 ? 'lg:grid-cols-7' : 'lg:grid-cols-6'
        }`}
      >
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>

      <TrendsChart
        points={a.trends}
        locale={locale}
        labels={{
          title: m.trendsTitle,
          subtitle: m.trendsSubtitle,
          metricLabel: m.trendsMetricLabel,
          empty: m.trendsEmpty,
          seconds: m.seconds,
          metrics: {
            views: m.metricViews,
            starts: m.metricStarts,
            submissions: m.metricSubmissions,
            completionRate: m.metricCompletionRate,
            timeToComplete: m.metricTimeToComplete,
          },
        }}
      />

      <section>
        <h2 className="text-lg font-semibold">{m.dropoffTitle}</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {a.dropoffMode === 'answered' ? m.dropoffSubtitleAnswered : m.dropoffSubtitle}
        </p>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">{m.colStep}</th>
                <th className="w-[45%] px-4 py-3 font-medium">
                  {a.dropoffMode === 'answered' ? m.colAnswered : m.colViews}
                </th>
                <th className="px-4 py-3 text-right font-medium">{m.colDropoff}</th>
              </tr>
            </thead>
            <tbody>
              {a.dropoff.map((row) => (
                <tr key={row.stepIndex} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3">
                    <span className="font-medium">
                      {row.isCover ? (row.question ? m.coverRow : m.landingRow) : row.question}
                    </span>
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
