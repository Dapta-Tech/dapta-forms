import { Skeleton } from '@/components/skeleton';

/**
 * Loading state for the public form — a skeleton that mirrors the cover screen
 * region (logo, headline, sub, CTA), not a blocking spinner (R22). Centered and
 * framed to match the rendered surface so there's no layout jump.
 */
export default function FormLoading() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-12">
      <div className="flex w-full max-w-[460px] flex-col items-center gap-5 rounded-2xl border border-border bg-card p-11">
        <Skeleton className="h-7 w-28 rounded-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="mt-1 h-4 w-56" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-4 h-[54px] w-full rounded-lg" />
      </div>
    </main>
  );
}
