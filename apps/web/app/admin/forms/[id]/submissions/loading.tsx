import { Skeleton } from '@/components/skeleton';

export default function SubmissionsLoading() {
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <Skeleton className="mb-6 h-9 w-64" />
      <Skeleton className="mb-6 h-9 w-72" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
