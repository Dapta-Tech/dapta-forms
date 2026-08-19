'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The workspace's id with a one-click copy. It shows the SAME id the Dapta app
 * shows for this workspace (the identity service's), so a person pasting it
 * into a support thread, the admin panel or a URL of the other app names the
 * same thing. Local-only accounts (no identity service) show their own id.
 */
export function WorkspaceId({
  id,
  labels,
}: {
  id: string;
  labels: { idLabel: string; copyId: string; copied: string };
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the id is still selectable text */
    }
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" data-testid="workspace-id">
      <span className="text-faint">{labels.idLabel}:</span>
      <code className="min-w-0 truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground" title={id}>
        {id}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? labels.copied : labels.copyId}
        title={copied ? labels.copied : labels.copyId}
        data-testid="workspace-id-copy"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <i aria-hidden className={copied ? 'pi pi-check' : 'pi pi-copy'} style={{ fontSize: 12 }} />
      </button>
    </span>
  );
}
