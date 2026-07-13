import { Skeleton } from '@/components/skeleton';

export default function BookingsLoading() {
  return (
    <div className="mx-auto max-w-[1520px] px-8 py-10">
      <Skeleton className="mb-6 h-9 w-40" />
      <Skeleton className="mb-3 h-4 w-56" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[68px] w-full" />
        ))}
      </div>
    </div>
  );
}
