import { Skeleton } from '@/components/skeleton';

export default function AnalyticsLoading() {
  return (
    <div>
      <div className="border-b border-border">
        <div className="mx-auto max-w-[1520px] px-6 pb-4 pt-6 sm:px-8">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="mt-4 h-6 w-80" />
        </div>
      </div>
      <div className="mx-auto flex max-w-[1520px] flex-col gap-6 px-6 py-6 sm:px-8">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-80 w-full rounded-2xl" />
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    </div>
  );
}
