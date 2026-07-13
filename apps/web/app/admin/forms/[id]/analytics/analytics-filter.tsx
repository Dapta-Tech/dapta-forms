'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

type Preset = '7' | '30' | '90' | 'all' | 'custom';

/**
 * Date-range control for the analytics dashboard: presets (7/30/90 days + all)
 * plus a custom from/to. Writes the choice to the URL query so the server
 * component re-fetches; a Suspense boundary shows the skeleton while it does
 * (R22). Tokens-only; 44px hit targets (R28).
 */
export function AnalyticsFilter({
  labels,
}: {
  labels: {
    last7: string;
    last30: string;
    last90: string;
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

  const applyCustom = () => {
    if (!from && !to) return;
    const next = new URLSearchParams();
    next.set('preset', 'custom');
    if (from) next.set('from', from);
    if (to) next.set('to', to);
    push(next);
  };

  const presets: { key: Preset; label: string }[] = [
    { key: '7', label: labels.last7 },
    { key: '30', label: labels.last30 },
    { key: '90', label: labels.last90 },
    { key: 'all', label: labels.all },
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
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {labels.from}
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {labels.to}
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            />
          </label>
          <button
            type="button"
            disabled={pending || (!from && !to)}
            onClick={applyCustom}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {labels.apply}
          </button>
        </div>
      ) : null}
    </div>
  );
}
