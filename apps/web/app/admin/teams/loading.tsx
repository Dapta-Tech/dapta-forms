import { Skeleton } from '@/components/skeleton';

export default function TeamsLoading() {
  return (
    <div className="mx-auto max-w-[1520px] px-8 py-10">
      <Skeleton className="mb-1 h-9 w-32" />
      <Skeleton className="mb-6 h-4 w-72" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[72px] w-full" />
        ))}
      </div>
    </div>
  );
}
