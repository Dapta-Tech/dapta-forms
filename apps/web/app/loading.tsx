import { SkeletonList } from '@/components/skeleton';

export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="mb-8 h-9 w-48 animate-pulse rounded-md bg-muted" />
      <SkeletonList rows={3} />
    </main>
  );
}
