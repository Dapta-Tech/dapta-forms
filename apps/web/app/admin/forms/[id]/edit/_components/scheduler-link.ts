/**
 * Turn whatever an author pastes for "the Calendly event" into the scheduling
 * URL the form embeds — or `null` when it is not one.
 *
 * Authors paste three shapes: the event page link copied from the browser,
 * that link with Calendly's own query string on it (`?month=2026-09`), or the
 * whole inline-embed snippet Calendly hands out ("Add to website"), with the
 * URL inside a `data-url` attribute. All three resolve to the same page, so
 * all three are accepted and normalised to one canonical URL: https, the host
 * as pasted (a Calendly subdomain is fine), the path only. The query is dropped
 * because the renderer builds its own (prefill, hide-details); a stale `month`
 * would otherwise open the widget on a month that has passed.
 *
 * Pure, no I/O — unit-tested on its own. It does not check the event EXISTS
 * (that needs a token the whole point is not to require); the canvas preview
 * mounts the real widget, which is where a dead link shows.
 */
export interface CalendlyLink {
  /** Canonical scheduling URL to store in `scheduler.url`. */
  url: string;
  /** The event's slug (last path segment) — the only name available without a token. */
  slug: string;
  /** A readable label derived from the slug, for the canvas and the picker. */
  name: string;
}

const CALENDLY_HOST = /(^|\.)calendly\.com$/i;
const DATA_URL = /data-url\s*=\s*["']([^"']+)["']/i;
const LOOSE_URL = /https?:\/\/[^\s"'<>]+/i;

export function parseCalendlyLink(input: string): CalendlyLink | null {
  const raw = input.trim();
  if (!raw) return null;
  // The embed snippet first (its `data-url` is the one that matters), then any
  // URL found in the text, then the text itself as a URL.
  const candidate = DATA_URL.exec(raw)?.[1] ?? LOOSE_URL.exec(raw)?.[0] ?? raw;
  let u: URL;
  try {
    u = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
  } catch {
    return null;
  }
  if (!CALENDLY_HOST.test(u.hostname)) return null;
  const segments = u.pathname.split('/').filter(Boolean);
  // `/team/event` is an event page; a bare `/team` is the owner's landing page
  // (a list of events), which is not something the form can book against.
  if (segments.length < 2) return null;
  const slug = segments[segments.length - 1]!;
  return {
    url: `https://${u.hostname.toLowerCase()}/${segments.join('/')}`,
    slug,
    name: humanizeSlug(slug),
  };
}

/** `onboarding-scale_up` → `Onboarding scale up`. Good enough for a label. */
function humanizeSlug(slug: string): string {
  const words = decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : slug;
}

/** True when a scheduler was configured by pasting a link rather than picking from the list. */
export function isLinkConfigured(scheduler: {
  eventTypeUri?: string | null;
  url?: string | null;
}): boolean {
  return !scheduler.eventTypeUri && !!scheduler.url?.trim();
}
