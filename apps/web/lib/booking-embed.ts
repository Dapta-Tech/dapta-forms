/**
 * Booking-embed runtime helpers for the public renderer:
 *
 * - `warmBookingEmbed`     — idempotent `<link rel="preconnect">` warming (SSR-safe)
 * - `loadCalendlyScript`   — idempotent loader for Calendly's inline-widget script
 * - `parseBookingMessage`  — pure parser for both providers' postMessage events
 * - `attachBookingMessageListener` — window listener wiring with origin allowlists
 * - `postBookingCallback`  — best-effort POST of the booking callback to the API
 *
 * No `'use client'` directive on purpose: every DOM access is guarded, so the
 * module is importable from server actions (for `postBookingCallback`) as well
 * as client components. All third-party payloads are treated as untrusted —
 * origin-allowlisted, shape-checked, and URI/date fields validated before use.
 */
import type { BookingCallbackInput, BookingProvider } from '@quill/types';
import type { CalendlyWidgetPrefill } from './booking-prefill';

export const CALENDLY_SCRIPT_SRC = 'https://assets.calendly.com/assets/external/widget.js';

const CALENDLY_MESSAGE_ORIGIN = 'https://calendly.com';
const HUBSPOT_MESSAGE_ORIGINS = ['https://meetings.hubspot.com', 'https://app.hubspot.com'];

/** Hosts worth a preconnect before the embed renders (per provider). */
const PRECONNECT_ORIGINS: Record<BookingProvider, string[]> = {
  hubspot_meetings: ['https://meetings.hubspot.com', 'https://static.hsappstatic.net'],
  calendly: ['https://calendly.com', 'https://assets.calendly.com'],
};

declare global {
  interface Window {
    Calendly?: {
      initInlineWidget: (options: {
        url: string;
        parentElement: HTMLElement;
        prefill?: CalendlyWidgetPrefill;
        resize?: boolean;
      }) => void;
    };
  }
}

/**
 * Warm DNS/TLS for the provider's embed hosts (plus the booking URL's own
 * origin, which may be a custom domain). Idempotent — existing links are
 * skipped — and a no-op on the server, so it is safe to call during the reveal
 * interstitial and again when the booking screen mounts.
 */
export function warmBookingEmbed(provider: BookingProvider, url?: string): void {
  if (typeof document === 'undefined') return;
  const origins = new Set(PRECONNECT_ORIGINS[provider]);
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') origins.add(parsed.origin);
    } catch {
      // Malformed configured URL — nothing to warm; the embed itself will surface it.
    }
  }
  for (const href of origins) {
    if (document.querySelector(`link[rel="preconnect"][href="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = href;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }
}

/**
 * Load Calendly's inline-widget script once. Re-entrant: resolves immediately
 * when `window.Calendly` exists, and piggybacks on an already-inserted tag
 * instead of adding a second one. Rejects when the script fails to load so the
 * caller can render the fallback link.
 */
export function loadCalendlyScript(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve();
  if (window.Calendly) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(
    'script[src*="calendly.com/assets/external/widget.js"]',
  );
  if (existing) {
    return new Promise((resolve, reject) => {
      if (window.Calendly) return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Calendly script failed to load')),
        { once: true },
      );
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CALENDLY_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Calendly script failed to load'));
    document.body.appendChild(script);
  });
}

/** What a provider's "booked" postMessage told us (all fields best-effort). */
export interface BookingScheduledDetails {
  provider: BookingProvider;
  /** Provider URI of the scheduled event (Calendly). */
  eventUri?: string;
  /** Provider URI of the invitee record (Calendly). */
  inviteeUri?: string;
  /** Scheduled start, normalized to an ISO 8601 datetime. */
  startTime?: string;
}

/** Keep only http(s) string URIs — the callback schema requires valid URLs. */
function safeUri(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^https?:\/\//.test(trimmed) ? trimmed : undefined;
}

/** Normalize an epoch-ms number or datetime string to ISO 8601 (or drop it). */
function safeIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Calendly's invitee URI embeds the event URI — recover it when absent. */
function eventUriFromInviteeUri(inviteeUri: string | undefined): string | undefined {
  if (!inviteeUri) return undefined;
  const match = inviteeUri.match(/^(https:\/\/api\.calendly\.com\/scheduled_events\/[^/]+)/);
  return match?.[1];
}

function parseCalendlyMessage(event: {
  origin: string;
  data: unknown;
}): BookingScheduledDetails | null {
  if (event.origin !== CALENDLY_MESSAGE_ORIGIN) return null;
  const data = event.data;
  if (!data || typeof data !== 'object') return null;
  const record = data as {
    event?: unknown;
    payload?: {
      event?: { uri?: unknown; start_time?: unknown };
      invitee?: { uri?: unknown };
    };
  };
  if (record.event !== 'calendly.event_scheduled') return null;

  const inviteeUri = safeUri(record.payload?.invitee?.uri);
  const eventUri = safeUri(record.payload?.event?.uri) ?? eventUriFromInviteeUri(inviteeUri);
  const startTime = safeIsoDate(record.payload?.event?.start_time);
  return {
    provider: 'calendly',
    ...(eventUri ? { eventUri } : {}),
    ...(inviteeUri ? { inviteeUri } : {}),
    ...(startTime ? { startTime } : {}),
  };
}

function parseHubSpotMeetingsMessage(event: {
  origin: string;
  data: unknown;
}): BookingScheduledDetails | null {
  if (!HUBSPOT_MESSAGE_ORIGINS.includes(event.origin)) return null;
  const data = event.data;
  if (!data || typeof data !== 'object') return null;
  const record = data as {
    meetingBookSucceeded?: unknown;
    type?: unknown;
    eventName?: unknown;
    startTime?: unknown;
    meetingPayload?: { startTime?: unknown };
  };
  const booked =
    record.meetingBookSucceeded === true ||
    record.type === 'hsMeetingBookSuccess' ||
    record.eventName === 'meetingBooked';
  if (!booked) return null;

  const startTime = safeIsoDate(record.startTime ?? record.meetingPayload?.startTime);
  return { provider: 'hubspot_meetings', ...(startTime ? { startTime } : {}) };
}

/**
 * Pure parser for a provider's window `message` event. Returns the scheduled
 * details when the event is a genuine "booked" signal from an allowlisted
 * origin, else null. Recognized signals:
 *
 * - Calendly: `data.event === 'calendly.event_scheduled'` from
 *   https://calendly.com (payload carries event/invitee URIs).
 * - HubSpot Meetings: `meetingBookSucceeded === true`,
 *   `type === 'hsMeetingBookSuccess'`, or `eventName === 'meetingBooked'` from
 *   https://meetings.hubspot.com / https://app.hubspot.com.
 */
export function parseBookingMessage(
  provider: BookingProvider,
  event: Pick<MessageEvent, 'origin' | 'data'>,
): BookingScheduledDetails | null {
  return provider === 'calendly'
    ? parseCalendlyMessage(event)
    : parseHubSpotMeetingsMessage(event);
}

/**
 * Attach a window `message` listener for the provider's "booked" signal.
 * The handler fires AT MOST ONCE per attachment (providers can echo the
 * success event) and only for allowlisted origins. Returns a detach function;
 * on the server this is a no-op that returns a noop detacher.
 */
export function attachBookingMessageListener(
  provider: BookingProvider,
  handler: (details: BookingScheduledDetails) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  let fired = false;
  const listener = (event: MessageEvent) => {
    if (fired) return;
    const details = parseBookingMessage(provider, event);
    if (!details) return;
    fired = true;
    handler(details);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

// Same base-URL resolution as apps/web/lib/api.ts — NEXT_PUBLIC_* is inlined
// client-side and readable server-side, so this helper works from either.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Report a booked meeting to the public API (`bookingCallbackSchema` payload)
 * so it is persisted against the session's submission. Best-effort like the
 * funnel-event POST: a network failure never blocks the visitor's redirect.
 */
export async function postBookingCallback(
  accountCode: string,
  slug: string,
  body: BookingCallbackInput,
): Promise<void> {
  await fetch(
    `${API_URL}/v1/public/forms/${encodeURIComponent(accountCode)}/${encodeURIComponent(slug)}/booking`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  ).catch(() => undefined);
}
