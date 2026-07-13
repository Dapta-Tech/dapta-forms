import { Skeleton } from '@/components/skeleton';

export default function EventTypesLoading() {
  return (
    <div className="mx-auto max-w-[1520px] px-8 py-10">
      <Skeleton className="mb-6 h-9 w-48" />
      <div className="mb-8 flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
