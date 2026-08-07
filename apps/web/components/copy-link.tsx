'use client';

import { useEffect, useState } from 'react';

const stripProtocol = (u: string) => u.replace(/^https?:\/\//, '');

/** Shared copy-to-clipboard state: resolves the absolute URL from the live
 *  origin at click time and flashes `copied` for 2s after a successful write
 *  (R22). Single source of truth for every copy-link control. */
function useCopyPath(path: string) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  return { copied, copy };
}

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
  const { copied, copy } = useCopyPath(path);
  const [display, setDisplay] = useState(() => stripProtocol(path));

  useEffect(() => {
    setDisplay(stripProtocol(`${window.location.origin}${path}`));
  }, [path]);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <code className="min-w-0 flex-1 truncate rounded-sm bg-muted px-2 py-1 text-sm" title={display}>
        {display}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 whitespace-nowrap rounded-md border border-border px-3 py-1.5 text-sm transition-transform hover:border-primary-edge active:scale-[0.98]"
      >
        {copied ? (labels?.copied ?? 'Copied ✓') : (labels?.copy ?? 'Copy')}
      </button>
      <a href={path} className="shrink-0 whitespace-nowrap text-sm text-primary hover:underline">
        {labels?.open ?? 'Open'} →
      </a>
    </div>
  );
}

/** Compact icon-only copy button for dense action rows (forms list). Same
 *  clipboard behavior as CopyLink — icon flips pi-clipboard → pi-check for the
 *  2s copied window; the accessible name flips with it. */
export function CopyLinkIcon({
  path,
  labels,
  testId,
  className,
}: {
  path: string;
  labels: { copy: string; copied: string };
  testId?: string;
  className?: string;
}) {
  const { copied, copy } = useCopyPath(path);

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? labels.copied : labels.copy}
      title={copied ? labels.copied : labels.copy}
      data-testid={testId}
      className={
        className ??
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      }
    >
      <i aria-hidden className={`pi ${copied ? 'pi-check' : 'pi-clipboard'}`} style={{ fontSize: 14 }} />
    </button>
  );
}
