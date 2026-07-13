import { Skeleton } from '@/components/skeleton';

export default function AnalyticsLoading() {
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <Skeleton className="mb-6 h-9 w-64" />
      <Skeleton className="mb-6 h-9 w-80" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="mt-8 h-64 w-full" />
    </div>
  );
}
