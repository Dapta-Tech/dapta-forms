/**
 * Pure URL builders for the outcome booking embed (HubSpot Meetings / Calendly).
 *
 * No I/O, no browser globals: every input (answers, campaign UTMs, embed
 * domain) is passed in explicitly so these are unit-testable and safe to call anywhere
 * (client, server, tests). `URLSearchParams.set` is used throughout, so params
 * never double-append even when the configured booking URL already carries a
 * query string.
 */
import type { OutcomeBooking } from '@quill/types';
import type { FormStep } from '@quill/engine';
import { nameFields } from '@quill/engine';

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

/**
 * Resolve the contact fields "Automatic" should use, by QUESTION TYPE.
 *
 * The conventional extraction reads the literal keys `email`/`phone`, which only
 * exist on forms authored to use them — a question added in the builder gets a
 * generated key like `email_1`, so Automatic silently filled nothing on every
 * form built the normal way. (A `name` step was the exception: it stores under
 * its subfields, which ARE the conventional keys, so names appeared to work.)
 *
 * Only answered steps count, so a contact question sitting AFTER the scheduler
 * is naturally ignored — it has no answer yet. Explicit mappings are applied
 * afterwards and win.
 */
function autoContactAnswers(
  answers: Record<string, unknown>,
  steps: FormStep[] | undefined,
): Record<string, unknown> {
  if (!steps?.length) return answers;
  const out = { ...answers };
  const answered = (key: string): string => String(answers[key] ?? '').trim();
  const firstAnswered = (type: FormStep['type']): FormStep | undefined =>
    steps.find((s) => s.type === type && answered(s.key) !== '');

  if (!answered('email')) {
    const step = firstAnswered('email');
    if (step) out.email = answers[step.key];
  }
  if (!answered('phone') && !answered('mobilephone')) {
    const step = firstAnswered('phone');
    if (step) out.phone = answers[step.key];
  }
  if (!answered('firstname') && !answered('lastname')) {
    // A name step keeps its answers under its own subfield keys, which are only
    // firstname/lastname by default — an author may have renamed them.
    const step = steps.find((s) => s.type === 'name' && nameFields(s).some((f) => answered(f)));
    if (step) {
      const [first, last] = nameFields(step);
      if (first && answered(first)) out.firstname = answers[first];
      if (last && answered(last)) out.lastname = answers[last];
    }
  }
  return out;
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
  steps?: FormStep[],
  /**
   * Which provider's ids `map` is keyed by. It decides what counts as a custom
   * question, and getting it wrong is silent: dCal event types may have a
   * booking field literally NAMED `phone`, which under Calendly's rules would
   * be read as the legacy built-in and routed to its `a1` slot instead of to
   * the field of that name. Defaults to Calendly, which is what every config
   * written before dCal existed means.
   */
  provider: 'calendly' | 'hubspot_meetings' | 'dcal' = 'calendly',
): SchedulerPrefill {
  // "Automatic" first — resolved by question type — then the explicit mappings
  // on top, so a field the author mapped always wins over the inferred one.
  const auto = autoContactAnswers(answers, steps);
  if (!map) return { answers: auto, customAnswers: {} };
  const out = { ...auto };
  const customAnswers: Record<string, string> = {};
  const read = (key: string | null | undefined): string =>
    key ? String(answers[key] ?? '').trim() : '';
  // dCal's booking form asks `name`, `email` and `notes` by itself and treats
  // every other field name as one of the event type's own questions
  // (RESERVED_FIELD_NAMES there). Calendly's built-ins are name/email, with
  // `phone` kept as the legacy alias of its first custom slot.
  const isCustom = (field: string): boolean =>
    provider === 'dcal' ? !['name', 'email', 'notes'].includes(field) : /^a\d+$/.test(field);

  for (const [field, stepKey] of Object.entries(map)) {
    const value = read(stepKey);
    if (!value) continue; // a blank answer never clobbers what is already there
    if (field === 'name') {
      const [first, ...rest] = value.split(/\s+/);
      out.firstname = first ?? '';
      out.lastname = rest.join(' ');
    } else if (field === 'email') {
      out.email = value;
    } else if (field === 'notes' && provider === 'dcal') {
      out.notes = value;
    } else if (field === 'phone' && provider !== 'dcal') {
      out.phone = value; // legacy mapping → the a1 slot via the builders below
    } else if (isCustom(field)) {
      customAnswers[field] = value;
    }
  }
  return { answers: out, customAnswers };
}

/** Set a query param only when the value is non-empty (overwrites, never appends). */
function setParam(url: URL, key: string, value: string): void {
  if (value) url.searchParams.set(key, value);
}

/** The five campaign keys a scheduling page records on the booking it creates. */
const CAMPAIGN_UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

/**
 * Carry the visitor's campaign onto the booking page, so the booking it
 * creates is credited to the campaign the visitor arrived with.
 *
 * A `utm_*` key the author already wrote into the booking URL wins (compared
 * case-insensitively), the same rule `appendUtm` applies to a redirect: an
 * owner who tagged their booking link on purpose keeps that tag. Only the five
 * standard keys are sent, and an empty value is no parameter.
 *
 * This is also why nothing of ours rides in `utm_content` any more. The form
 * used to put its session id there, which overwrote the campaign's own
 * `utm_content` on every booking, and nothing ever read it back: the booking
 * is tied to its submission by the renderer's own callback, which carries the
 * session id itself (see `bookingCallbackSchema`).
 */
function setCampaignUtm(url: URL, utm: Record<string, string> | undefined): void {
  if (!utm) return;
  const written = new Set([...url.searchParams.keys()].map((k) => k.toLowerCase()));
  for (const key of CAMPAIGN_UTM_KEYS) {
    if (written.has(key)) continue;
    const value = typeof utm[key] === 'string' ? utm[key].trim() : '';
    if (value) url.searchParams.set(key, value);
  }
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
 * host the page is served from (`window.location.host`). `utm` is the
 * visitor's campaign (see `setCampaignUtm`); Calendly's own widget forwards the
 * host page's UTMs the same way, so passing them here only makes an embedded
 * form's landing campaign reach it too.
 */
export function buildCalendlyEmbedUrl(
  baseUrl: string,
  answers: Record<string, unknown>,
  options?: { prefill?: boolean; embedDomain?: string; utm?: Record<string, string> },
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
  setCampaignUtm(url, options?.utm);
  return url.toString();
}

/**
 * dCal inline-embed URL.
 *
 * `embed=1` is what puts its booking page in embed chrome and starts its
 * `postMessage` channel; there is no script to load and no `embed_domain` to
 * declare, because the iframe is declarative and the events go to any framing
 * page (dCal's public routes carry `frame-ancestors *`).
 *
 * The form's own answers fill `name`, `email` and `notes`; each of the event
 * type's own questions is prefilled under `answer_<fieldName>`, the parameter
 * dCal reads it by. dCal keeps the five `utm_*` on the booking it creates, so
 * the visitor's campaign is passed on (see `setCampaignUtm`). The booking is
 * tied to its submission by the `uid` dCal posts back, never by a URL param.
 */
export function buildDcalEmbedUrl(
  baseUrl: string,
  answers: Record<string, unknown>,
  options?: {
    prefill?: boolean;
    /** The visitor's campaign `utm_*` (the form's own, else the landing's). */
    utm?: Record<string, string>;
    /** fieldName -> value, from `resolveSchedulerPrefill` under `provider: 'dcal'`. */
    customAnswers?: Record<string, string>;
  },
): string {
  const url = new URL(baseUrl);
  url.searchParams.set('embed', '1');
  if (options?.prefill !== false) {
    const { name, email } = extractBookingContactFields(answers);
    setParam(url, 'name', name);
    setParam(url, 'email', email);
    setParam(url, 'notes', String(answers.notes ?? '').trim());
    for (const [field, value] of Object.entries(options?.customAnswers ?? {})) {
      // The field name is the author's, from the event type dCal reported, so
      // it is encoded rather than trusted as a parameter name.
      setParam(url, `answer_${field}`, value);
    }
  }
  setCampaignUtm(url, options?.utm);
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
 * The `calendly.prefill` postMessage payload for a widget that booted BEFORE the
 * answers existed (preloaded hidden, see lib/calendly-preload). It carries what
 * Calendly's own widget script posts from its `prefill` option: the contact
 * fields plus the positional `a1`…`aN` custom answers, flattened to one level.
 * Null when there is nothing to send.
 */
export function calendlyPrefillMessagePayload(
  prefill: CalendlyWidgetPrefill | undefined,
): Record<string, string> | null {
  if (!prefill) return null;
  const payload: Record<string, string> = {};
  if (prefill.name) payload.name = prefill.name;
  if (prefill.firstName) payload.firstName = prefill.firstName;
  if (prefill.lastName) payload.lastName = prefill.lastName;
  if (prefill.email) payload.email = prefill.email;
  for (const [field, value] of Object.entries(prefill.customAnswers ?? {})) {
    if (/^a\d{1,2}$/.test(field) && value) payload[field] = value;
  }
  return Object.keys(payload).length > 0 ? payload : null;
}

/**
 * The final embed URL for an outcome's booking config. Prefill from answers is
 * ON unless the config explicitly opts out (`prefill: false`) — the same
 * default-enabled convention as `cover.enabled` / `reveal.enabled`.
 */
export function buildBookingEmbedUrl(
  booking: OutcomeBooking,
  answers: Record<string, unknown>,
  options: {
    embedDomain?: string;
    /** dCal only: its event type's own questions, keyed by field name. */
    customAnswers?: Record<string, string>;
    /** The visitor's campaign `utm_*`, for the providers that record it. */
    utm?: Record<string, string>;
  } = {},
): string {
  const prefill = booking.prefill !== false;
  const { embedDomain, customAnswers, utm } = options;
  if (booking.provider === 'hubspot_meetings') {
    return buildHubSpotMeetingsUrl(booking.url, answers, { prefill });
  }
  if (booking.provider === 'dcal') {
    return buildDcalEmbedUrl(booking.url, answers, { prefill, customAnswers, utm });
  }
  return buildCalendlyEmbedUrl(booking.url, answers, { prefill, embedDomain, utm });
}
