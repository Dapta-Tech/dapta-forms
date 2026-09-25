import { Skeleton } from '@/components/skeleton';

export default function SubmissionsSummaryLoading() {
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <Skeleton className="mb-6 h-9 w-64" />
      <Skeleton className="mb-4 h-9 w-72" />
      <Skeleton className="mb-6 h-10 w-56" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    </div>
  );
}
