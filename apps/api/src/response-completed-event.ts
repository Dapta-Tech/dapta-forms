import {
  forwardedUtm,
  isSafeHttpUrl,
  parseFileAnswer,
  publicTitle,
  redirectUrlFor,
  resolveEnding,
  resolveFormLayout,
  type AnswerValue,
  type FormConfig,
  type FormOutcome,
} from '@quill/engine';
import type { SubmissionVisit } from '@quill/types';
import type { AnalyticsProperties } from './analytics-effects';
import { isStaffEmail } from './staff';

/**
 * `forms_response_completed`: one product-analytics event per NEW complete
 * response, so a funnel can start at "a respondent finished this form" and
 * follow the same person to the page the form sent them to.
 *
 * It records THAT a response arrived, never WHO sent it or WHAT it said: no
 * answer, no email, no name, no file, no full page URL, no HubSpot cookie, no
 * address. Everything below is either the owner's own configuration (the form
 * name, the redirect) or a campaign tag the visitor arrived with.
 */

/** The campaign tags read from the answers' `utm` object, and nothing else from it. */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

/** The tags read from the redirect's own query string. */
const REDIRECT_UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;

/**
 * Hidden steps are prefilled from the URL and can carry anything (`?email=`),
 * so only these prefixes are sent: campaign tags, never a person.
 */
const HIDDEN_KEY_PREFIXES = ['utm_', 'ig_'] as const;

/** Longest value kept for any tag. Longer values are cut, not dropped. */
const MAX_TAG_LENGTH = 128;
/** Longest redirect path kept. */
const MAX_PATH_LENGTH = 256;

/** What a well-formed respondent analytics id looks like (any UUID version). */
const ANALYTICS_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ResponseCompletedInput {
  form: { id: string; slug: string; name: string; accountId: string };
  accountCode: string;
  config: FormConfig;
  responseId: string;
  /** The stored answers. Only read for the allowlisted tags and booleans below. */
  data: Record<string, unknown>;
  visit: SubmissionVisit | null | undefined;
  outcome: FormOutcome | null;
  locale: string | null;
  /** The respondent's analytics id as the renderer sent it, already checked by the contract. */
  analyticsId: string | undefined;
  staffDomains: readonly string[] | undefined;
  /** The email the receipt goes to, only to tell staff tests apart. Never sent. */
  respondentEmail: string | null;
}

/** The event: who it is about, its own id, and its properties. */
export interface ResponseCompletedEvent {
  distinctId: string;
  uuid: string;
  properties: AnalyticsProperties;
}

function tag(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_TAG_LENGTH) : null;
}

/** The answers' campaign object as plain strings (what `appendUtm` reads). */
function campaign(data: Record<string, unknown>): Record<string, string> {
  const utm = data.utm;
  if (!utm || typeof utm !== 'object' || Array.isArray(utm)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(utm as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Where this response sends the respondent, computed like the renderer does,
 * with every answer token stripped: the path and query can then only hold what
 * the owner wrote, plus the visitor's UTMs when the form forwards them.
 *
 * An outcome with a booking leaves through its OWN redirect after the visitor
 * books (the renderer never falls back to the form-level ending there), so the
 * same rule applies here.
 */
function redirectOf(config: FormConfig, outcome: FormOutcome | null, utm: Record<string, string>): string | null {
  if (outcome?.booking) {
    const own = outcome.redirectUrl?.trim();
    return own ? redirectUrlFor(own, {}, true, forwardedUtm(config, utm)) : null;
  }
  return resolveEnding(config, outcome, undefined, { embedded: true, utm }).redirectUrl;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase() || null;
  } catch {
    return null;
  }
}

function answered(value: unknown): boolean {
  return parseFileAnswer(value as AnswerValue) !== null;
}

/** True when the renderer's analytics id is one we will use as a distinct id. */
export function isAnalyticsId(value: unknown): value is string {
  return typeof value === 'string' && ANALYTICS_ID_SHAPE.test(value);
}

/**
 * The event for one new complete response. Pure: no I/O, so the caller can run
 * it inside its own guard and never let a bad config fail the submission.
 */
export function responseCompletedEvent(input: ResponseCompletedInput): ResponseCompletedEvent {
  const { config, data, outcome } = input;
  const stitched = isAnalyticsId(input.analyticsId);
  const utm = campaign(data);

  const properties: AnalyticsProperties = {
    form_id: input.form.id,
    form_slug: input.form.slug,
    form_name: publicTitle(config, input.form.name),
    account_code: input.accountCode,
    account_id: input.form.accountId,
    response_id: input.responseId,
  };

  for (const key of UTM_KEYS) {
    const value = tag(utm[key]);
    if (value) properties[key] = value;
  }

  for (const step of config.steps ?? []) {
    if (step.hidden !== true) continue;
    if (!HIDDEN_KEY_PREFIXES.some((prefix) => step.key.startsWith(prefix))) continue;
    const raw = data[step.key];
    const value = tag(typeof raw === 'number' ? String(raw) : raw);
    if (value) properties[`hidden_${step.key}`] = value;
  }

  const redirect = redirectOf(config, outcome, utm);
  if (redirect && isSafeHttpUrl(redirect)) {
    try {
      const url = new URL(redirect);
      properties.redirect_host = url.host.toLowerCase();
      properties.redirect_path = url.pathname.slice(0, MAX_PATH_LENGTH);
      for (const key of REDIRECT_UTM_KEYS) {
        const value = tag(url.searchParams.get(key));
        if (value) properties[`redirect_${key}`] = value;
      }
    } catch {
      /* a redirect that does not parse is reported as none */
    }
  }

  properties.embedded = input.visit?.embedded === true;
  properties.page_host = hostOf(input.visit?.pageUri);
  properties.layout = resolveFormLayout(config);
  properties.outcome_id = outcome?.id ?? null;
  properties.has_booking = Boolean(outcome?.booking);
  properties.has_file_answer = (config.steps ?? []).some(
    (step) => step.type === 'file' && answered(data[step.key]),
  );
  properties.locale = input.locale ?? config.language ?? null;
  properties.respondent_is_staff = isStaffEmail(input.respondentEmail, input.staffDomains);
  properties.stitched = stitched;
  // The address the vendor sees is this server's, so its location would put
  // every respondent in the same data center.
  properties.$geoip_disable = true;
  // Without the renderer's id there is no person to join, and minting one per
  // response would only fill the project with people who never come back.
  if (!stitched) properties.$process_person_profile = false;

  return {
    distinctId: stitched ? input.analyticsId! : `response:${input.responseId}`,
    // The response id is already a UUID, unique per response: the vendor drops a
    // second delivery of the same event, so an outbox retry after a lost reply
    // cannot count one response twice.
    uuid: input.responseId,
    properties,
  };
}
