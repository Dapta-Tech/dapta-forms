import { Skeleton } from '@/components/skeleton';

/** R22: settle the layout while the settings load — no CTA/section flash. */
export default function Loading() {
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      {[0, 1].map((s) => (
        <div key={s} className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
          <Skeleton className="h-4 w-32" />
          {[0, 1, 2].map((r) => (
            <div key={r} className="flex items-center justify-between gap-4 py-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-72" />
              </div>
              <Skeleton className="h-5 w-10 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
