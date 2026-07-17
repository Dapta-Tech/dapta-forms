'use client';

import { useState } from 'react';

/**
 * Compact copy-link + open-in-new-tab controls for the editor header. The
 * public URL is resolved client-side from the real origin (the `publicPath`
 * prop is a server-stable path). A 2s "Copied" flash confirms the copy.
 */
export function LinkActions({
  publicPath,
  labels,
}: {
  publicPath: string;
  labels: { copyLink: string; copied: string; openForm: string };
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${publicPath}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const btn =
    'inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={copy}
        className={btn}
        aria-label={labels.copyLink}
        title={labels.copyLink}
        data-testid="editor-copy-link"
      >
        <i aria-hidden className={`pi ${copied ? 'pi-check' : 'pi-link'}`} style={{ fontSize: 13 }} />
        <span className="hidden lg:inline">{copied ? labels.copied : labels.copyLink}</span>
      </button>
      <a
        href={publicPath}
        target="_blank"
        rel="noreferrer"
        className={btn}
        aria-label={labels.openForm}
        title={labels.openForm}
        data-testid="editor-open-form"
      >
        <i aria-hidden className="pi pi-external-link" style={{ fontSize: 13 }} />
        <span className="hidden lg:inline">{labels.openForm}</span>
      </a>
    </div>
  );
}
