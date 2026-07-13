'use client';

import { useEffect, useState } from 'react';

const stripProtocol = (u: string) => u.replace(/^https?:\/\//, '');

/** The public form link with a copy-to-clipboard button (F1). Absolute URL resolved
 *  client-side from the real origin; a 2s "Copied" flash confirms (R22).
 *  The displayed text starts as the server-stable `path` so SSR and the first
 *  client render match (no hydration mismatch), then upgrades to the absolute
 *  origin after mount. */
export function CopyLink({
  path,
  labels,
}: {
  path: string;
  /** i18n'd button labels; English fallbacks keep old call sites working. */
  labels?: { copy: string; copied: string; open: string };
}) {
  const [copied, setCopied] = useState(false);
  const [display, setDisplay] = useState(() => stripProtocol(path));

  useEffect(() => {
    setDisplay(stripProtocol(`${window.location.origin}${path}`));
  }, [path]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  return (
    <div className="flex items-center gap-3">
      <code className="rounded-sm bg-muted px-2 py-1 text-sm">{display}</code>
      <button
        type="button"
        onClick={copy}
        className="rounded-md border border-border px-3 py-1 text-sm transition-transform hover:border-primary active:scale-[0.98]"
      >
        {copied ? (labels?.copied ?? 'Copied ✓') : (labels?.copy ?? 'Copy')}
      </button>
      <a href={path} className="text-sm text-primary hover:underline">
        {labels?.open ?? 'Open'} →
      </a>
    </div>
  );
}
