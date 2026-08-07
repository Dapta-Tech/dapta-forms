'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormStep } from '@quill/engine';
import { loadCalendlyScript } from '@/lib/booking-embed';
import type { BuilderMessages } from './builder-messages';

type EmbedState = 'loading' | 'ready' | 'failed';

/**
 * The REAL Calendly widget on the builder canvas.
 *
 * A drawing of a calendar told the author nothing: not which availability the
 * event type exposes, not what the booking page looks like branded, not whether
 * the URL even resolves. This mounts the same inline widget the public form
 * does, from the same script, so the canvas shows exactly what will publish —
 * the only difference is that no answers exist here to prefill.
 */
export function SchedulerEmbedPreview({ step, m }: { step: FormStep; m: BuilderMessages }) {
  const scheduler = step.scheduler;
  const rawUrl = scheduler?.url?.trim() ?? '';
  const hideDetails = scheduler?.hideEventDetails === true;
  const name = scheduler?.eventTypeName?.trim();

  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<EmbedState>('loading');

  // Calendly's inline params. Recomputed only when the event type (or the
  // details toggle) changes, so typing the question never reloads the widget.
  const [embedUrl, setEmbedUrl] = useState('');
  useEffect(() => {
    if (!rawUrl) return setEmbedUrl('');
    try {
      const u = new URL(rawUrl);
      u.searchParams.set('embed_type', 'Inline');
      u.searchParams.set('hide_gdpr_banner', '1');
      if (hideDetails) u.searchParams.set('hide_event_type_details', '1');
      u.searchParams.set('embed_domain', window.location.host);
      setEmbedUrl(u.toString());
    } catch {
      setEmbedUrl('');
    }
  }, [rawUrl, hideDetails]);

  useEffect(() => {
    if (!embedUrl) return;
    let cancelled = false;
    setState('loading');
    loadCalendlyScript()
      .then(() => {
        if (cancelled) return;
        const el = containerRef.current;
        if (!el || !window.Calendly) {
          setState('failed');
          return;
        }
        el.innerHTML = '';
        window.Calendly.initInlineWidget({ url: embedUrl, parentElement: el, resize: true });
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [embedUrl]);

  // No event type picked yet — nothing to embed.
  if (!embedUrl) {
    return (
      <div
        data-testid="canvas-scheduler-preview"
        className="rounded-xl border border-dashed border-border bg-background px-4 py-8 text-center"
      >
        <i
          aria-hidden
          className="pi pi-calendar-plus text-muted-foreground"
          style={{ fontSize: 18 }}
        />
        <p className="mt-2 text-sm text-muted-foreground">{m.canvas.schedulerUnset}</p>
      </div>
    );
  }

  return (
    <div
      data-testid="canvas-scheduler-preview"
      className="overflow-hidden rounded-xl border border-border bg-background"
    >
      {name ? (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <i
            aria-hidden
            className="pi pi-calendar-plus text-muted-foreground"
            style={{ fontSize: 13 }}
          />
          <span className="text-sm font-medium">{name}</span>
        </div>
      ) : null}

      <div
        ref={containerRef}
        data-testid="canvas-calendly-embed"
        style={{ width: '100%', minHeight: state === 'ready' ? 640 : 0 }}
      />

      {state === 'loading' ? (
        <p className="px-4 py-8 text-center text-xs text-muted-foreground" role="status">
          {m.canvas.schedulerLoading}
        </p>
      ) : null}
      {state === 'failed' ? (
        <p className="px-4 py-8 text-center text-xs text-muted-foreground" role="alert">
          {m.canvas.schedulerLoadError}
        </p>
      ) : null}

      <p className="border-t border-border px-4 py-2 text-xs leading-relaxed text-muted-foreground">
        {m.canvas.schedulerNote}
      </p>
    </div>
  );
}
