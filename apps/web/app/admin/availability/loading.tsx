import { Skeleton } from '@/components/skeleton';

export default function AvailabilityLoading() {
  return (
    <div className="mx-auto max-w-[1520px] px-8 py-10">
      <Skeleton className="mb-1 h-9 w-56" />
      <Skeleton className="mb-6 h-4 w-96" />
      {/* Schedule-card shaped: header row + 7 weekday rows. */}
      <div className="rounded-md border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
