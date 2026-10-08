'use client';

/**
 * Inline scheduling screen shown when a completed submission resolves to an
 * outcome with a `booking` config — instead of redirecting straight away, the
 * visitor books a slot here and THEN the renderer reports the booking and
 * redirects.
 *
 * - `hubspot_meetings` → an `<iframe>` on the prefilled meetings URL.
 * - `calendly`         → an inline widget via Calendly's script, with a plain
 *                        link fallback when the script cannot load.
 *
 * The provider's "booked" postMessage (origin-allowlisted, parsed in
 * lib/booking-embed) fires `onBooked` exactly once with the extracted details.
 *
 * A Calendly widget the renderer already booted hidden for this booking
 * (`preloadKey`, see lib/calendly-preload) is ADOPTED instead: it is shown over
 * this screen's slot, already painted, and the prefill is posted to it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { getMessages } from '@quill/shared';
import type { OutcomeBooking } from '@quill/types';
import {
  buildBookingEmbedUrl,
  buildCalendlyWidgetPrefill,
  calendlyPrefillMessagePayload,
} from '@/lib/booking-prefill';
import {
  attachBookingMessageListener,
  loadCalendlyScript,
  warmBookingEmbed,
  type BookingScheduledDetails,
} from '@/lib/booking-embed';
import {
  CALENDLY_FALLBACK_HEIGHT,
  hasPreloadedCalendly,
  holdCalendlyPreload,
  showPreloadedCalendly,
} from '@/lib/calendly-preload';

type EmbedState = 'loading' | 'ready' | 'failed';

// How long to wait for the HubSpot iframe's `load` event before surfacing the
// fallback error copy. The persistent escape-hatch link renders regardless,
// since we cannot read cross-origin iframe status; the link is the robust guard.
const HUBSPOT_LOAD_TIMEOUT_MS = 8000;

export function BookingScreen({
  booking,
  answers,
  sessionId,
  locale = 'en',
  onBooked,
  hideHeader = false,
  extraCustomAnswers,
  preloadKey,
}: {
  booking: OutcomeBooking;
  answers: Record<string, unknown>;
  sessionId: string;
  locale?: string;
  onBooked: (details: BookingScheduledDetails) => void;
  /** Embedded as a form STEP (its own question is the title) — skip the header. */
  hideHeader?: boolean;
  /**
   * Calendly positional custom answers (`a1`, `a2`, …) resolved from a scheduler
   * step's field mapping. Merged into the widget prefill so a custom question is
   * filled by the id it actually has, not a guessed one.
   */
  extraCustomAnswers?: Record<string, string>;
  /**
   * The booking's preload key (`preloadableCalendlyKeys`): when the renderer
   * booted a Calendly widget under it for this session, that widget is shown
   * instead of a new one.
   */
  preloadKey?: string;
}) {
  const m = getMessages(locale).renderer.booking;

  // The screen only mounts client-side (post-submit phase), but stay SSR-safe.
  const [embedDomain] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.host,
  );
  const embedUrl = useMemo(
    () => buildBookingEmbedUrl(booking, answers, sessionId, embedDomain),
    [booking, answers, sessionId, embedDomain],
  );
  const calendlyPrefill = useMemo(() => {
    // "Prefill: off" keeps the contact fields out, as the URL already does; the
    // mapped custom answers are the author's explicit mapping and always ride.
    const base = booking.prefill !== false ? buildCalendlyWidgetPrefill(answers) : undefined;
    const extra = extraCustomAnswers ?? {};
    if (Object.keys(extra).length === 0) return base;
    // The mapped custom questions win over the conventional a1 guess.
    return {
      ...(base ?? {}),
      customAnswers: { ...(base?.customAnswers ?? {}), ...extra },
    };
  }, [answers, extraCustomAnswers, booking.prefill]);
  // The callers rebuild `answers` on every render, so the prefill object is new
  // each time. Effects key on one held per CONTENT: keyed on the object, every
  // re-render of the screen tore the widget down and booted it again.
  const calendlyPrefillKey = JSON.stringify(calendlyPrefill ?? null);
  const stablePrefill = useMemo(() => calendlyPrefill, [calendlyPrefillKey]);

  // Decided at mount; it only ever flips to the cold embed (the widget turned
  // out to be held by another screen).
  const [preloaded, setPreloaded] = useState(
    () =>
      booking.provider === 'calendly' &&
      !!preloadKey &&
      typeof window !== 'undefined' &&
      hasPreloadedCalendly(preloadKey, sessionId),
  );
  const [preloadedHeight, setPreloadedHeight] = useState<number>(CALENDLY_FALLBACK_HEIGHT);

  const containerRef = useRef<HTMLDivElement>(null);
  const [calendlyState, setCalendlyState] = useState<EmbedState>('loading');
  const [hubspotState, setHubspotState] = useState<EmbedState>('loading');

  // Latest onBooked via a ref so the message listener attaches once per provider.
  const onBookedRef = useRef(onBooked);
  onBookedRef.current = onBooked;

  useEffect(() => {
    warmBookingEmbed(booking.provider, booking.url);
  }, [booking.provider, booking.url]);

  useEffect(
    () =>
      attachBookingMessageListener(booking.provider, (details) => {
        onBookedRef.current(details);
      }),
    [booking.provider],
  );

  // Adopted widget: shown over the slot (and prefilled) while this screen lives.
  useEffect(() => {
    if (!preloaded || !preloadKey) return;
    const slot = containerRef.current;
    if (!slot) return;
    return showPreloadedCalendly(preloadKey, sessionId, slot, {
      onHeight: setPreloadedHeight,
      onShown: () => setCalendlyState('ready'),
      onUnavailable: () => setPreloaded(false),
      onFail: () => setCalendlyState('failed'),
      prefill: calendlyPrefillMessagePayload(stablePrefill),
    });
  }, [preloaded, preloadKey, sessionId, stablePrefill]);

  useEffect(() => {
    if (booking.provider !== 'calendly' || preloaded) return;
    let cancelled = false;
    // A cold widget on screen: the hidden preloads would only compete with it.
    const unhold = holdCalendlyPreload();
    setCalendlyState('loading');
    loadCalendlyScript()
      .then(() => {
        if (cancelled) return;
        const container = containerRef.current;
        if (!container || !window.Calendly) {
          setCalendlyState('failed');
          return;
        }
        container.innerHTML = '';
        window.Calendly.initInlineWidget({
          url: embedUrl,
          parentElement: container,
          ...(stablePrefill ? { prefill: stablePrefill } : {}),
          resize: true,
        });
        setCalendlyState('ready');
      })
      .catch(() => {
        if (!cancelled) setCalendlyState('failed');
      });
    return () => {
      cancelled = true;
      unhold();
    };
  }, [booking.provider, preloaded, embedUrl, stablePrefill]);

  // HubSpot: the iframe exposes no ready/error callback, so we can't observe a
  // failed load directly. Start a timer on (re)mount; if the `load` event never
  // fires within the timeout, flip to `failed` to reveal the load-error copy
  // above the always-present fallback link. `onLoad` clears it back to `ready`.
  useEffect(() => {
    if (booking.provider !== 'hubspot_meetings') return;
    setHubspotState('loading');
    const timer = window.setTimeout(() => {
      setHubspotState((prev) => (prev === 'loading' ? 'failed' : prev));
    }, HUBSPOT_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [booking.provider, embedUrl]);

  return (
    <div className="pf-booking" data-testid="booking-screen">
      {hideHeader ? null : (
        <header className="pf-booking__header">
          <h1 className="pf-booking__title">{m.title}</h1>
        </header>
      )}

      <div className="pf-booking__widget">
        {booking.provider === 'hubspot_meetings' ? (
          <>
            <iframe
              data-testid="booking-iframe-hubspot"
              src={embedUrl}
              title={m.iframeTitle}
              className="pf-booking__iframe"
              style={{ width: '100%', minHeight: 640, border: 0 }}
              allow="camera; microphone; geolocation; clipboard-write"
              onLoad={() => setHubspotState('ready')}
            />
            {hubspotState === 'failed' ? (
              <p className="pf__error" role="alert">
                {m.loadError}
              </p>
            ) : null}
            <p className="pf-booking__trouble">
              {m.troublePrefix}{' '}
              <a
                data-testid="booking-hubspot-fallback"
                href={booking.url}
                target="_blank"
                rel="noreferrer"
              >
                {m.fallbackCta}
              </a>
            </p>
          </>
        ) : preloaded ? (
          <>
            {/* The adopted widget lives on <body> and is positioned over this
                slot; the slot only reserves its height in the flow. */}
            <div
              data-testid="booking-embed-calendly"
              data-preloaded=""
              ref={containerRef}
              className="pf-booking__calendly"
              style={{ width: '100%', minHeight: calendlyState === 'failed' ? 0 : preloadedHeight }}
            />
            {calendlyState === 'loading' ? (
              <p className="pf-booking__loading" role="status" aria-live="polite">
                {m.loading}
              </p>
            ) : null}
            {calendlyState === 'failed' ? (
              <p className="pf__error pf-booking__fallback" role="alert">
                {m.loadError}{' '}
                <a href={embedUrl} target="_blank" rel="noopener noreferrer">
                  {m.fallbackCta}
                </a>
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div
              data-testid="booking-embed-calendly"
              ref={containerRef}
              className="pf-booking__calendly"
              style={{ width: '100%', minHeight: calendlyState === 'ready' ? 640 : 0 }}
            />
            {calendlyState === 'loading' ? (
              <p className="pf-booking__loading" role="status" aria-live="polite">
                {m.loading}
              </p>
            ) : null}
            {calendlyState === 'failed' ? (
              <p className="pf__error pf-booking__fallback" role="alert">
                {m.loadError}{' '}
                <a href={embedUrl} target="_blank" rel="noopener noreferrer">
                  {m.fallbackCta}
                </a>
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
