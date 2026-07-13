'use client';

import { getMessages } from '@quill/shared';

/** Read the persisted admin locale on the client (mirrors the server cookie). */
function clientLocale(): 'en' | 'es' {
  if (typeof document !== 'undefined' && /(?:^|;\s*)quill_locale=es\b/.test(document.cookie)) return 'es';
  return 'en';
}

export default function SubmissionsError({ reset }: { error: Error; reset: () => void }) {
  const m = getMessages(clientLocale()).admin.submissions;
  return (
    <div className="mx-auto max-w-md px-8 py-16 text-center">
      <h1 className="mb-4 text-2xl font-semibold">{m.error}</h1>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-primary px-5 py-2 font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
      >
        {m.retry}
      </button>
    </div>
  );
}
