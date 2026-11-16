/**
 * Write each complete submission to a Salesforce org, without duplicating the
 * person it belongs to.
 *
 * WHO IS THIS RESPONDENT, ALREADY? Salesforce has no upsert by email: `Email`
 * is not an External ID on Lead or Contact, so the only safe sequence is to
 * look first and write second.
 *
 *   1. A Contact with this email (the most recently modified one) is updated.
 *      A converted Lead lives on as a Contact, and creating a fresh Lead for
 *      somebody sales already converted is the duplicate this exists to avoid.
 *   2. Otherwise an UNCONVERTED Lead with this email is updated.
 *   3. Otherwise a new Lead is created.
 *
 * Every mapping names a LEAD field. On a Contact only the mapped fields that
 * also exist on Contact are written, because one Lead-only field (`Company`,
 * `LeadSource`, a `__c` that lives only on Lead) would otherwise fail the
 * whole update with INVALID_FIELD.
 *
 * Retries are idempotent by construction rather than by a key: every attempt
 * looks the respondent up again before creating. A POST that landed but whose
 * answer was lost (a timeout, a dead socket) is found on the next attempt and
 * PATCHed, instead of minted twice. What this cannot prevent is two DIFFERENT
 * submissions from one email arriving at the same instant on two workers: both
 * look, both find nothing, both create. Without an External ID on Email that
 * race is inherent, and an org's own duplicate rules are what closes it.
 *
 * The credential is a short-lived ACCESS token plus the org's instance URL,
 * both injected by the API layer, which holds the Client Credentials and
 * redeems them. Nothing about OAuth lives in this package, the same split the
 * Google Sheets adapter keeps, so the factory can still degrade an adapter
 * with no token to a log-only no-op.
 *
 * FAILURE SEMANTICS. The port says: resolve `delivered:false` for something no
 * retry can fix, THROW for something one might.
 *
 *   400 validation errors   the org's rules refused the record (a required
 *                           field, a validation rule, a duplicate rule, a
 *                           restricted picklist). Resolved with Salesforce's own
 *                           message, so the author can fix the mapping.
 *   401                     the token is no longer honoured. `onUnauthorized`
 *                           drops the cached one and this THROWS, so the retry
 *                           mints a fresh token; if the org has revoked the app,
 *                           that mint is refused and the factory degrades.
 *   403 REQUEST_LIMIT_EXCEEDED, 429, 5xx, network   transient. These throw.
 *   other 403 / 404         the Run As user cannot see the object or the
 *                           field. Resolved: waiting does not grant a permission.
 */
import { propertiesFor } from '@quill/types';
import type {
  DestinationContext,
  DestinationResult,
  SubmissionDestination,
} from '../destination.port';
import { dayMidnightMs } from '../day';

/**
 * The REST API version this adapter speaks, pinned so a new Salesforce release
 * cannot change what a delivery does. v62.0 is Summer '24, supported by every
 * org that can run Client Credentials at all.
 */
export const SALESFORCE_API_VERSION = 'v62.0';

/** Give up on a Salesforce call that never settles, so one delivery cannot wedge a lane. */
export const DEFAULT_SALESFORCE_TIMEOUT_MS = 15_000;

/** How much of Salesforce's error body is kept for the delivery history. */
const MAX_DETAIL = 500;

/** Stand-in for a required Lead field the form did not supply. Salesforce's own convention. */
export const SALESFORCE_NOT_PROVIDED = '[not provided]';

export interface SalesforceDestinationOptions {
  /** A live access token minted by the API layer. Empty: the factory degrades. */
  accessToken: string;
  /** The org's instance URL from the token response, e.g. `https://acme.my.salesforce.com`. */
  instanceUrl: string;
  /** stepKey -> one Lead field or several. */
  fieldMappings: Record<string, string | string[]>;
  utmMappings?: Record<string, string>;
  scoreField?: string;
  dateField?: string;
  dayTimezone?: string;
  staticFields?: Record<string, string>;
  /**
   * Lead and Contact fields by API name -> Salesforce type (`string`, `date`,
   * `datetime`, `double`, `boolean`, `multipicklist`...), from the org's
   * describe. Absent = unknown: values go as strings, a date field as a day,
   * and a Contact receives every mapped field.
   */
  leadFields?: Record<string, string>;
  contactFields?: Record<string, string>;
  /** Called on a 401, before throwing, so the next attempt mints a new token. */
  onUnauthorized?: () => void;
  timeoutMs?: number;
}

/** A Salesforce call that failed in a way a retry might fix. */
export class SalesforceHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string | null,
    readonly requestBody?: string,
  ) {
    super(message);
    this.name = 'SalesforceHttpError';
  }
}

/**
 * Personal / free-mail domains, where a company name inferred from the domain
 * would be noise. Mirrors the HubSpot adapter's list and the engine's
 * `isPersonalEmail`; keep the three in sync.
 */
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
  'icloud.com',
  'live.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);
const FREE_EMAIL_BASES = new Set([
  'gmail',
  'hotmail',
  'outlook',
  'yahoo',
  'icloud',
  'live',
  'aol',
  'msn',
  'proton',
  'protonmail',
]);

/** A company name from a CORPORATE email's domain, or null. Exported for tests. */
export function companyFromEmail(email: string): string | null {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain.includes('.')) return null;
  const base = domain.split('.')[0] ?? '';
  if (!base || PERSONAL_EMAIL_DOMAINS.has(domain) || FREE_EMAIL_BASES.has(base)) return null;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Quote a value for a SOQL string literal. Backslash first, then the single
 * quote, which is how SOQL escapes both. An email is checked to look like one
 * before it gets here, but the escape does not rely on that.
 */
export function soqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMERIC_TYPES = new Set(['double', 'currency', 'percent', 'int', 'long']);

/** Case-insensitive lookup of a field's type: Salesforce API names are case-insensitive. */
function typeOf(fields: Record<string, string> | undefined, name: string): string | undefined {
  if (!fields) return undefined;
  if (name in fields) return fields[name];
  const lower = name.toLowerCase();
  for (const [key, type] of Object.entries(fields)) if (key.toLowerCase() === lower) return type;
  return undefined;
}

/**
 * One answer as the JSON value its field accepts.
 *
 * Numbers and checkboxes are sent as JSON numbers and booleans when the
 * describe says so, because Salesforce rejects `"5"` for a number field rather
 * than coercing it. A multi-select answer is joined with `;`, the separator a
 * multipicklist expects. Anything unparseable for its type is dropped rather
 * than sent, so one odd answer does not fail the record.
 */
export function fieldValue(value: unknown, type: string | undefined): unknown {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const parts = value.map((v) => String(v).trim()).filter(Boolean);
    return parts.length ? parts.join(';') : undefined;
  }
  const text = typeof value === 'string' ? value.trim() : String(value);
  if (text === '') return undefined;
  if (type && NUMERIC_TYPES.has(type)) {
    const n = Number(text);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    const lower = text.toLowerCase();
    if (['true', 'yes', 'sí', 'si', '1'].includes(lower)) return true;
    if (['false', 'no', '0'].includes(lower)) return false;
    return undefined;
  }
  return text;
}

/** Salesforce's error envelope (an array of `{ errorCode, message, fields }`), shortened. */
function errorDetail(body: unknown): { code: string | null; text: string | null } {
  if (Array.isArray(body) && body.length) {
    const first = body[0] as { errorCode?: unknown; message?: unknown; fields?: unknown };
    const code = typeof first.errorCode === 'string' ? first.errorCode : null;
    const message = typeof first.message === 'string' ? first.message : '';
    const fields = Array.isArray(first.fields) && first.fields.length ? ` [${first.fields.join(', ')}]` : '';
    const text = `${code ?? 'ERROR'}: ${message}${fields}`.slice(0, MAX_DETAIL);
    return { code, text };
  }
  if (typeof body === 'string') return { code: null, text: body.slice(0, MAX_DETAIL) || null };
  try {
    return { code: null, text: body == null ? null : JSON.stringify(body).slice(0, MAX_DETAIL) };
  } catch {
    return { code: null, text: null };
  }
}

/**
 * Error codes Salesforce answers with a 4xx that a retry CAN fix: the org's
 * API limit, lock contention from a trigger or flow touching the same record,
 * a query that timed out. Treated like a 5xx, so the outbox backs off and tries
 * again instead of dropping the respondent.
 */
const TRANSIENT_CODES = new Set([
  'REQUEST_LIMIT_EXCEEDED',
  'UNABLE_TO_LOCK_ROW',
  'QUERY_TIMEOUT',
  'SERVER_UNAVAILABLE',
]);

/**
 * Codes that mean the record a lookup found is gone or changed shape before
 * the write: deleted, merged away, or converted. A retry runs the lookup again
 * and lands on whatever the respondent is now, so these are retried too.
 */
const RECORD_MOVED_CODES = new Set(['ENTITY_IS_DELETED', 'CANNOT_UPDATE_CONVERTED_LEAD', 'NOT_FOUND']);

/**
 * A Contact lookup the Run As user is not allowed to make. Lead-only
 * integration users are a reasonable setup, so this means "no Contact to
 * match", not "every delivery fails".
 */
const NO_CONTACT_ACCESS_CODES = new Set(['INVALID_TYPE', 'INSUFFICIENT_ACCESS', 'INSUFFICIENT_ACCESS_OR_READONLY']);

/** A failed answer Salesforce will give the same way however often it is asked. */
function isPermanent(status: number, code: string | null): boolean {
  if (code && TRANSIENT_CODES.has(code)) return false;
  return status === 400 || status === 403 || status === 404;
}

type Failure = DestinationResult & { code: string | null };
type Outcome = { ok: true; status: number; body: unknown } | Failure;

export class SalesforceDestination implements SubmissionDestination {
  readonly type = 'salesforce' as const;

  constructor(
    private readonly options: SalesforceDestinationOptions,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** The respondent's email: the answer mapped to `Email`, else a raw `email` answer. */
  resolveEmail(ctx: DestinationContext): string | null {
    for (const [stepKey, target] of Object.entries(this.options.fieldMappings ?? {})) {
      if (!propertiesFor(target).some((f) => f.toLowerCase() === 'email')) continue;
      const raw = ctx.data?.[stepKey];
      if (typeof raw === 'string' && EMAIL_RE.test(raw.trim())) return raw.trim();
    }
    const fallback = ctx.data?.email;
    if (typeof fallback === 'string' && EMAIL_RE.test(fallback.trim())) return fallback.trim();
    return null;
  }

  /**
   * The Lead fields this submission writes, as sent (pure, exported shape for
   * tests). Precedence, highest first: field mappings, UTMs, date and score,
   * then static values, which only fill holes so a constant can never
   * overwrite what the respondent actually answered.
   */
  buildFields(ctx: DestinationContext): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const lead = this.options.leadFields;
    const set = (name: string, value: unknown) => {
      const field = name.trim();
      if (!field) return;
      const typed = fieldValue(value, typeOf(lead, field));
      if (typed !== undefined) out[field] = typed;
    };

    for (const [stepKey, target] of Object.entries(this.options.fieldMappings ?? {})) {
      for (const field of propertiesFor(target)) set(field, ctx.data?.[stepKey]);
    }
    for (const [utmKey, field] of Object.entries(this.options.utmMappings ?? {})) {
      if (field) set(field, ctx.utm?.[utmKey]);
    }

    const dateField = this.options.dateField?.trim();
    if (dateField) {
      // A `datetime` field keeps the instant; a `date` field, or one whose type
      // is unknown, gets the calendar day in the author's zone, which is the
      // only value a date field cannot reject.
      out[dateField] =
        typeOf(lead, dateField) === 'datetime'
          ? new Date(ctx.submittedAt).toISOString()
          : new Date(dayMidnightMs(ctx.submittedAt, this.options.dayTimezone)).toISOString().slice(0, 10);
    }
    const scoreField = this.options.scoreField?.trim();
    if (scoreField) {
      const typed = fieldValue(ctx.score, typeOf(lead, scoreField) ?? 'double');
      if (typed !== undefined) out[scoreField] = typed;
    }

    for (const [field, value] of Object.entries(this.options.staticFields ?? {})) {
      const name = field.trim();
      if (name && !(name in out)) set(name, value);
    }
    return out;
  }

  /**
   * What a Contact can take of the Lead fields: only those that exist on
   * Contact, by the org's describe. Email is always kept. With no describe,
   * everything goes, and the org decides.
   */
  private forContact(fields: Record<string, unknown>): Record<string, unknown> {
    const contact = this.options.contactFields;
    if (!contact) return fields;
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(fields)) {
      if (name.toLowerCase() === 'email' || typeOf(contact, name) !== undefined) out[name] = value;
    }
    return out;
  }

  private async call(
    method: string,
    path: string,
    body?: string,
    /** Codes to throw on (retry) even though their status reads as permanent. */
    retryCodes?: ReadonlySet<string>,
  ): Promise<Outcome> {
    const url = `${this.options.instanceUrl.replace(/\/+$/, '')}/services/data/${SALESFORCE_API_VERSION}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${this.options.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_SALESFORCE_TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SalesforceHttpError(`salesforce delivery failed: ${message}`, 0, null, body);
    }
    // 204 (a PATCH) has no body; reading it as JSON is a null, not an error.
    const parsed = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.ok) return { ok: true, status: res.status, body: parsed };

    const { code, text } = errorDetail(parsed);
    if (res.status === 401) {
      this.options.onUnauthorized?.();
      throw new SalesforceHttpError('salesforce delivery failed: HTTP 401', 401, text, body);
    }
    const retryable = code !== null && retryCodes?.has(code) === true;
    if (!retryable && isPermanent(res.status, code)) {
      return {
        code,
        delivered: false,
        driver: 'salesforce',
        detail: `HTTP ${res.status}${text ? `: ${text}` : ''}`,
        requestBody: body,
        responseStatus: res.status,
        responseBody: text,
      };
    }
    throw new SalesforceHttpError(`salesforce delivery failed: HTTP ${res.status}`, res.status, text, body);
  }

  /**
   * The first record a SOQL query returns, by Id, or null. `tolerate` lists
   * refusal codes that mean "nothing to find here" rather than a failure.
   */
  private async findId(
    soql: string,
    tolerate?: ReadonlySet<string>,
  ): Promise<{ id: string | null } | DestinationResult> {
    const out = await this.call('GET', `/query?q=${encodeURIComponent(soql)}`);
    if (!('ok' in out)) {
      if (out.code && tolerate?.has(out.code)) return { id: null };
      return strip(out);
    }
    const records = (out.body as { records?: Array<{ Id?: unknown }> } | null)?.records ?? [];
    const id = records[0]?.Id;
    return { id: typeof id === 'string' && id ? id : null };
  }

  async deliver(ctx: DestinationContext): Promise<DestinationResult> {
    const email = this.resolveEmail(ctx);
    if (!email) {
      // Nothing to look the respondent up by, and a record nobody can find
      // again is worse than no record. Done, with the reason.
      return { delivered: false, driver: 'salesforce', detail: 'no email in submission' };
    }
    // One Email key, spelled the way Salesforce spells it, whatever case the
    // author's mapping used: two spellings in one body is a DUPLICATE_VALUE.
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.buildFields(ctx))) {
      if (key.toLowerCase() !== 'email') fields[key] = value;
    }
    fields.Email = email;

    const contact = await this.findId(
      `SELECT Id FROM Contact WHERE Email = ${soqlString(email)} ORDER BY LastModifiedDate DESC LIMIT 1`,
      NO_CONTACT_ACCESS_CODES,
    );
    if (!('id' in contact)) return contact;
    if (contact.id) return this.update('Contact', contact.id, this.forContact(fields));

    const lead = await this.findId(
      `SELECT Id FROM Lead WHERE Email = ${soqlString(email)} AND IsConverted = false ORDER BY LastModifiedDate DESC LIMIT 1`,
    );
    if (!('id' in lead)) return lead;
    if (lead.id) return this.update('Lead', lead.id, fields);

    // A new Lead needs LastName and Company, and Salesforce refuses the record
    // without them. Fill only what is missing: a company from a corporate
    // email's domain, else Salesforce's own "[not provided]".
    const create: Record<string, unknown> = { ...fields };
    if (!hasValue(create, 'LastName')) create.LastName = SALESFORCE_NOT_PROVIDED;
    if (!hasValue(create, 'Company')) create.Company = companyFromEmail(email) ?? SALESFORCE_NOT_PROVIDED;
    const body = JSON.stringify(create);
    const out = await this.call('POST', '/sobjects/Lead', body);
    if (!('ok' in out)) return strip(out);
    const id = (out.body as { id?: unknown } | null)?.id;
    return {
      delivered: true,
      driver: 'salesforce',
      detail: `created Lead ${typeof id === 'string' ? id : ''}`.trim(),
      requestBody: body,
      responseStatus: out.status,
      responseBody: typeof id === 'string' ? id : null,
    };
  }

  private async update(
    object: 'Lead' | 'Contact',
    id: string,
    fields: Record<string, unknown>,
  ): Promise<DestinationResult> {
    const body = JSON.stringify(fields);
    // A record that vanished or was converted between the lookup and this
    // write is retried: the next attempt looks the respondent up again.
    const out = await this.call(
      'PATCH',
      `/sobjects/${object}/${encodeURIComponent(id)}`,
      body,
      RECORD_MOVED_CODES,
    );
    if (!('ok' in out)) return strip(out);
    return {
      delivered: true,
      driver: 'salesforce',
      detail: `updated ${object} ${id}`,
      requestBody: body,
      responseStatus: out.status,
      responseBody: id,
    };
  }
}

/** A failure as the port reports it, without the classification code. */
function strip(failure: Failure): DestinationResult {
  const { code: _code, ...result } = failure;
  return result;
}

function hasValue(fields: Record<string, unknown>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.entries(fields).some(
    ([key, value]) => key.toLowerCase() === lower && value !== undefined && String(value).trim() !== '',
  );
}
