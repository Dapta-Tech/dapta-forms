/**
 * Pure URL builders for the outcome booking embed (HubSpot Meetings / Calendly).
 *
 * No I/O, no browser globals — every input (answers, sessionId, embed domain)
 * is passed in explicitly so these are unit-testable and safe to call anywhere
 * (client, server, tests). `URLSearchParams.set` is used throughout, so params
 * never double-append even when the configured booking URL already carries a
 * query string.
 */
import type { OutcomeBooking } from '@quill/types';

/** Contact fields distilled from the collected answers for embed prefill. */
export interface BookingContactFields {
  firstname: string;
  lastname: string;
  /** "firstname lastname" joined (only the non-empty parts). */
  name: string;
  email: string;
  phone: string;
}

/**
 * Pull the prefillable contact fields out of the answers map. The engine's
 * `name` step defaults to the `firstname`/`lastname` keys and the seeded lead
 * forms use `email`/`phone` (`mobilephone` accepted as a fallback alias).
 */
export function extractBookingContactFields(
  answers: Record<string, unknown>,
): BookingContactFields {
  const firstname = String(answers.firstname ?? '').trim();
  const lastname = String(answers.lastname ?? '').trim();
  const email = String(answers.email ?? '').trim();
  const phone = String(answers.phone ?? answers.mobilephone ?? '').trim();
  const name = [firstname, lastname].filter(Boolean).join(' ');
  return { firstname, lastname, name, email, phone };
}

/** A scheduler's resolved prefill: overlaid answers + positional custom answers. */
export interface SchedulerPrefill {
  /** Answers with the mapped values written onto the conventional keys. */
  answers: Record<string, unknown>;
  /** Calendly's positional custom answers (`a1`, `a2`, …) to send explicitly. */
  customAnswers: Record<string, string>;
}

/**
 * Resolve a scheduler step's field mapping against the answers.
 *
 * Calendly's booking form has two built-in fields (name, email) and then the
 * event type's own custom questions, which it prefills POSITIONALLY as `a1`,
 * `a2`, … — so "phone" is only `a1` when the phone question happens to be the
 * first one. Assuming that was why a mapped phone silently did nothing on any
 * event type whose questions were ordered differently. The mapping is therefore
 * keyed by Calendly's real ids: built-ins are overlaid onto the conventional
 * answer keys (so every existing builder picks them up), and custom questions
 * come back separately to be sent as the exact `aN` they belong to.
 *
 * `phone` is still honored from earlier configs and routes to the legacy a1
 * slot. Unmapped fields fall back to the normal extraction.
 */
export function resolveSchedulerPrefill(
  answers: Record<string, unknown>,
  map: Record<string, string | null | undefined> | undefined,
): SchedulerPrefill {
  if (!map) return { answers, customAnswers: {} };
  const out = { ...answers };
  const customAnswers: Record<string, string> = {};
  const read = (key: string | null | undefined): string =>
    key ? String(answers[key] ?? '').trim() : '';

  for (const [field, stepKey] of Object.entries(map)) {
    const value = read(stepKey);
    if (!value) continue; // a blank answer never clobbers what is already there
    if (field === 'name') {
      const [first, ...rest] = value.split(/\s+/);
      out.firstname = first ?? '';
      out.lastname = rest.join(' ');
    } else if (field === 'email') {
      out.email = value;
    } else if (field === 'phone') {
      out.phone = value; // legacy mapping → the a1 slot via the builders below
    } else if (/^a\d+$/.test(field)) {
      customAnswers[field] = value;
    }
  }
  return { answers: out, customAnswers };
}

/** Set a query param only when the value is non-empty (overwrites, never appends). */
function setParam(url: URL, key: string, value: string): void {
  if (value) url.searchParams.set(key, value);
}

/**
 * HubSpot Meetings embed URL: `embed=true` plus CRM-internal-name contact
 * params (`firstname`/`lastname`/`email`/`phone`) when prefill is on.
 */
export function buildHubSpotMeetingsUrl(
  baseUrl: string,
  answers: Record<string, unknown>,
  options?: { prefill?: boolean },
): string {
  const url = new URL(baseUrl);
  url.searchParams.set('embed', 'true');
  if (options?.prefill !== false) {
    const { firstname, lastname, email, phone } = extractBookingContactFields(answers);
    setParam(url, 'firstname', firstname);
    setParam(url, 'lastname', lastname);
    setParam(url, 'email', email);
    setParam(url, 'phone', phone);
  }
  return url.toString();
}

/**
 * Calendly inline-embed URL. `embed_domain` is REQUIRED for the widget's
 * `calendly.event_scheduled` postMessage to reach the parent window — pass the
 * host the page is served from (`window.location.host`). `utm_content` carries
 * the form sessionId so the booking can be tied back to the submission.
 */
export function buildCalendlyEmbedUrl(
  baseUrl: string,
  answers: Record<string, unknown>,
  options?: { prefill?: boolean; sessionId?: string; embedDomain?: string },
): string {
  const url = new URL(baseUrl);
  const embedDomain = options?.embedDomain?.trim() ?? '';
  if (embedDomain) url.searchParams.set('embed_domain', embedDomain);
  url.searchParams.set('embed_type', 'Inline');
  url.searchParams.set('hide_gdpr_banner', '1');
  if (options?.prefill !== false) {
    const { firstname, lastname, name, email, phone } = extractBookingContactFields(answers);
    setParam(url, 'first_name', firstname);
    setParam(url, 'last_name', lastname);
    setParam(url, 'name', name);
    setParam(url, 'email', email);
    setParam(url, 'a1', phone);
  }
  const sessionId = options?.sessionId?.trim() ?? '';
  if (sessionId) url.searchParams.set('utm_content', sessionId);
  return url.toString();
}

/** `Calendly.initInlineWidget` prefill object — complements the URL params. */
export interface CalendlyWidgetPrefill {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  customAnswers?: Record<string, string>;
}

/** Build the widget-API prefill (returns undefined when nothing to prefill). */
export function buildCalendlyWidgetPrefill(
  answers: Record<string, unknown>,
): CalendlyWidgetPrefill | undefined {
  const { firstname, lastname, name, email, phone } = extractBookingContactFields(answers);
  const prefill: CalendlyWidgetPrefill = {};
  if (name) prefill.name = name;
  if (firstname) prefill.firstName = firstname;
  if (lastname) prefill.lastName = lastname;
  if (email) prefill.email = email;
  if (phone) prefill.customAnswers = { a1: phone };
  return Object.keys(prefill).length > 0 ? prefill : undefined;
}

/**
 * The final embed URL for an outcome's booking config. Prefill from answers is
 * ON unless the config explicitly opts out (`prefill: false`) — the same
 * default-enabled convention as `cover.enabled` / `reveal.enabled`.
 */
export function buildBookingEmbedUrl(
  booking: OutcomeBooking,
  answers: Record<string, unknown>,
  sessionId: string,
  embedDomain?: string,
): string {
  const prefill = booking.prefill !== false;
  return booking.provider === 'hubspot_meetings'
    ? buildHubSpotMeetingsUrl(booking.url, answers, { prefill })
    : buildCalendlyEmbedUrl(booking.url, answers, { prefill, sessionId, embedDomain });
}
