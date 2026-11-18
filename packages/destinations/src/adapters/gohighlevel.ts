/**
 * Write each submission to a HighLevel (GoHighLevel, GHL) sub-account as a
 * contact, without duplicating the person it belongs to.
 *
 * WHO IS THIS RESPONDENT, ALREADY? GHL decides. `POST /contacts/upsert`
 * matches an existing contact by the sub-account's Contact Duplication
 * Preferences (email, phone) and answers `new: true` when it created one, so
 * a delivery is one upsert and, when the destination has tags, one more call
 * that adds them. Both are safe to repeat: the upsert lands on the same
 * contact by email or phone, and adding a tag the contact already has is a
 * no-op. A retry after either step therefore never duplicates anything.
 *
 * WHAT IS NEVER SENT, because GHL treats it as an instruction rather than a
 * value (all observed on a real sub-account):
 *
 *   `""` or `null`   clears the field (a custom field always, `null` always).
 *                    An empty answer is left out, so it keeps what GHL has.
 *   `tags`           in the upsert REPLACES every tag. Tags go afterwards to
 *                    `POST /contacts/{id}/tags`, which only adds.
 *   `dnd`            not ours to decide.
 *   a non-number     for a NUMERICAL or MONETORY field answers 201 and wipes
 *                    the value (or stores 0). Such an answer is left out.
 *   an unknown key   422s the whole body, so the body is built from a fixed
 *                    list of keys, never from the author's input.
 *
 * FAILURE SEMANTICS. The port says: resolve `delivered:false` for something no
 * retry can fix, THROW for something one might.
 *
 *   401                 the token was revoked or lacks a scope. `onRejected`
 *                       marks the connection, and the delivery is skipped
 *                       with a reason that asks to reconnect.
 *   403 from GHL        the token cannot reach this location. Same.
 *   403 from Cloudflare (`cloudflare_error`, `error_code: 1010`, or a body that
 *                       is not JSON) GHL's edge refused the CLIENT, not the
 *                       token. Thrown, and the connection is never marked.
 *   400, 422            GHL refused a value. Skipped with GHL's own message.
 *   400 "Contact not found" on the tags call
 *                       the contact was deleted between the two calls. Thrown:
 *                       the retry upserts it again.
 *   408, 409, 429, 5xx, network, timeout
 *                       transient. Thrown, so the outbox backs off.
 */
import {
  GOHIGHLEVEL_REASONS,
  GOHIGHLEVEL_VALUE_KIND,
  goHighLevelSlotAccepts,
  isGoHighLevelMappableDataType,
  type GoHighLevelCustomFieldTarget,
  type GoHighLevelDeliveryOptions,
  type GoHighLevelDeliveryOutcome,
  type GoHighLevelFieldTarget,
  type GoHighLevelMappingSlot,
  type GoHighLevelStandardFieldKey,
} from '@quill/types';
import type {
  DeliveryTranscript,
  DestinationContext,
  DestinationResult,
  SubmissionDestination,
} from '../destination.port';
import { dayMidnightMs } from '../day';

/** Every call goes here. */
export const GOHIGHLEVEL_API_BASE = 'https://services.leadconnectorhq.com';

/** The `Version` header. Without one GHL answers 401. */
export const GOHIGHLEVEL_API_VERSION = 'v3';

/**
 * Sent on every call. GHL sits behind Cloudflare, which refuses the default
 * agents of HTTP libraries with a 403 (`error_code: 1010`) that reads like a
 * refused token.
 */
export const GOHIGHLEVEL_USER_AGENT = 'dForms/1.0 (+https://dforms.ai)';

/**
 * The headers every GHL call carries. Exported so the API's connect probe and
 * fields service speak to GHL exactly as a delivery does.
 */
export function goHighLevelHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    version: GOHIGHLEVEL_API_VERSION,
    accept: 'application/json',
    'content-type': 'application/json',
    'user-agent': GOHIGHLEVEL_USER_AGENT,
  };
}

/** Give up on a GHL call that never settles, so one delivery cannot wedge a lane. */
export const DEFAULT_GOHIGHLEVEL_TIMEOUT_MS = 15_000;

/** How much of GHL's error message is kept for the delivery history. */
const MAX_DETAIL = 500;

/** Statuses a retry can fix even though they are 4xx. */
const TRANSIENT_STATUSES = new Set([408, 409, 425, 429]);

/** A GHL call that failed in a way a retry might fix. */
export class GoHighLevelHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string | null,
    readonly requestBody?: string,
  ) {
    super(message);
    this.name = 'GoHighLevelHttpError';
  }
}

// --- Values ------------------------------------------------------------------

/** Same shape test as the Salesforce adapter: linear, and capped at SMTP's 254. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const looksLikeEmail = (value: string): boolean => value.length <= 254 && EMAIL_RE.test(value);

/** One answer as trimmed text, a list joined with `, `; undefined when empty. */
function asText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const parts = value.map((v) => asText(v)).filter((v): v is string => v !== undefined);
    return parts.length ? parts.join(', ') : undefined;
  }
  if (typeof value === 'object') return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

/**
 * A phone number as GHL should receive it, or undefined when it is not one.
 *
 * An international number (`+57 318 000 0000`, `0057...`) becomes E.164
 * (`+573180000000`), which is what the phone question stores already. A
 * number typed without its country (`(202) 555-0143`) goes as its bare digits:
 * GHL reads those in the sub-account's own country (`+12025550143`), which is
 * the only country hint there is. Putting a `+` in front instead would turn
 * that US number into an Egyptian one. Letters, or fewer than 7 or more than
 * 15 digits, are not a phone number, and are left out.
 */
export function toGoHighLevelPhone(value: unknown): string | undefined {
  const text = asText(value);
  if (text === undefined || /[a-z]/i.test(text)) return undefined;
  let digits = text.replace(/\D/g, '');
  let international = text.startsWith('+');
  if (!international && digits.startsWith('00')) {
    digits = digits.slice(2);
    international = true;
  }
  if (digits.length < 7 || digits.length > 15) return undefined;
  return international ? `+${digits}` : digits;
}

/**
 * A number, or undefined. Only plain decimals (`42`, `-3.75`, `1,234.50`)
 * count: `Number()` alone would also take `0x10`, `1e3` and `""` (as 0), and a
 * value GHL cannot read as a number clears the field.
 */
export function toGoHighLevelNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  let text = value.trim();
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, '');
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

const isoDay = (epochMs: number, timezone?: string): string =>
  new Date(dayMidnightMs(epochMs, timezone)).toISOString().slice(0, 10);

/**
 * A calendar day as `YYYY-MM-DD`, or undefined. A bare day is kept as typed
 * (after checking it exists); an instant (`2026-11-18T03:00:00Z`, epoch ms) is
 * named in `timezone`, because GHL would otherwise cut the ISO string at its
 * UTC date. Anything else (`11/18/2026`, which could be either order) is left
 * out.
 */
export function toGoHighLevelDay(value: unknown, timezone?: string): string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? isoDay(value, timezone) : undefined;
  const text = asText(value);
  if (text === undefined) return undefined;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (day) {
    const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
    const at = new Date(Date.UTC(y, m - 1, d));
    const real = at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
    return real ? text : undefined;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? isoDay(ms, timezone) : undefined;
  }
  return undefined;
}

/** A standard field's value, as the upsert takes it. */
function standardValue(
  field: GoHighLevelStandardFieldKey,
  value: unknown,
  timezone?: string,
): string | undefined {
  switch (field) {
    case 'phone':
      return toGoHighLevelPhone(value);
    case 'email': {
      const text = asText(value);
      return text !== undefined && looksLikeEmail(text) ? text : undefined;
    }
    case 'dateOfBirth':
      return toGoHighLevelDay(value, timezone);
    default:
      return asText(value);
  }
}

/**
 * A custom field's value in the shape its type takes, or undefined to leave
 * it out (empty, unparseable for the type, or a type the upsert does not
 * take).
 */
export function goHighLevelCustomValue(
  dataType: string,
  value: unknown,
  timezone?: string,
): string | number | string[] | undefined {
  if (!isGoHighLevelMappableDataType(dataType)) return undefined;
  if (dataType === 'PHONE') return toGoHighLevelPhone(value);
  switch (GOHIGHLEVEL_VALUE_KIND[dataType]) {
    case 'number':
      return toGoHighLevelNumber(value);
    case 'date':
      return toGoHighLevelDay(value, timezone);
    case 'options': {
      // Always a list: a comma inside one choice's label would split a joined string.
      const list = (Array.isArray(value) ? value : [value])
        .map((v) => asText(v))
        .filter((v): v is string => v !== undefined);
      return list.length ? list : undefined;
    }
    default:
      return asText(value);
  }
}

// --- The request body --------------------------------------------------------

/** The standard keys the upsert body may carry, besides `locationId` and `source`. */
type StandardValues = Partial<Record<GoHighLevelStandardFieldKey, string>>;

export interface GoHighLevelUpsertBody extends StandardValues {
  locationId: string;
  source: string;
  customFields?: Array<{ id: string; fieldValue: string | number | string[] }>;
}

export class GoHighLevelDestination implements SubmissionDestination {
  readonly type = 'gohighlevel' as const;

  constructor(
    private readonly options: GoHighLevelDeliveryOptions,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** The type a custom field has NOW (the fields cache), else the one stored on the mapping. */
  private typeOf(target: GoHighLevelCustomFieldTarget): string {
    return this.options.customFieldTypes?.[target.id] ?? target.dataType;
  }

  /**
   * The upsert body for one submission (pure; exported shape for tests).
   *
   * Precedence when two sources write one field, highest first: the field
   * mappings, the UTMs, the submitted date and the score; then the fixed
   * values, which only fill a field nothing else wrote, so a constant never
   * overwrites what the respondent answered. Only a value that is actually
   * sent claims its field: an empty answer leaves it free for the next source.
   *
   * The full name is the one standard field that gathers: a `name` question
   * stores its parts flat (`firstname`, `lastname`), and mapping both to
   * `name` should read "Sam Rivera", not just "Sam".
   */
  buildBody(ctx: DestinationContext): GoHighLevelUpsertBody {
    const tz = this.options.dayTimezone;
    const standard: StandardValues = {};
    const nameParts: string[] = [];
    const custom = new Map<string, string | number | string[]>();

    const put = (
      target: GoHighLevelFieldTarget,
      slot: GoHighLevelMappingSlot,
      value: unknown,
      gather = false,
    ): void => {
      if (target.kind === 'standard') {
        const typed = standardValue(target.field, value, tz);
        if (typed === undefined) return;
        if (target.field === 'name' && gather) nameParts.push(typed);
        else if (!(target.field in standard) && !(target.field === 'name' && nameParts.length)) {
          standard[target.field] = typed;
        }
        return;
      }
      const id = target.id.trim();
      if (!id || custom.has(id)) return;
      const dataType = this.typeOf(target);
      // A field whose type no longer suits the slot (changed in GHL since the
      // mapping was saved) gets nothing, rather than a value it would mangle.
      if (!goHighLevelSlotAccepts(slot, dataType)) return;
      const typed = goHighLevelCustomValue(dataType, value, tz);
      if (typed !== undefined) custom.set(id, typed);
    };

    for (const [stepKey, targets] of Object.entries(this.options.fieldMappings ?? {})) {
      for (const target of targets ?? []) put(target, 'field', ctx.data?.[stepKey], true);
    }
    if (nameParts.length && standard.name === undefined) standard.name = nameParts.join(' ');

    for (const [utmKey, target] of Object.entries(this.options.utmMappings ?? {})) {
      if (target) put(target, 'utm', ctx.utm?.[utmKey]);
    }
    if (this.options.dateField) put(this.options.dateField, 'date', ctx.submittedAt);
    if (this.options.scoreField) put(this.options.scoreField, 'score', ctx.score);
    for (const entry of this.options.staticFields ?? []) {
      if (entry?.target) put(entry.target, 'field', entry.value);
    }

    // Email is the respondent's own: the mapped answer, else a raw `email`
    // answer, the same fallback the Salesforce and HubSpot adapters keep.
    if (standard.email === undefined) {
      const fallback = standardValue('email', ctx.data?.email);
      if (fallback) standard.email = fallback;
    }

    const body: GoHighLevelUpsertBody = {
      locationId: this.options.credentials.locationId,
      ...standard,
      source: this.options.source?.trim() || `dForms: ${ctx.formName}`,
    };
    if (custom.size) body.customFields = [...custom].map(([id, fieldValue]) => ({ id, fieldValue }));
    return body;
  }

  /** The tags to add: trimmed, without blanks, once each however they are cased. */
  private tags(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of this.options.tags ?? []) {
      const tag = typeof raw === 'string' ? raw.trim() : '';
      if (!tag || seen.has(tag.toLowerCase())) continue;
      seen.add(tag.toLowerCase());
      out.push(tag);
    }
    return out;
  }

  private async call(
    path: string,
    body: string,
  ): Promise<
    | { ok: true; status: number; body: unknown }
    | { ok: false; outcome: GoHighLevelDeliveryOutcome; status: number; text: string | null }
  > {
    let res: Response;
    try {
      res = await this.fetchImpl(`${GOHIGHLEVEL_API_BASE}${path}`, {
        method: 'POST',
        headers: goHighLevelHeaders(this.options.credentials.token),
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_GOHIGHLEVEL_TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new GoHighLevelHttpError(`gohighlevel delivery failed: ${message}`, 0, null, body);
    }
    const raw = await res.text().catch(() => '');
    let parsed: unknown = null;
    let json = false;
    try {
      parsed = raw ? JSON.parse(raw) : null;
      json = parsed !== null && typeof parsed === 'object';
    } catch {
      parsed = null;
    }
    if (res.ok) return { ok: true, status: res.status, body: parsed };

    const text = errorText(parsed, raw);
    const fail = (): never => {
      throw new GoHighLevelHttpError(`gohighlevel delivery failed: HTTP ${res.status}`, res.status, text, body);
    };
    if (res.status === 401 || res.status === 403) {
      // Cloudflare's edge, not GHL: it refused this client (its agent, its
      // address), which says nothing about the token. Never mark the connection.
      if (res.status === 403 && (!json || isCloudflare(parsed))) fail();
      await this.reject(res.status);
      const reason = res.status === 401 ? GOHIGHLEVEL_REASONS.tokenRejected : GOHIGHLEVEL_REASONS.locationForbidden;
      return { ok: false, outcome: { action: 'skipped', reason }, status: res.status, text };
    }
    if (res.status >= 500 || TRANSIENT_STATUSES.has(res.status)) fail();
    const reason = `HTTP ${res.status}${text ? `: ${text}` : ''}`;
    return { ok: false, outcome: { action: 'skipped', reason }, status: res.status, text };
  }

  /** Tell the API the connection was refused. Best effort: marking it must not turn a skip into a retry. */
  private async reject(status: 401 | 403): Promise<void> {
    try {
      await Promise.resolve(this.options.onRejected?.(status));
    } catch {
      // The delivery is still skipped with the reconnect reason.
    }
  }

  async deliver(ctx: DestinationContext): Promise<DestinationResult> {
    const upsert = this.buildBody(ctx);
    if (!upsert.email && !upsert.phone) {
      // GHL cannot match anybody without one of the two, and a contact nobody
      // can find again is worse than none. Done, with the reason, no request.
      return goHighLevelResult({ action: 'skipped', reason: GOHIGHLEVEL_REASONS.noEmailOrPhone });
    }
    const requestBody = JSON.stringify(upsert);
    const out = await this.call('/contacts/upsert', requestBody);
    if (!out.ok) {
      return goHighLevelResult(out.outcome, { requestBody, responseStatus: out.status, responseBody: out.text });
    }
    const reply = out.body as { new?: unknown; contact?: { id?: unknown } } | null;
    const contactId = typeof reply?.contact?.id === 'string' ? reply.contact.id : '';
    if (!contactId) {
      // A success with no contact cannot be tagged or reported. The upsert is
      // idempotent, so asking again is safe.
      throw new GoHighLevelHttpError(
        'gohighlevel delivery failed: upsert answered without a contact id',
        out.status,
        null,
        requestBody,
      );
    }

    const tags = this.tags();
    if (tags.length) {
      const tagged = await this.call(`/contacts/${encodeURIComponent(contactId)}/tags`, JSON.stringify({ tags }));
      if (!tagged.ok) {
        // Deleted between the two calls: the retry upserts it again.
        if (tagged.status === 400 && /contact not found/i.test(tagged.text ?? '')) {
          throw new GoHighLevelHttpError(
            'gohighlevel delivery failed: contact vanished before its tags',
            400,
            tagged.text,
            requestBody,
          );
        }
        return goHighLevelResult(tagged.outcome, {
          requestBody,
          responseStatus: tagged.status,
          responseBody: tagged.text,
        });
      }
    }

    return goHighLevelResult(
      { action: reply?.new === true ? 'created' : 'updated', contactId },
      { requestBody, responseStatus: out.status, responseBody: contactId },
    );
  }
}

/** One delivery's outcome as the port reports it. */
export function goHighLevelResult(
  outcome: GoHighLevelDeliveryOutcome,
  transcript: DeliveryTranscript = {},
): DestinationResult {
  if (outcome.action === 'skipped') {
    return { delivered: false, driver: 'gohighlevel', detail: outcome.reason, ...transcript };
  }
  return {
    delivered: true,
    driver: 'gohighlevel',
    detail: `${outcome.action} contact ${outcome.contactId}`,
    ...transcript,
  };
}

/** Cloudflare's JSON refusal (`cloudflare_error: true`, `error_code: 1010`), not GHL's. */
function isCloudflare(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as { cloudflare_error?: unknown; error_code?: unknown };
  return b.cloudflare_error === true || b.error_code !== undefined;
}

/**
 * GHL's error message, shortened: `{ statusCode, message, error? }`, where a
 * 422's `message` is a list (joined with `; `). A body that is not JSON is
 * kept as text.
 */
function errorText(parsed: unknown, raw: string): string | null {
  if (parsed && typeof parsed === 'object') {
    const message = (parsed as { message?: unknown }).message;
    if (Array.isArray(message)) {
      const parts = message.map((m) => String(m).trim()).filter(Boolean);
      if (parts.length) return parts.join('; ').slice(0, MAX_DETAIL);
    }
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, MAX_DETAIL);
    try {
      return JSON.stringify(parsed).slice(0, MAX_DETAIL);
    } catch {
      return null;
    }
  }
  return raw.trim() ? raw.trim().slice(0, MAX_DETAIL) : null;
}
