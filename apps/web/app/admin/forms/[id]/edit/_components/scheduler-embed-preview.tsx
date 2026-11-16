'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormStep } from '@quill/engine';
import { loadCalendlyScript } from '@/lib/booking-embed';
import { DcalLogo } from '@/components/ui/dcal-logo';
import { Button } from '@/components/ui/button';
import type { BuilderMessages } from './builder-messages';

type EmbedState = 'loading' | 'ready' | 'failed';

/** `embed=1` is what puts dCal's booking page in embed chrome. Exported so it
 *  can be asserted without rendering a frame that would then be fetched. */
export function dcalPreviewUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.searchParams.set('embed', '1');
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Open the event-type picker in the settings panel.
 *
 * The canvas card's primary action has to reach a control that is not its
 * own, and the alternative was a second picker inside the card: two controls
 * for one value, which is how they come to disagree. Reaching for the panel's
 * trigger keeps one. A panel that is not on screen simply does nothing, which
 * is the honest outcome rather than a thrown error.
 */
function schedulerEventPicker(): HTMLButtonElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLButtonElement>('[data-testid="scheduler-dcal-event-type"] button');
}

function openSchedulerEventPicker(): void {
  const trigger = schedulerEventPicker();
  if (!trigger) return;
  trigger.scrollIntoView({ block: 'center', behavior: 'smooth' });
  trigger.click();
}

/**
 * Where to send an author who has no event type yet, read from the same list
 * endpoint the picker reads. It is not a build-time constant: dCal's host
 * differs per environment, and `NEXT_PUBLIC_*` bakes at build. Null until it
 * answers, and null if it cannot, which simply drops the link.
 */
function useDcalCreateEventUrl(enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch('/admin/integrations/dcal/event-types', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { enabled?: boolean; createEventUrl?: string | null } | null) => {
        if (cancelled || !body?.enabled) return;
        setUrl(body.createEventUrl ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return url;
}

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
  // Absent means Calendly, as it does everywhere else: a step authored before
  // dCal existed carries no provider and must keep rendering as it did.
  const provider = scheduler?.provider === 'dcal' ? 'dcal' : 'calendly';
  const createEventUrl = useDcalCreateEventUrl(provider === 'dcal' && !rawUrl);
  /**
   * Whether there is a picker to open at all. An author with no event type in
   * this workspace sees the panel's own empty state instead of a picker, which
   * is precisely when this card is on screen, so without this the primary
   * button would be a button that does nothing and says nothing.
   */
  const [canPick, setCanPick] = useState(false);
  useEffect(() => {
    if (provider !== 'dcal' || rawUrl) return;
    // The panel renders its picker from its own fetch, so look again once it
    // has had a turn rather than only on this mount.
    const check = () => setCanPick(!!schedulerEventPicker());
    check();
    const timer = window.setInterval(check, 500);
    return () => window.clearInterval(timer);
  }, [provider, rawUrl]);
  const hideDetails = scheduler?.hideEventDetails === true;
  const name = scheduler?.eventTypeName?.trim();

  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<EmbedState>('loading');

  // Calendly's inline params. Recomputed only when the event type (or the
  // details toggle) changes, so typing the question never reloads the widget.
  const [embedUrl, setEmbedUrl] = useState('');
  useEffect(() => {
    // An early return further down stops the RENDER, never the effects: without
    // this a dCal step still had Calendly's parameters stapled onto its URL.
    if (provider !== 'calendly') return setEmbedUrl('');
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
  }, [provider, rawUrl, hideDetails]);

  useEffect(() => {
    // Same reason: this one injects `assets.calendly.com` into the builder
    // page, which a dCal step has no business doing.
    if (provider !== 'calendly') return;
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
  }, [provider, embedUrl]);

  /**
   * dCal, already pointed at an event: a plain iframe, the way dCal's own
   * snippet embeds it and the way the public form will. No script to load.
   */
  if (provider === 'dcal' && rawUrl) {
    return (
      <div
        data-testid="canvas-scheduler-preview"
        className="overflow-hidden rounded-xl border border-border bg-background"
      >
        {name ? (
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <DcalLogo width={44} className="shrink-0" />
            <span className="text-sm font-medium">{name}</span>
          </div>
        ) : null}
        <iframe
          data-testid="canvas-scheduler-dcal"
          src={dcalPreviewUrl(rawUrl)}
          title={name ?? m.settings.schedulerProviderDcal}
          loading="lazy"
          className="block w-full"
          style={{ height: 560, border: 0 }}
        />
      </div>
    );
  }

  /**
   * dCal with nothing picked yet: the SETUP card.
   *
   * This stands where Calendly's "No event type picked yet" line does, and
   * says more on purpose. It is the first place most authors meet dCal, and a
   * dashed box reading "nothing configured" tells them neither what it is nor
   * why they would want it. The two actions are the only two that make sense
   * here: pick one of the event types they already have, or go make one.
   */
  if (provider === 'dcal') {
    return (
      <div
        data-testid="canvas-scheduler-dcal-setup"
        className="overflow-hidden rounded-xl border border-border bg-background"
      >
        <div className="flex flex-col gap-3 px-4 py-5">
          <DcalLogo width={78} />
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold text-foreground">{m.canvas.schedulerDcalSetupTitle}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {m.canvas.schedulerDcalSetupBody}
            </p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {[m.canvas.schedulerDcalSetupPointOne, m.canvas.schedulerDcalSetupPointTwo].map((point) => (
              <li key={point} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#3DDC84]" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!canPick}
              data-testid="canvas-scheduler-dcal-pick"
              // The picker itself lives in the settings panel, where every
              // other question type is configured. This opens it rather than
              // duplicating it, so there is one control and not two that can
              // disagree.
              onClick={() => openSchedulerEventPicker()}
            >
              {m.canvas.schedulerDcalSetupPick}
            </Button>
            {createEventUrl ? (
              <a
                data-testid="canvas-scheduler-dcal-create"
                href={createEventUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-xs font-medium underline"
              >
                {m.canvas.schedulerDcalSetupCreate}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

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
