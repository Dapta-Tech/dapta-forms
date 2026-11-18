/**
 * The connected location's contact custom fields: for the mapping UI, and for
 * the delivery path, which converts a value by the field's type as the
 * location reports it NOW (a field retyped in GHL must not get the old shape).
 *
 * Cached per ACCOUNT for five minutes, like Salesforce's and HubSpot's lists,
 * and never one shared map: picklist options are a sub-account's own data.
 * The cache entry remembers which connection it was read with, so a reconnect
 * or a disconnect handled by another API pod is noticed on the next read.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Db } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import {
  GOHIGHLEVEL_STANDARD_FIELDS,
  isGoHighLevelMappableDataType,
  type GoHighLevelCredentials,
  type GoHighLevelCustomFieldDto,
  type GoHighLevelFieldsResponse,
  type GoHighLevelFieldTypes,
  type GoHighLevelStandardFieldDto,
} from '@quill/types';
import { GOHIGHLEVEL_API_BASE, goHighLevelHeaders } from '@quill/destinations';
import { classifyGoHighLevelError, goHighLevelFingerprint, readGoHighLevelConnection } from './gohighlevel-api';
import { DB, ENV } from './tokens';

const FIELDS_CACHE_MS = 5 * 60_000;
const LIST_TIMEOUT_MS = 10_000;
/**
 * How long a delivery skips the read after one failed. During an outage or
 * with a refused token, every queued delivery would otherwise wait for the
 * same failing call before its own upsert, spending the location's rate
 * limit twice. The mapping UI's list is not held back by it.
 */
const TYPES_RETRY_MS = 60_000;
/** A delivery waits less than the mapping UI for the types: they have a fallback. */
const TYPES_TIMEOUT_MS = 5_000;

/** One item of `GET /locations/{id}/customFields`, as far as dForms reads it. */
interface GhlCustomField {
  id?: unknown;
  name?: unknown;
  fieldKey?: unknown;
  dataType?: unknown;
  model?: unknown;
  picklistOptions?: unknown;
}

interface Loaded {
  custom: GoHighLevelCustomFieldDto[];
  /** Every field's reported type, mappable or not (a retyped field must be left out). */
  types: GoHighLevelFieldTypes;
}

/** The standard catalog, as the route lists it. */
export const GOHIGHLEVEL_STANDARD_FIELD_DTOS: GoHighLevelStandardFieldDto[] = GOHIGHLEVEL_STANDARD_FIELDS.map(
  (f) => ({ kind: 'standard', key: f.key, name: f.name, sources: f.sources }),
);

function optionsOf(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .map((o) => {
      if (typeof o === 'string') return o;
      if (o && typeof o === 'object') {
        const v = (o as { label?: unknown; value?: unknown }).label ?? (o as { value?: unknown }).value;
        return typeof v === 'string' ? v : null;
      }
      return null;
    })
    .filter((o): o is string => typeof o === 'string' && o.trim() !== '');
  return out.length ? out : undefined;
}

function toLoaded(items: GhlCustomField[]): Loaded {
  const custom: GoHighLevelCustomFieldDto[] = [];
  const types: GoHighLevelFieldTypes = {};
  for (const f of items) {
    const id = typeof f.id === 'string' ? f.id : '';
    if (!id) continue;
    // `?model=contact` already filters; an item that says otherwise is not a contact field.
    if (f.model !== undefined && f.model !== 'contact') continue;
    if (typeof f.dataType === 'string') types[id] = f.dataType;
    if (!isGoHighLevelMappableDataType(f.dataType)) continue;
    const key = typeof f.fieldKey === 'string' ? f.fieldKey : '';
    const name = typeof f.name === 'string' && f.name.trim() ? f.name.trim() : key || id;
    const dto: GoHighLevelCustomFieldDto = { kind: 'custom', id, key, name, dataType: f.dataType };
    const options = optionsOf(f.picklistOptions);
    if (options && ['SINGLE_OPTIONS', 'RADIO', 'MULTIPLE_OPTIONS', 'CHECKBOX'].includes(f.dataType)) {
      dto.options = options;
    }
    custom.push(dto);
  }
  // GHL does not sort the list (not even by `position`).
  custom.sort((a, b) => a.name.localeCompare(b.name));
  return { custom, types };
}

type ReadResult = Loaded | 'rejected' | 'unavailable';

@Injectable()
export class GoHighLevelFieldsService {
  private readonly cache = new Map<string, Loaded & { expires: number; fingerprint: string }>();
  /** accountId -> when a delivery may try the read again, after one failed. */
  private readonly failedUntil = new Map<string, { until: number; fingerprint: string }>();
  fetchImpl: typeof fetch = fetch;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() @Inject(ENV) private readonly env?: ServerEnv,
  ) {}

  /** A new or removed connection: start over. */
  invalidate(accountId: string): void {
    this.cache.delete(accountId);
    this.failedUntil.delete(accountId);
  }

  /**
   * GHL refused the token: drop the list, but keep any delivery backoff, or
   * every delivery with the refused token would read the fields again.
   */
  dropList(accountId: string): void {
    this.cache.delete(accountId);
  }

  private async read(creds: GoHighLevelCredentials, timeoutMs: number): Promise<ReadResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(
        `${GOHIGHLEVEL_API_BASE}/locations/${encodeURIComponent(creds.locationId)}/customFields?model=contact`,
        { headers: goHighLevelHeaders(creds.token), signal: AbortSignal.timeout(timeoutMs) },
      );
    } catch {
      return 'unavailable';
    }
    const body = (await res.json().catch(() => null)) as { customFields?: unknown } | null;
    if (!res.ok) {
      // A 401 or GHL's own 403: this token cannot read this location's
      // fields. A Cloudflare block, a 429 or a 5xx: try again later.
      return classifyGoHighLevelError(res.status, body as never).kind === 'refused' ? 'rejected' : 'unavailable';
    }
    return toLoaded(Array.isArray(body?.customFields) ? (body.customFields as GhlCustomField[]) : []);
  }

  /** From the cache while fresh and read with this same connection; a failure is never cached. */
  private async load(
    accountId: string,
    creds: GoHighLevelCredentials,
    refresh: boolean,
    now: number,
    forDelivery = false,
  ): Promise<(Loaded & { cached: boolean }) | 'rejected' | 'unavailable'> {
    const fingerprint = goHighLevelFingerprint(creds);
    const hit = this.cache.get(accountId);
    if (!refresh && hit && hit.expires > now && hit.fingerprint === fingerprint) return { ...hit, cached: true };
    if (forDelivery) {
      const failed = this.failedUntil.get(accountId);
      if (failed && failed.until > now && failed.fingerprint === fingerprint) return 'unavailable';
    }
    const read = await this.read(creds, forDelivery ? TYPES_TIMEOUT_MS : LIST_TIMEOUT_MS);
    if (read === 'rejected' || read === 'unavailable') {
      this.cache.delete(accountId);
      this.failedUntil.set(accountId, { until: now + TYPES_RETRY_MS, fingerprint });
      return read;
    }
    this.failedUntil.delete(accountId);
    this.cache.set(accountId, { ...read, expires: now + FIELDS_CACHE_MS, fingerprint });
    return { ...read, cached: false };
  }

  /**
   * The mapping UI's list. Never throws: without a connection it is
   * `not_connected`, with a token GHL refuses it is `rejected`, and when the
   * custom fields cannot be read the standard ones still come back with
   * `custom: []` and a warning.
   */
  async listFields(
    accountId: string,
    opts: { refresh?: boolean } = {},
    now = Date.now(),
  ): Promise<GoHighLevelFieldsResponse> {
    let conn: Awaited<ReturnType<typeof readGoHighLevelConnection>>;
    try {
      conn = await readGoHighLevelConnection(this.db, accountId, this.env?.FORMS_ENCRYPTION_KEY);
    } catch {
      return { enabled: false, reason: 'unavailable' };
    }
    if (!conn) {
      this.cache.delete(accountId);
      return { enabled: false, reason: 'not_connected' };
    }
    const loaded = await this.load(accountId, conn.credentials, opts.refresh === true, now);
    if (loaded === 'rejected') return { enabled: false, reason: 'rejected' };
    if (loaded === 'unavailable') {
      return {
        enabled: true,
        cached: false,
        standard: GOHIGHLEVEL_STANDARD_FIELD_DTOS,
        custom: [],
        warning: 'custom_fields_unavailable',
      };
    }
    return { enabled: true, cached: loaded.cached, standard: GOHIGHLEVEL_STANDARD_FIELD_DTOS, custom: loaded.custom };
  }

  /**
   * Each custom field's reported type, for one delivery. Undefined when it
   * cannot be read: the adapter then falls back to the type stored on each
   * mapping, and a GHL that is down fails the upsert itself, which is retried.
   */
  async fieldTypes(
    accountId: string,
    creds: GoHighLevelCredentials,
    now = Date.now(),
  ): Promise<GoHighLevelFieldTypes | undefined> {
    const loaded = await this.load(accountId, creds, false, now, true);
    return typeof loaded === 'string' ? undefined : loaded.types;
  }
}
