/**
 * The connected org's Lead and Contact fields: for the mapping UI, and for the
 * delivery path, which needs each field's TYPE (a number goes as a number, a
 * date as a day) and the set of fields Contact actually has.
 *
 * Cached per ACCOUNT for five minutes, like the HubSpot property list, and for
 * the same reason the HubSpot cache warns about: entries carry picklist values,
 * which are an org's internal sales taxonomy. Never one shared map.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Db } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import { SALESFORCE_API_VERSION } from '@quill/destinations';
import { SalesforceAccessTokens, type SalesforceAccess } from './salesforce-auth';
import { DB, ENV } from './tokens';

const FIELDS_CACHE_MS = 5 * 60_000;
const DESCRIBE_TIMEOUT_MS = 15_000;

/**
 * Types a mapping can never write: compound fields are written through their
 * components (`Street`, not `Address`), and the rest are not values a form
 * answer can be.
 */
const UNWRITABLE_TYPES = new Set(['address', 'location', 'base64', 'id', 'anyType', 'complexvalue']);

export interface SalesforceFieldOptionDto {
  value: string;
  label: string;
}

export interface SalesforceFieldDto {
  /** API name, what a mapping stores (`Company`, `Industry__c`). */
  name: string;
  label: string;
  /** Salesforce's type: `string`, `email`, `picklist`, `double`, `date`, `datetime`... */
  type: string;
  /** Salesforce refuses a NEW Lead without it (no default, not nillable). */
  required: boolean;
  /** Active picklist values, when the field is a picklist. */
  options?: SalesforceFieldOptionDto[];
}

export type SalesforceFieldsResponse =
  | { enabled: false; reason: 'not_connected' | 'rejected' | 'unavailable' }
  | {
      enabled: true;
      cached: boolean;
      /** Writable Lead fields, sorted by label. */
      lead: SalesforceFieldDto[];
      /** API names of the Contact fields, so the UI can say which mappings reach a Contact. */
      contact: string[];
    };

interface DescribeField {
  name?: unknown;
  label?: unknown;
  type?: unknown;
  createable?: unknown;
  updateable?: unknown;
  nillable?: unknown;
  defaultedOnCreate?: unknown;
  picklistValues?: Array<{ value?: unknown; label?: unknown; active?: unknown }>;
}

interface Described {
  lead: SalesforceFieldDto[];
  leadTypes: Record<string, string>;
  contactTypes: Record<string, string>;
}

function toDto(field: DescribeField): SalesforceFieldDto | null {
  const name = typeof field.name === 'string' ? field.name : '';
  const type = typeof field.type === 'string' ? field.type : 'string';
  if (!name || UNWRITABLE_TYPES.has(type)) return null;
  if (field.createable !== true && field.updateable !== true) return null;
  const dto: SalesforceFieldDto = {
    name,
    label: typeof field.label === 'string' && field.label.trim() ? field.label.trim() : name,
    type,
    required:
      field.createable === true &&
      field.nillable === false &&
      field.defaultedOnCreate !== true &&
      type !== 'boolean',
  };
  if (Array.isArray(field.picklistValues) && (type === 'picklist' || type === 'multipicklist')) {
    const options = field.picklistValues
      .filter((o) => o.active !== false && typeof o.value === 'string' && o.value !== '')
      .map((o) => ({
        value: o.value as string,
        label: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : (o.value as string),
      }));
    if (options.length) dto.options = options;
  }
  return dto;
}

/** Thrown when Salesforce did not answer the describe: worth another try. */
export class SalesforceDescribeUnavailable extends Error {}

async function describe(
  access: SalesforceAccess,
  object: 'Lead' | 'Contact',
  fetchImpl: typeof fetch,
): Promise<DescribeField[] | 'rejected'> {
  let res: Response;
  try {
    res = await fetchImpl(
      `${access.instanceUrl}/services/data/${SALESFORCE_API_VERSION}/sobjects/${object}/describe`,
      {
        headers: { authorization: `Bearer ${access.accessToken}`, accept: 'application/json' },
        signal: AbortSignal.timeout(DESCRIBE_TIMEOUT_MS),
      },
    );
  } catch (err) {
    throw new SalesforceDescribeUnavailable(err instanceof Error ? err.message : String(err));
  }
  if (res.status >= 500 || res.status === 429) {
    throw new SalesforceDescribeUnavailable(`describe ${object} answered HTTP ${res.status}`);
  }
  if (!res.ok) return 'rejected';
  const body = (await res.json().catch(() => null)) as { fields?: DescribeField[] } | null;
  return Array.isArray(body?.fields) ? body.fields : [];
}

@Injectable()
export class SalesforceFieldsService {
  private readonly cache = new Map<string, Described & { expires: number }>();
  fetchImpl: typeof fetch = fetch;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() @Inject(ENV) private readonly env?: ServerEnv,
    @Optional()
    @Inject(SalesforceAccessTokens)
    private readonly tokens: SalesforceAccessTokens = new SalesforceAccessTokens(),
  ) {}

  invalidate(accountId: string): void {
    this.cache.delete(accountId);
  }

  /**
   * Describe both objects, from cache when fresh. Null when the account is not
   * connected or the org refused; throws when Salesforce did not answer.
   */
  private async load(accountId: string, refresh: boolean, now: number): Promise<(Described & { cached: boolean }) | 'not_connected' | 'rejected'> {
    const hit = this.cache.get(accountId);
    if (!refresh && hit && hit.expires > now) return { ...hit, cached: true };
    const access = await this.tokens.resolve(this.db, accountId, this.env, this.fetchImpl, now);
    if (!access) return 'not_connected';
    const [lead, contact] = await Promise.all([
      describe(access, 'Lead', this.fetchImpl),
      describe(access, 'Contact', this.fetchImpl),
    ]);
    if (lead === 'rejected' || contact === 'rejected') return 'rejected';
    const leadDtos = lead.map(toDto).filter((f): f is SalesforceFieldDto => f !== null);
    leadDtos.sort((a, b) => a.label.localeCompare(b.label));
    const types = (fields: DescribeField[]) => {
      const out: Record<string, string> = {};
      for (const f of fields) {
        if (typeof f.name === 'string' && typeof f.type === 'string') out[f.name] = f.type;
      }
      return out;
    };
    const described: Described = { lead: leadDtos, leadTypes: types(lead), contactTypes: types(contact) };
    this.cache.set(accountId, { ...described, expires: now + FIELDS_CACHE_MS });
    return { ...described, cached: false };
  }

  /** The mapping UI's list. Never throws: an unreachable org is `unavailable`. */
  async listFields(
    accountId: string,
    opts: { refresh?: boolean } = {},
    now = Date.now(),
  ): Promise<SalesforceFieldsResponse> {
    try {
      const loaded = await this.load(accountId, opts.refresh === true, now);
      if (loaded === 'not_connected' || loaded === 'rejected') return { enabled: false, reason: loaded };
      return {
        enabled: true,
        cached: loaded.cached,
        lead: loaded.lead,
        contact: Object.keys(loaded.contactTypes).sort(),
      };
    } catch {
      return { enabled: false, reason: 'unavailable' };
    }
  }

  /**
   * Field types for one delivery. Null when not connected or refused (the
   * delivery degrades on its own); THROWS when Salesforce did not answer, so
   * the delivery retries instead of writing numbers as strings.
   */
  async fieldTypes(
    accountId: string,
    now = Date.now(),
  ): Promise<{ lead: Record<string, string>; contact: Record<string, string> } | null> {
    const loaded = await this.load(accountId, false, now);
    if (loaded === 'not_connected' || loaded === 'rejected') return null;
    return { lead: loaded.leadTypes, contact: loaded.contactTypes };
  }
}
