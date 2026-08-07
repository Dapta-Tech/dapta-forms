'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormConfig, FormLayout } from '@quill/engine';
import { publicTitle } from '@quill/engine';
import { t } from '@quill/shared';
import { cn } from '@/lib/cn';
import {
  PREVIEW_CHANNEL,
  PREVIEW_ROUTE,
  readPreviewMessage,
  type PreviewConfigMessage,
} from '@/app/preview/protocol';
import { getPreviewExtras, type EditorMessages } from './messages';

export type PreviewDevice = 'mobile' | 'tablet' | 'desktop';

/**
 * The three widths the public stylesheet actually produces — measured, not
 * guessed:
 *
 * | width | `max-480` | `min-769` | `.pf__body` padding | alignment | `.pf__inner` |
 * |-------|-----------|-----------|---------------------|-----------|--------------|
 * | 390   | ✓         | —         | `24px 16px`         | top       | fluid 358px  |
 * | 768   | —         | —         | `32px 20px 28px`    | top       | fluid 540px  |
 * | 1280  | —         | ✓         | `40px 40px 36px`    | centred   | fixed 478px  |
 *
 * Tablet is **768**, not an iPad's 834: at 834 the form is already in the
 * desktop band, so an 834 preset would show desktop twice and leave the
 * 481–768px band — a real third rendering — visible from nowhere in the product.
 *
 * The heights are real pixels rather than `h-full` because `100dvh` inside the
 * frame resolves to the FRAME's height: a stretched frame would move the fold.
 */
export const PREVIEW_VIEWPORTS: Record<PreviewDevice, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
};

const DEVICES: PreviewDevice[] = ['mobile', 'tablet', 'desktop'];
const DEVICE_ICON: Record<PreviewDevice, string> = {
  mobile: 'pi pi-mobile',
  tablet: 'pi pi-tablet',
  desktop: 'pi pi-desktop',
};

/**
 * The device frame around the preview: an address bar showing the form's real
 * public URL, a mobile/tablet/desktop switch, and a same-origin IFRAME the real
 * public renderer draws into at that exact width.
 *
 * The iframe is the whole point. The preview used to be a DOM subtree of the
 * admin document, so the form's `@media` queries resolved against the browser
 * window: at a 390px "mobile" frame on a 1440px monitor, `(max-width: 480px)`
 * was false and `(min-width: 769px)` was TRUE — the mobile preview was the
 * desktop layout in a phone-shaped box, down to the 28px question title that
 * should have been 21px. A frame with its own browsing context gets its own
 * viewport, so media queries, `dvh` and `vw` are all correct by construction and
 * the public stylesheet needs no preview-only rules at all.
 *
 * Two consequences follow, and both are load-bearing:
 *  - **Scale, never narrow.** When 1280 does not fit the panel the iframe is
 *    `transform: scale()`d. Its viewport stays 1280, so every query still
 *    resolves there; only the picture shrinks. Narrowing it would change the
 *    rendering, which is the bug this replaces.
 *  - **The document suppresses its own scrollbars** (see `preview-document.tsx`),
 *    so a 390px frame is 390px of usable width rather than 380.
 *
 * The address bar is here rather than only in the editor header because the URL
 * is part of what an author is designing, and because a bare rectangle at 390px
 * does not read as a phone — nothing else would tell you which width you are on.
 */
export function PreviewFrame({
  device,
  onDeviceChange,
  publicPath,
  config,
  name,
  locale,
  layout,
  hideAddressBar = false,
  m,
}: {
  device: PreviewDevice;
  onDeviceChange: (device: PreviewDevice) => void;
  publicPath: string;
  /** The LIVE editor config — posted into the frame, never fetched by it. */
  config: FormConfig;
  /** The form's dashboard name; the public title is resolved here. */
  name: string;
  /** Drives both the renderer's chrome copy and this frame's own strings. */
  locale: string;
  layout: FormLayout;
  /**
   * Drop the address bar. The Preview modal already sits above the editor
   * header, which carries Copy link and Open form — repeating the URL there
   * would be chrome about chrome.
   */
  hideAddressBar?: boolean;
  m: EditorMessages['preview'];
}) {
  const x = getPreviewExtras(locale);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');
  const [revision, setRevision] = useState(0);
  // Counts DOCUMENT loads, not booleans: a frame that reloads (dev HMR, a
  // navigation) re-announces itself, and the config has to be posted again.
  const [readyTick, setReadyTick] = useState(0);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  // Resolved client-side: `publicPath` is a server-stable path, and the real
  // origin is whatever host the author is actually on.
  useEffect(() => setOrigin(window.location.origin), []);

  const { width, height } = PREVIEW_VIEWPORTS[device];
  const { stageRef, scale } = useFitScale(width, height);

  const payload = useMemo<Omit<PreviewConfigMessage, 'channel' | 'type'>>(
    () => ({ revision, config, name: publicTitle(config, name), locale, layout }),
    [revision, config, name, locale, layout],
  );

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const message = readPreviewMessage(event, frameRef.current?.contentWindow);
      if (message?.type === 'ready') setReadyTick((n) => n + 1);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Re-posted on every editor change, which is what makes the preview show the
  // IN-MEMORY draft: no 900ms autosave wait, no publish. Addressed to this exact
  // origin — never '*', which would hand a draft config to any embedder.
  useEffect(() => {
    if (readyTick === 0) return;
    try {
      frameRef.current?.contentWindow?.postMessage(
        { channel: PREVIEW_CHANNEL, type: 'config', ...payload },
        window.location.origin,
      );
    } catch {
      // `postMessage` structured-clones its payload. A config is plain JSON by
      // contract, but a clone failure here would otherwise throw out of an
      // effect and take the whole editor down with it — a stale preview is a
      // far smaller problem than a blank Design tab.
      console.warn('[forms] preview config could not be posted to the frame');
    }
  }, [readyTick, payload]);

  const fullUrl = origin ? `${origin}${publicPath}` : publicPath;
  const displayUrl = fullUrl.replace(/^https?:\/\//, '');
  const percent = Math.round(scale * 100);
  const viewportLabel =
    t(x.viewport, { width, height }) + (percent < 100 ? ` — ${t(x.scaled, { percent })}` : '');

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
          {DEVICES.map((d) => (
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
              <i aria-hidden className={DEVICE_ICON[d]} style={{ fontSize: 12 }} />
              {d === 'mobile' ? m.mobile : d === 'tablet' ? x.tablet : m.desktop}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {/* The real numbers, so "scaled to fit" can never be mistaken for
              "rendered narrower" — the viewport is 1280 either way. */}
          <span
            title={viewportLabel}
            aria-label={viewportLabel}
            data-testid="preview-viewport"
            className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground"
          >
            {width} × {height}
            {percent < 100 ? ` · ${percent}%` : ''}
          </span>
          <button
            type="button"
            onClick={() => setRevision((n) => n + 1)}
            title={x.restart}
            aria-label={x.restart}
            data-testid="preview-restart"
            className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <i aria-hidden className="pi pi-replay" style={{ fontSize: 12 }} />
          </button>
          <p className="truncate text-[11px] text-muted-foreground">{m.inert}</p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-muted/30">
        {/* Address bar — the form's real public URL. */}
        <div
          className={cn(
            'shrink-0 items-center gap-1.5 border-b border-border bg-card px-2.5 py-2',
            hideAddressBar ? 'hidden' : 'flex',
          )}
        >
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

        {/* `min-h` rather than `min-h-0`: on a narrow admin window this column
            has no definite height, and a stage of zero height would compute a
            scale of nothing. */}
        <div className="flex min-h-[420px] flex-1 overflow-hidden p-3">
          {/* The stage is sized by the PANEL and never by the frame it holds —
              the framed box is taken OUT OF FLOW for exactly that reason. In
              flow, shrinking the frame would shrink the stage that measured it,
              which would shrink the frame again: a scale that converges on
              zero. */}
          <div ref={stageRef} className="relative w-full flex-1">
            <div
              className={cn(
                'absolute inset-x-0 top-0 mx-auto overflow-hidden border border-border bg-background shadow-sm',
                device === 'mobile' ? 'rounded-[28px]' : 'rounded-lg',
              )}
              // content-box so the 1px chrome border cannot clip 2px off the
              // rendering it is framing.
              style={{ width: width * scale, height: height * scale, boxSizing: 'content-box' }}
            >
              <iframe
                ref={frameRef}
                src={PREVIEW_ROUTE}
                title={m.title}
                data-testid="preview-iframe"
                // The frame's INTERNAL size is always the preset; `scale` only
                // changes the picture. This is what keeps `@media`, `dvh` and
                // `vw` resolving at 390 / 768 / 1280 whatever the panel's width.
                style={{
                  width,
                  height,
                  border: 0,
                  display: 'block',
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The largest scale (never above 1) at which `width × height` fits the stage.
 *
 * Measured with a ResizeObserver rather than a breakpoint guess because the
 * Design tab's preview column and the Preview modal are different sizes, and
 * both change with the window.
 */
function useFitScale(width: number, height: number) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  const measure = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const next = Math.min(1, rect.width / width, rect.height / height);
    // Snapping kills the observe → resize → observe loop a raw setState invites.
    setScale((prev) => (Math.abs(prev - next) < 0.005 ? prev : next));
  }, [width, height]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  return { stageRef, scale };
}
