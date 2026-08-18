'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DatePicker } from '@/components/ui/date-picker';
import { todayUtcIso } from '@/lib/calendar-math';

type Preset = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom';

/**
 * Date-range control for the analytics dashboard. The preset set mirrors
 * Typeform (All time / Today / Last week / Last month / Last year) plus the
 * custom from/to this dashboard already had. "Last week/month/year" are ROLLING
 * windows (7/30/365 days), not calendar periods — resolved server-side in
 * page.tsx so every teammate sees the same numbers regardless of where they are.
 * Writes the choice to the URL query so the server component re-fetches; a
 * Suspense boundary shows the skeleton while it does (R22). Tokens-only; 44px
 * hit targets (R28). The custom From/To fields are the branded `DatePicker`
 * (not native date inputs), fed the server's `locale` so the first frame
 * matches on both sides.
 */
export function AnalyticsFilter({
  labels,
  locale,
}: {
  locale: string;
  labels: {
    today: string;
    week: string;
    month: string;
    year: string;
    all: string;
    custom: string;
    from: string;
    to: string;
    apply: string;
  };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const current = (params.get('preset') as Preset | null) ?? 'all';
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [showCustom, setShowCustom] = useState(current === 'custom');

  const push = (next: URLSearchParams) => start(() => router.push(`?${next.toString()}`, { scroll: false }));

  const selectPreset = (preset: Preset) => {
    if (preset === 'custom') {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    const next = new URLSearchParams();
    if (preset !== 'all') next.set('preset', preset);
    push(next);
  };

  // Today in UTC — the same reference the server resolves ranges against, so the
  // picker cannot offer a "future" that is only future in the viewer's timezone.
  const todayUtc = todayUtcIso();

  const applyCustom = () => {
    if (!from && !to) return;
    // A reversed range silently returned zeros behind the generic empty state,
    // which reads as "no data" rather than "these bounds are backwards".
    const [lo, hi] = from && to && from > to ? [to, from] : [from, to];
    const next = new URLSearchParams();
    next.set('preset', 'custom');
    if (lo) next.set('from', lo);
    if (hi) next.set('to', hi);
    push(next);
  };

  const presets: { key: Preset; label: string }[] = [
    { key: 'all', label: labels.all },
    { key: 'today', label: labels.today },
    { key: 'week', label: labels.week },
    { key: 'month', label: labels.month },
    { key: 'year', label: labels.year },
    { key: 'custom', label: labels.custom },
  ];

  return (
    <div className="flex flex-col gap-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => {
          const active = p.key === 'custom' ? showCustom : !showCustom && current === p.key;
          return (
            <button
              key={p.key}
              type="button"
              disabled={pending}
              onClick={() => selectPreset(p.key)}
              aria-pressed={active}
              className={
                active
                  ? 'inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60'
                  : 'inline-flex h-9 items-center rounded-md border border-border bg-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60'
              }
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {showCustom ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>{labels.from}</span>
            <DatePicker
              value={from}
              onChange={setFrom}
              max={to || todayUtc}
              locale={locale}
              ariaLabel={labels.from}
              testId="analytics-from"
            />
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>{labels.to}</span>
            <DatePicker
              value={to}
              onChange={setTo}
              min={from || undefined}
              max={todayUtc}
              locale={locale}
              ariaLabel={labels.to}
              testId="analytics-to"
            />
          </div>
          <button
            type="button"
            disabled={pending || (!from && !to)}
            onClick={applyCustom}
            data-testid="analytics-apply"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {labels.apply}
          </button>
        </div>
      ) : null}
    </div>
  );
}
