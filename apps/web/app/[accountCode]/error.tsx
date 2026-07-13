'use client';

/** R22 error boundary for the public form subtree — a real Retry, no dead end. */
export default function PublicError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">This page didn’t load</h1>
      <p className="text-muted-foreground">Something went wrong reaching the forms service.</p>
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
