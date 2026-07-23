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
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { getMessages } from '@quill/shared';
import type { OutcomeBooking } from '@quill/types';
import {
  buildBookingEmbedUrl,
  buildCalendlyWidgetPrefill,
} from '@/lib/booking-prefill';
import {
  attachBookingMessageListener,
  loadCalendlyScript,
  warmBookingEmbed,
  type BookingScheduledDetails,
} from '@/lib/booking-embed';

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
}: {
  booking: OutcomeBooking;
  answers: Record<string, unknown>;
  sessionId: string;
  locale?: string;
  onBooked: (details: BookingScheduledDetails) => void;
  /** Embedded as a form STEP (its own question is the title) — skip the header. */
  hideHeader?: boolean;
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
  const calendlyPrefill = useMemo(() => buildCalendlyWidgetPrefill(answers), [answers]);

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

  useEffect(() => {
    if (booking.provider !== 'calendly') return;
    let cancelled = false;
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
          ...(calendlyPrefill ? { prefill: calendlyPrefill } : {}),
          resize: true,
        });
        setCalendlyState('ready');
      })
      .catch(() => {
        if (!cancelled) setCalendlyState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [booking.provider, embedUrl, calendlyPrefill]);

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
