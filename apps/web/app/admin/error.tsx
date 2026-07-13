'use client';

export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md px-8 py-16 text-center">
      <h1 className="mb-2 text-2xl font-semibold">Couldn’t load this section</h1>
      <p className="mb-4 text-muted-foreground">
        The API may be unreachable. Check it’s running, then retry.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-primary px-5 py-2 font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
      >
        Retry
      </button>
    </div>
  );
}
