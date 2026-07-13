import { Skeleton } from '@/components/skeleton';

export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <Skeleton className="mb-1 h-9 w-40" />
      <Skeleton className="mb-6 h-4 w-72" />
      <div className="mb-6 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>
      <Skeleton className="h-72 w-full max-w-2xl" />
    </div>
  );
}
