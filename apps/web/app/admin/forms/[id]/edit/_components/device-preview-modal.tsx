'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Answers, FormConfig, FormLayout } from '@quill/engine';
import { runtimeSteps } from '@quill/engine';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { LivePreview } from './live-preview';
import { PreviewFrame, type PreviewDevice } from './preview-frame';
import type { EditorMessages } from './messages';

/**
 * The Preview modal — the form as it is configured RIGHT NOW.
 *
 * It used to iframe the public URL, which serves the PUBLISHED config: an author
 * could change every color and typeface, press Preview, and be shown the old
 * design with nothing explaining why. It now renders the live draft through the
 * same `LivePreview` the Design tab uses — real public markup, real public
 * stylesheet — so Preview always reflects the current design and needs no
 * publish.
 *
 * Screens are walked with the engine's own `runtimeSteps`, so skip-logic hides
 * and shows exactly what it will for a respondent rather than listing every
 * configured step.
 */
export function DevicePreviewModal({
  open,
  onClose,
  config,
  name,
  locale,
  layout = 'slides',
  m,
}: {
  open: boolean;
  onClose: () => void;
  config: FormConfig;
  name: string;
  locale: string;
  /** One page has no screens to step through — the navigation hides. */
  layout?: FormLayout;
  m: EditorMessages['preview'];
}) {
  const [device, setDevice] = useState<PreviewDevice>('mobile');
  const [index, setIndex] = useState<number | 'cover'>('cover');
  const restoreRef = useRef<HTMLElement | null>(null);

  const vertical = layout === 'vertical';
  const hasCover = config.cover?.enabled !== false;
  // Empty answers: the preview walks the default branch, which is the path a
  // respondent who has answered nothing yet would see.
  const steps = useMemo(
    () => runtimeSteps(config as unknown as Parameters<typeof runtimeSteps>[0], {} as Answers),
    [config],
  );

  // Reopening should start at the beginning rather than wherever the last look
  // ended, and a step index from a previous config could now be out of range.
  useEffect(() => {
    if (open) setIndex(hasCover ? 'cover' : 0);
  }, [open, hasCover]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const total = steps.length;
  const position = index === 'cover' ? -1 : index;
  const canPrev = position > (hasCover ? -1 : 0);
  const canNext = position < total - 1;

  function go(delta: number) {
    setIndex((current) => {
      const at = current === 'cover' ? -1 : current;
      const next = at + delta;
      if (next < 0) return hasCover ? 'cover' : 0;
      return Math.min(next, total - 1);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4">
      <button type="button" aria-hidden tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-background/85" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={m.device}
        className="relative flex h-[92vh] w-full max-w-5xl flex-col gap-3 rounded-xl border border-border bg-popover p-3 shadow-lg"
      >
        <div className="flex items-center justify-between gap-3">
          {/* A one-page form has no screens to step through — it scrolls. */}
          {vertical ? (
            <span className="text-xs text-muted-foreground">{m.inert}</span>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => go(-1)}
                disabled={!canPrev}
                aria-label={m.previous}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <i aria-hidden className="pi pi-chevron-left" style={{ fontSize: 11 }} />
              </button>
              <span
                className="min-w-0 truncate text-xs tabular-nums text-muted-foreground"
                data-testid="preview-position"
              >
                {index === 'cover' ? m.coverTitle : `${m.step} ${position + 1} ${m.of} ${total}`}
              </span>
              <button
                type="button"
                onClick={() => go(1)}
                disabled={!canNext}
                aria-label={m.next}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <i aria-hidden className="pi pi-chevron-right" style={{ fontSize: 11 }} />
              </button>
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={m.close}>
            <i aria-hidden className="pi pi-times" style={{ fontSize: 13 }} /> {m.close}
          </Button>
        </div>

        <div className={cn('min-h-0 flex-1')}>
          <PreviewFrame device={device} onDeviceChange={setDevice} publicPath={''} m={m} hideAddressBar>
            <LivePreview
              config={config}
              selected={vertical ? 'cover' : index}
              layout={layout}
              name={name}
              locale={locale}
              m={m}
            />
          </PreviewFrame>
        </div>
      </div>
    </div>
  );
}
