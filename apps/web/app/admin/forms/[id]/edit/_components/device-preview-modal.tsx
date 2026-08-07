'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormConfig, FormLayout } from '@quill/engine';
import { Button } from '@/components/ui/button';
import { PreviewFrame, type PreviewDevice } from './preview-frame';
import type { EditorMessages } from './messages';

/**
 * The Preview modal — the form as it is configured RIGHT NOW, at a real device
 * width.
 *
 * It used to iframe the PUBLIC url, which serves the PUBLISHED config: an author
 * could change every colour and typeface, press Preview, and be shown the old
 * design with nothing explaining why. The fix for that was to stop using an
 * iframe and render the public markup as a subtree of the admin document —
 * which cured the staleness and introduced a worse lie, because CSS `@media`
 * resolves against the BROWSER viewport, not a 390px box. The "mobile" preview
 * was the desktop layout squeezed into a phone shape: `(min-width: 769px)`
 * matched inside it, the body padded 40px instead of 24/16, and the question
 * title measured 28px where a phone gets 21px.
 *
 * It is an iframe again — pointed at `/preview` (the DRAFT), not at the public
 * url. The frame owns its own viewport, so the widths are honest; the config
 * arrives by `postMessage`, so it is the live editor state with no autosave wait
 * and no publish. Both reasons are satisfied at once, and the 310 lines of
 * markup that `live-preview.tsx` duplicated from the real renderer are gone.
 *
 * The screens are not stepped through from out here: the frame runs the REAL
 * renderer, so it walks itself exactly as a respondent would (and reaches the
 * server at no point — see the fence in `preview-document.tsx`). Prev/next and
 * Restart live on the frame's own toolbar, which also hosts this modal's Close
 * via `endSlot`.
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
  /** One page scrolls rather than stepping — the renderer handles the shape. */
  layout?: FormLayout;
  m: EditorMessages['preview'];
}) {
  const [device, setDevice] = useState<PreviewDevice>('mobile');
  const restoreRef = useRef<HTMLElement | null>(null);

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

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4">
      <button type="button" aria-hidden tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-background/85" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={m.device}
        className="relative flex h-[92vh] w-full max-w-5xl flex-col gap-3 rounded-xl border border-border bg-popover p-3 shadow-lg"
      >
        <div className="min-h-0 flex-1">
          {/* Close lives on the frame's own toolbar (its `endSlot`) rather than
              in a row of its own — the modal has exactly one row of chrome. */}
          <PreviewFrame
            device={device}
            onDeviceChange={setDevice}
            publicPath=""
            config={config}
            name={name}
            locale={locale}
            layout={layout}
            m={m}
            hideAddressBar
            endSlot={
              <Button variant="ghost" size="sm" onClick={onClose} aria-label={m.close} className="h-8">
                <i aria-hidden className="pi pi-times" style={{ fontSize: 13 }} /> {m.close}
              </Button>
            }
          />
        </div>
      </div>
    </div>
  );
}
