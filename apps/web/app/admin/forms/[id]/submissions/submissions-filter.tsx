'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

type Status = 'all' | 'completed' | 'partial';

/**
 * Status filter for the submissions table (all / completed / partial). Writes
 * the choice to the URL query (resetting pagination) so the server component
 * re-fetches; the Suspense boundary shows the skeleton meanwhile (R22).
 */
export function SubmissionsFilter({
  labels,
}: {
  labels: { all: string; completed: string; partial: string };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const current = (params.get('status') as Status | null) ?? 'all';

  const select = (status: Status) => {
    const next = new URLSearchParams(params.toString());
    next.delete('offset'); // new filter → back to page 1
    if (status === 'all') next.delete('status');
    else next.set('status', status);
    start(() => router.push(`?${next.toString()}`, { scroll: false }));
  };

  const options: { key: Status; label: string }[] = [
    { key: 'all', label: labels.all },
    { key: 'completed', label: labels.completed },
    { key: 'partial', label: labels.partial },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      {options.map((o) => {
        const active = o.key === current;
        return (
          <button
            key={o.key}
            type="button"
            disabled={pending}
            onClick={() => select(o.key)}
            aria-pressed={active}
            className={
              active
                ? 'inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60'
                : 'inline-flex h-9 items-center rounded-md border border-border bg-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60'
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
