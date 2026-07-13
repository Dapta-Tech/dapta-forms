'use client';

/** R22 error boundary for the manage-booking subtree. */
export default function ManageError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Couldn’t load your booking</h1>
      <p className="text-muted-foreground">The link may have expired, or the service is unreachable.</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-primary px-5 py-2 font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
      >
        Try again
      </button>
    </main>
  );
}
