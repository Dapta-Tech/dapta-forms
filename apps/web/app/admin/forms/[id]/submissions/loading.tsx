import { Skeleton } from '@/components/skeleton';

export default function SubmissionsLoading() {
  return (
    <div>
      <div className="border-b border-border">
        <div className="mx-auto max-w-[1520px] px-6 pb-4 pt-6 sm:px-8">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="mt-4 h-6 w-80" />
        </div>
      </div>
      <div className="mx-auto max-w-[1520px] px-6 py-6 sm:px-8">
        <Skeleton className="mb-4 h-9 w-56 rounded-full" />
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    </div>
  );
}
