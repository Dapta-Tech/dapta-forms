'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { EditorMessages } from './messages';

export type PreviewDevice = 'mobile' | 'desktop';

/**
 * The device frame around the live preview: an address bar showing the form's
 * real public URL, a mobile/desktop switch, and a viewport the preview renders
 * into at that width.
 *
 * The address bar is here rather than only in the editor header because the URL
 * is part of what an author is designing — it is the first thing a respondent
 * sees, and it belongs next to the thing it opens. It is also the honest way to
 * show a desktop/mobile switch: a bare rectangle at 390px does not read as a
 * phone, so nothing tells you which width you are looking at.
 *
 * The frame is sized in CSS pixels and the preview inside it is a real DOM
 * subtree, so the form's own `@media` breakpoints resolve against the BROWSER
 * width, not the frame's. That is why mobile also scales the frame down rather
 * than only narrowing it — the proportions stay honest even though the media
 * queries cannot.
 */
export function PreviewFrame({
  device,
  onDeviceChange,
  publicPath,
  toolbar,
  children,
  m,
}: {
  device: PreviewDevice;
  onDeviceChange: (device: PreviewDevice) => void;
  publicPath: string;
  /** Extra controls beside the device switch — e.g. which screen to preview. */
  toolbar?: ReactNode;
  children: ReactNode;
  m: EditorMessages['preview'];
}) {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');

  // Resolved client-side: `publicPath` is a server-stable path, and the real
  // origin is whatever host the author is actually on.
  useEffect(() => setOrigin(window.location.origin), []);

  const fullUrl = origin ? `${origin}${publicPath}` : publicPath;
  const displayUrl = fullUrl.replace(/^https?:\/\//, '');

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div
          role="radiogroup"
          aria-label={m.device}
          className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5"
        >
          {(['mobile', 'desktop'] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={device === d}
              onClick={() => onDeviceChange(d)}
              data-testid={`preview-device-${d}`}
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                device === d ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <i aria-hidden className={d === 'mobile' ? 'pi pi-mobile' : 'pi pi-desktop'} style={{ fontSize: 12 }} />
              {d === 'mobile' ? m.mobile : m.desktop}
            </button>
          ))}
        </div>
        {toolbar ?? <p className="truncate text-[11px] text-muted-foreground">{m.inert}</p>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-muted/30">
        {/* Address bar — the form's real public URL. */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-card px-2.5 py-2">
          <span aria-hidden className="flex shrink-0 gap-1">
            <span className="h-2 w-2 rounded-full bg-border" />
            <span className="h-2 w-2 rounded-full bg-border" />
            <span className="h-2 w-2 rounded-full bg-border" />
          </span>
          <span
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-background px-2 py-1"
            title={fullUrl}
          >
            <i aria-hidden className="pi pi-lock shrink-0 text-muted-foreground" style={{ fontSize: 9 }} />
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              <span className="sr-only">{m.urlLabel}: </span>
              {displayUrl}
            </span>
          </span>
          <button
            type="button"
            onClick={copy}
            title={copied ? m.copied : m.copyLink}
            aria-label={copied ? m.copied : m.copyLink}
            data-testid="preview-copy-link"
            className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <i aria-hidden className={`pi ${copied ? 'pi-check' : 'pi-copy'}`} style={{ fontSize: 12 }} />
          </button>
          <a
            href={publicPath}
            target="_blank"
            rel="noreferrer"
            title={m.openForm}
            aria-label={m.openForm}
            className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <i aria-hidden className="pi pi-external-link" style={{ fontSize: 12 }} />
          </a>
        </div>

        <div className="flex min-h-0 flex-1 justify-center overflow-auto p-3">
          <div
            className={cn(
              'h-full overflow-hidden border border-border bg-background shadow-sm',
              device === 'mobile' ? 'w-[390px] max-w-full rounded-[28px]' : 'w-full rounded-lg',
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
