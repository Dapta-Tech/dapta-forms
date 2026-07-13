import { SkeletonList } from '@/components/skeleton';

export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="mb-6 h-9 w-56 animate-pulse rounded-md bg-muted" />
      <SkeletonList rows={4} />
    </div>
  );
}
