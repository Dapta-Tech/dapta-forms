'use client';

import { BrandMark } from '@/components/brand/brand';

/** Root error boundary (R22: every error state has a real Retry). */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <BrandMark className="h-8 w-auto text-muted-foreground" />
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">We couldn’t load this page. Please try again.</p>
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
