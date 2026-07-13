'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { EditorMessages } from './messages';

type Device = 'mobile' | 'desktop';

/**
 * Device preview: renders the live public form route inside a framed iframe at
 * mobile (390px) or desktop widths. Backdrop + Esc close, focus restore. Save
 * before opening so the iframe reflects the latest config.
 */
export function DevicePreviewModal({
  open,
  onClose,
  publicPath,
  m,
}: {
  open: boolean;
  onClose: () => void;
  publicPath: string;
  m: EditorMessages['preview'];
}) {
  const [device, setDevice] = useState<Device>('mobile');
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
        className="relative flex h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-border bg-popover shadow-lg"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="inline-flex rounded-md border border-border p-0.5">
            {(['mobile', 'desktop'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDevice(d)}
                aria-pressed={device === d}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors',
                  device === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <i aria-hidden className={d === 'mobile' ? 'pi pi-mobile' : 'pi pi-desktop'} style={{ fontSize: 13 }} />
                {d === 'mobile' ? m.mobile : m.desktop}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={m.close}>
            <i aria-hidden className="pi pi-times" style={{ fontSize: 13 }} /> {m.close}
          </Button>
        </div>

        <div className="flex flex-1 items-start justify-center overflow-auto bg-muted/30 p-4">
          <div
            className={cn(
              'overflow-hidden rounded-lg border border-border bg-background shadow-sm transition-all',
              device === 'mobile' ? 'h-[780px] w-[390px] max-w-full' : 'h-full w-full',
            )}
          >
            <iframe
              key={device}
              src={publicPath}
              title={m.device}
              className="h-full w-full border-0"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
