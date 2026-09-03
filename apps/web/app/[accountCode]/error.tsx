'use client';

import { getMessages } from '@quill/shared';
import { publicClientLocale } from '@/lib/client-locale';

/** R22 error boundary for the public form subtree: a real Retry, no dead end. */
export default function PublicError({ reset }: { error: Error; reset: () => void }) {
  // A client boundary has no request to read: ?lang, then the browser.
  const m = getMessages(publicClientLocale()).renderer;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">{m.errorTitle}</h1>
      <p className="text-muted-foreground">{m.errorBody}</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-primary px-5 py-2 font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
      >
        {m.errorRetry}
      </button>
    </main>
  );
}
