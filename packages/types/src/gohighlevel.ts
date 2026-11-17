/**
 * HighLevel (GoHighLevel, GHL) destination: the contracts every layer shares.
 *
 * The destination's config schema lives with the other destinations in
 * `index.ts` (`goHighLevelDestinationSchema`); this file holds what is NOT the
 * stored config: the standard-field catalog, the custom-field types, the
 * adapter's input and output, the connect route's request, refusal codes and
 * response, the fields route's response, and the exact delivery reasons the
 * history translates. The API, the adapter, the web app and the MCP all read
 * these, so a later change cannot make them disagree.
 *
 * Naming: the type and provider id are `gohighlevel`; the name a person sees
 * is "HighLevel". Nothing here is user-facing copy except the English
 * `name` of each standard field, which the fields route returns as data (the
 * web app labels them from the i18n catalog instead).
 *
 * Inert for now: no route, adapter or screen uses any of this yet. Until the
 * adapter exists the destination factory turns every `gohighlevel` delivery
 * into a log-only no-op with {@link GOHIGHLEVEL_REASONS}.notConnected.
 */
import type { FormFieldType } from '@quill/engine';
// Type-only: the stored shapes are inferred from the schemas in `index.ts`.
import type {
  GoHighLevelCustomFieldTarget,
  GoHighLevelFieldTarget,
  GoHighLevelStaticField,
} from './index';

/** The destination type AND the account integration provider id. */
export const GOHIGHLEVEL = 'gohighlevel' as const;

/** The name a person reads, in every language. */
export const GOHIGHLEVEL_DISPLAY_NAME = 'HighLevel';

// --- Standard contact fields -------------------------------------------------

/**
 * The contact fields every HighLevel sub-account has, by the key the
 * `POST /contacts/upsert` body uses. A fixed list on dForms' side: GHL has no
 * endpoint that lists them.
 */
export const GOHIGHLEVEL_STANDARD_FIELD_KEYS = [
  'firstName',
  'lastName',
  'name',
  'email',
  'phone',
  'companyName',
  'website',
  'address1',
  'city',
  'state',
  'postalCode',
  'country',
  'dateOfBirth',
] as const;
export type GoHighLevelStandardFieldKey = (typeof GOHIGHLEVEL_STANDARD_FIELD_KEYS)[number];

export interface GoHighLevelStandardField {
  key: GoHighLevelStandardFieldKey;
  /** English name, returned as data by the fields route (the web app uses the i18n catalog). */
  name: string;
  /**
   * The question types whose answer may feed this field. The editor offers the
   * field only for these, and the API refuses a mapping from any other. A
   * `name` step stores its sub-fields flat (`firstname`, `lastname`), so a
   * `name` source means one of those sub-field keys, not the step key. A list
   * answer (a multi-select `multiple_choice`) is joined with `, ` for a
   * standard field, which only ever holds one string.
   */
  sources: readonly FormFieldType[];
}

/** The catalog, in the order the editor lists it. */
export const GOHIGHLEVEL_STANDARD_FIELDS: readonly GoHighLevelStandardField[] = [
  { key: 'firstName', name: 'First name', sources: ['name', 'text'] },
  { key: 'lastName', name: 'Last name', sources: ['name', 'text'] },
  { key: 'name', name: 'Full name', sources: ['name', 'text'] },
  { key: 'email', name: 'Email', sources: ['email', 'text'] },
  // Normalized to E.164 by the adapter; a value it cannot normalize is left out.
  { key: 'phone', name: 'Phone', sources: ['phone', 'text'] },
  { key: 'companyName', name: 'Company name', sources: ['text', 'dropdown', 'multiple_choice'] },
  { key: 'website', name: 'Website', sources: ['url', 'text'] },
  { key: 'address1', name: 'Street address', sources: ['text', 'textarea'] },
  { key: 'city', name: 'City', sources: ['text', 'dropdown', 'multiple_choice'] },
  { key: 'state', name: 'State', sources: ['text', 'dropdown', 'multiple_choice'] },
  { key: 'postalCode', name: 'Postal code', sources: ['text'] },
  { key: 'country', name: 'Country', sources: ['text', 'dropdown', 'multiple_choice'] },
  // Sent as `YYYY-MM-DD`; a text answer that is not a date is left out.
  { key: 'dateOfBirth', name: 'Date of birth', sources: ['text'] },
];

// --- Custom fields -------------------------------------------------------------

/**
 * Every `dataType` GHL reports for a contact custom field
 * (`GET /locations/{id}/customFields?model=contact`). A type outside this
 * list is treated as not mappable.
 */
export const GOHIGHLEVEL_CUSTOM_FIELD_DATA_TYPES = [
  'TEXT',
  'LARGE_TEXT',
  'NUMERICAL',
  'PHONE',
  'MONETORY',
  'EMAIL',
  'CHECKBOX',
  'SINGLE_OPTIONS',
  'RADIO',
  'MULTIPLE_OPTIONS',
  'DATE',
  'FLOAT',
  'TIME',
  'TEXTBOX_LIST',
  'FILE_UPLOAD',
  'SIGNATURE',
] as const;
export type GoHighLevelCustomFieldDataType = (typeof GOHIGHLEVEL_CUSTOM_FIELD_DATA_TYPES)[number];

/**
 * The custom-field types a mapping may target, and the shape the adapter sends
 * a value in (`customFields: [{ id, fieldValue }]`):
 *
 *   text     a string
 *   number   a number; an answer that is not one is left out
 *   option   one string (single choice)
 *   options  a list of strings (multiple choice, checkbox)
 *   date     `YYYY-MM-DD`, the day named in the destination's `dayTimezone`
 *
 * Left out on purpose, so the fields route never offers them and the schema
 * refuses them: `TEXTBOX_LIST`, `FLOAT`, `SIGNATURE` and `FILE_UPLOAD` (the
 * upsert does not take them), and `TIME` (its value format is not confirmed).
 * The spelling `MONETORY` is GHL's own.
 */
export const GOHIGHLEVEL_VALUE_KIND = {
  TEXT: 'text',
  LARGE_TEXT: 'text',
  PHONE: 'text',
  EMAIL: 'text',
  NUMERICAL: 'number',
  MONETORY: 'number',
  SINGLE_OPTIONS: 'option',
  RADIO: 'option',
  MULTIPLE_OPTIONS: 'options',
  CHECKBOX: 'options',
  DATE: 'date',
} as const satisfies Partial<Record<GoHighLevelCustomFieldDataType, string>>;
export type GoHighLevelMappableDataType = keyof typeof GOHIGHLEVEL_VALUE_KIND;
export type GoHighLevelValueKind = (typeof GOHIGHLEVEL_VALUE_KIND)[GoHighLevelMappableDataType];

/** The mappable types, as a tuple for `z.enum`. */
export const GOHIGHLEVEL_MAPPABLE_DATA_TYPES = Object.keys(GOHIGHLEVEL_VALUE_KIND) as [
  GoHighLevelMappableDataType,
  ...GoHighLevelMappableDataType[],
];

/** Whether a reported type can be mapped at all. Unknown strings are not. */
export function isGoHighLevelMappableDataType(type: unknown): type is GoHighLevelMappableDataType {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(GOHIGHLEVEL_VALUE_KIND, type);
}

/** The custom-field types the score may go to: a number. */
export const GOHIGHLEVEL_SCORE_DATA_TYPES = ['NUMERICAL'] as const;
/** The custom-field types the submitted date may go to. */
export const GOHIGHLEVEL_DATE_DATA_TYPES = ['DATE'] as const;
/** The custom-field types a UTM value may go to: free text. */
export const GOHIGHLEVEL_UTM_DATA_TYPES = ['TEXT', 'LARGE_TEXT'] as const;

/** The five UTM parameters a destination can forward. GHL's own attribution cannot be written by API. */
export const GOHIGHLEVEL_UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;
export type GoHighLevelUtmKey = (typeof GOHIGHLEVEL_UTM_KEYS)[number];

// --- The adapter -------------------------------------------------------------

/**
 * What a connection is made of. Stored as JSON, encrypted with the
 * deployment's `FORMS_ENCRYPTION_KEY`, in `account_integration` under the
 * `gohighlevel` provider. Never in a form's config, never returned.
 */
export interface GoHighLevelCredentials {
  /** The sub-account's Private Integration token (starts with {@link GOHIGHLEVEL_TOKEN_PREFIX}). */
  token: string;
  locationId: string;
}

/** A Private Integration token starts with this; anything else is `token_format`. */
export const GOHIGHLEVEL_TOKEN_PREFIX = 'pit-';

/**
 * Custom field id -> its `dataType` as the location reports it NOW (the
 * fields service's cache). The adapter converts a value by this type and falls
 * back to the type stored on the mapping when an id is absent here. A type
 * that is not mappable (the field was changed in GHL) leaves the value out.
 */
export type GoHighLevelFieldTypes = Record<string, string>;

/**
 * The destination factory's input for a `gohighlevel` spec: the stored
 * mappings plus what the API resolves at delivery time. Empty credentials make
 * the factory degrade to the log-only no-op.
 */
export interface GoHighLevelDeliveryOptions {
  credentials: GoHighLevelCredentials;
  fieldMappings: Record<string, GoHighLevelFieldTarget[]>;
  utmMappings?: Partial<Record<GoHighLevelUtmKey, GoHighLevelCustomFieldTarget>>;
  scoreField?: GoHighLevelCustomFieldTarget;
  dateField?: GoHighLevelCustomFieldTarget;
  dayTimezone?: string;
  staticFields?: GoHighLevelStaticField[];
  /** Added after the upsert with `POST /contacts/{id}/tags`, which only adds. */
  tags?: string[];
  /** The contact's `source`. Absent or blank: `dForms: {form name}`. */
  source?: string;
  customFieldTypes?: GoHighLevelFieldTypes;
  /**
   * Called on a 401 or 403 before the delivery resolves skipped, so the API
   * can mark the connection as rejected for the Connections card.
   */
  onRejected?: (status: 401 | 403) => void;
  timeoutMs?: number;
}

/**
 * What one delivery did, before it becomes the port's `DestinationResult`
 * (`delivered` = `action !== 'skipped'`; `detail` = the reason, or
 * `created contact {id}` / `updated contact {id}`).
 *
 * `created` and `updated` come from the upsert's `new` flag. GHL decides
 * which by the sub-account's Contact Duplication Preferences (email, phone).
 */
export type GoHighLevelDeliveryOutcome =
  | { action: 'created' | 'updated'; contactId: string; reason?: undefined }
  | { action: 'skipped'; reason: string; contactId?: undefined };

/**
 * The exact reasons dForms writes for a `gohighlevel` row that did not land,
 * so the delivery history can match them whole and translate them. A refusal
 * GHL explains itself (400, 422) is recorded as `HTTP {status}: {GHL message}`,
 * the shape every other adapter uses.
 */
export const GOHIGHLEVEL_REASONS = {
  /** The factory's no-op: no connection, or none it can use. */
  notConnected: 'gohighlevel destination has no usable connection (reconnect HighLevel)',
  /** Nothing to deduplicate on, so nothing is created. */
  noEmailOrPhone: 'no email or phone in submission',
  /** 401: the token was revoked or rotated. Not retried. */
  tokenRejected: 'HighLevel rejected the token (reconnect HighLevel)',
  /** 403: the token cannot reach this location, or lacks a scope. Not retried. */
  locationForbidden: 'HighLevel refused access to the location (reconnect HighLevel)',
} as const;

// --- Routes ------------------------------------------------------------------

/** `POST` here connects or replaces the connection; `DELETE /v1/integrations/gohighlevel` removes it. */
export const GOHIGHLEVEL_CONNECT_PATH = '/v1/integrations/gohighlevel/connect';
/** `GET` here lists the fields (`?refresh=1` skips the 5-minute cache). Rate-limited. */
export const GOHIGHLEVEL_FIELDS_PATH = '/v1/integrations/gohighlevel/fields';

/** The connect body. Replacing the token is the same call; form mappings are kept. */
export interface GoHighLevelConnectRequest {
  token: string;
  /** The Location ID, or the sub-account's URL, from which the API takes the ID. */
  locationId: string;
}

/**
 * Why the API refused to connect (the 400 body's `reason`), one per thing the
 * admin has to fix. Never GHL's own error text.
 *
 *   token_format    not a Private Integration token (no `pit-` prefix)
 *   invalid_token   GHL answered 401 for the token itself
 *   wrong_location  GHL answered 403: the token belongs to another sub-account
 *   missing_scope   GHL answered 401 for a scope the token lacks
 *   unreachable     GHL did not answer (5xx, network); `cause` names how it died
 *
 * If GHL turns out not to tell `wrong_location` from `missing_scope`, the API
 * answers `wrong_location` for both and the card's sentence covers both.
 */
export const GOHIGHLEVEL_CONNECT_REJECTIONS = [
  'token_format',
  'invalid_token',
  'wrong_location',
  'missing_scope',
  'unreachable',
] as const;
export type GoHighLevelConnectRejection = (typeof GOHIGHLEVEL_CONNECT_REJECTIONS)[number];

/**
 * Every error the Connections card can show: the API's refusals, plus the two
 * the browser decides (`timeout`: the action gave up waiting; `forbidden`: a
 * 403 from dForms, the member may not connect integrations).
 */
export type GoHighLevelConnectError = GoHighLevelConnectRejection | 'timeout' | 'forbidden';

/** The 400 body of a refused connect. Same shape as Salesforce's `SALESFORCE_REJECTED`. */
export interface GoHighLevelConnectRefusal {
  error: 'GOHIGHLEVEL_REJECTED';
  reason: GoHighLevelConnectRejection;
  /** Only with `unreachable`: the network code (`ECONNRESET`, `ENOTFOUND`, `timeout`). */
  cause?: string;
  message: string;
}

/**
 * What the `gohighlevel` entry of `GET /v1/integrations` (and a successful
 * connect) carries beyond the common integration status (`provider`,
 * `connected`, `last4` of the token, `label` = the sub-account's name,
 * `connectedAt`).
 */
export interface GoHighLevelStatusExtras {
  locationId: string | null;
  /**
   * When a delivery last got a 401 or 403 for this token (epoch ms), so the
   * card can say HighLevel stopped accepting it. Null while it works; cleared
   * by a successful connect.
   */
  rejectedAt: number | null;
}

/** One standard field, as the fields route lists it. */
export interface GoHighLevelStandardFieldDto {
  kind: 'standard';
  key: GoHighLevelStandardFieldKey;
  name: string;
  sources: readonly FormFieldType[];
}

/** One mappable custom field of the location, as the fields route lists it. */
export interface GoHighLevelCustomFieldDto {
  kind: 'custom';
  id: string;
  /** GHL's `fieldKey`, e.g. `contact.utm_source`. */
  key: string;
  name: string;
  dataType: GoHighLevelMappableDataType;
  /** The choices of an option field (`SINGLE_OPTIONS`, `RADIO`, `MULTIPLE_OPTIONS`, `CHECKBOX`). */
  options?: string[];
}

/**
 * `GET /v1/integrations/gohighlevel/fields`. Never an HTTP error once the
 * caller is authenticated: when the custom fields cannot be read, the standard
 * fields still come back with `custom: []` and `warning`.
 */
export type GoHighLevelFieldsResponse =
  | { enabled: false; reason: 'not_connected' | 'rejected' | 'unavailable' }
  | {
      enabled: true;
      cached: boolean;
      standard: GoHighLevelStandardFieldDto[];
      /** Mappable types only, sorted by name. */
      custom: GoHighLevelCustomFieldDto[];
      warning?: 'custom_fields_unavailable';
    };
