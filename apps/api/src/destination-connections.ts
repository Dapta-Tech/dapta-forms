/**
 * Whether a destination list can deliver, as far as the account's
 * connections decide it: the rule `PUT /v1/forms/:id/destinations` applies
 * before it stores anything.
 *
 * A Google Sheets or Salesforce destination delivers through the ACCOUNT's
 * connection, read at delivery time. With none, the delivery path degrades to
 * a log-only no-op (`destination-effects.ts`, `toSpec`), so the save succeeds
 * and no row or Lead ever arrives. An agent would then tell the person "done"
 * about a destination that delivers into nothing. So:
 *
 *   - An agent (API key or MCP connection) that saves a NEW or CHANGED enabled
 *     entry for a provider the account has not connected is refused with
 *     `INTEGRATION_NOT_CONNECTED` and the integrations page to hand over:
 *     Google and Salesforce consent only happens in a browser.
 *   - An entry IDENTICAL to one the form already stores passes, with a
 *     warning. The PUT replaces the whole list, so every save round-trips the
 *     entries it does not touch: a form whose Google connection was removed
 *     after its spreadsheet was set up must still take an unrelated webhook
 *     edit.
 *   - A browser session is warned, never refused. The editor's cards only
 *     show their connect control once switched on, so switching a card on is
 *     how the author reaches "connect" in the first place, and that switch is
 *     saved before the connection exists. Asked "would this entry deliver?",
 *     a Sheets card with no spreadsheet yet would not (the enqueue skips it,
 *     `destinationIsDeliverable`), but a Salesforce card with nothing mapped
 *     WOULD once connected (the adapter falls back to a raw `email` answer), so
 *     no shape test separates the editor's mid-setup saves from an agent's
 *     false promise. What does separate them is who is looking: the author is
 *     looking at the card that says "not connected". The strict rules for
 *     agents follow the same split (`strict-config.ts`).
 *
 * Connected means the account holds a connection row for the provider. A
 * refresh token Google later revoked still reads as connected here; that
 * failure surfaces on delivery, where it is retried and recorded.
 */
import { isDeepStrictEqual } from 'node:util';
import type { ZodTypeAny } from 'zod';
import { listIntegrationStatuses, type Db } from '@quill/db';
import { destinationIsDeliverable, formDestinationSchema } from '@quill/types';
import { googleOAuthClient, type GoogleOAuthEnv } from './google-oauth';

export const INTEGRATION_NOT_CONNECTED = 'INTEGRATION_NOT_CONNECTED';
export const DESTINATION_INCOMPLETE = 'DESTINATION_INCOMPLETE';

/** The destinations that deliver through an account-level connection, with their display names. */
export const CONNECTED_DESTINATIONS = {
  'google-sheets': 'Google Sheets',
  salesforce: 'Salesforce',
  // Nothing can connect HighLevel yet (there is no connect route), so it is
  // also in `unavailableDestinationProviders`: an agent's HighLevel entry is
  // always refused here, as not retryable, and a browser's is warned.
  gohighlevel: 'HighLevel',
} as const;
export type ConnectedDestinationType = keyof typeof CONNECTED_DESTINATIONS;

const needsConnection = (type: string): type is ConnectedDestinationType =>
  Object.prototype.hasOwnProperty.call(CONNECTED_DESTINATIONS, type);

/**
 * The destination providers this account can deliver through right now.
 *
 * A connection row is not enough for Google Sheets: its stored credential is a
 * refresh token, and redeeming it takes the deployment's own Google OAuth
 * client. A deployment without one (`googleOAuthClient` null, the same test
 * the authorize route and `GET /v1/integrations` make) can never mint an
 * access token, so a row left from before the client was removed counts as
 * not connected.
 */
export async function connectedDestinationProviders(
  db: Db,
  accountId: string,
  env: GoogleOAuthEnv | undefined,
): Promise<Set<string>> {
  const connected = new Set<string>((await listIntegrationStatuses(db, accountId)).map((s) => s.provider));
  if (!googleOAuthClient(env)) connected.delete('google-sheets');
  return connected;
}

/** The destination providers this DEPLOYMENT cannot connect at all, as `GET /v1/integrations` reports them. */
export function unavailableDestinationProviders(env: GoogleOAuthEnv | undefined): Set<string> {
  // HighLevel until its connect route exists. Not in `GET /v1/integrations`
  // `unavailable`, which only lists cards the Connections page shows.
  return new Set([...(googleOAuthClient(env) ? [] : ['google-sheets']), 'gohighlevel']);
}

/**
 * Why a provider cannot be connected at all, and what to do until it can, as
 * the refusal and the warning say it. Google Sheets: the deployment has no
 * OAuth client. HighLevel: dForms cannot connect it yet.
 */
function unavailableWording(type: ConnectedDestinationType): {
  why: string;
  until: string;
  saved: (what: string) => string;
} {
  if (type === 'gohighlevel') {
    return {
      why: 'dForms cannot connect HighLevel yet',
      until: 'Leave this destination out or switched off.',
      saved: (what) => `HighLevel cannot be connected in dForms yet, so ${what} delivers nothing.`,
    };
  }
  const name = CONNECTED_DESTINATIONS[type];
  return {
    why: `this dForms deployment cannot connect ${name} at all (it has no OAuth client for it)`,
    until: 'Whoever runs this deployment has to set that up first; until then, leave this destination out or switched off.',
    saved: (what) =>
      `This dForms deployment cannot connect ${name} at all (it has no OAuth client for it), so ${what} delivers nothing until whoever runs the deployment sets that up.`,
  };
}

/** The admin page where a workspace connects its integrations. */
export const INTEGRATIONS_PATH = '/admin/integrations';

/**
 * The integrations page as an absolute URL, from the deployment's own
 * `PUBLIC_APP_URL`. A bare self-host with it unset gets the path alone,
 * which is still the page on whatever host the person reaches the app on.
 */
export function integrationsPageUrl(publicAppUrl: string | undefined): string {
  const base = (publicAppUrl ?? '').trim().replace(/\/+$/, '');
  return `${base}${INTEGRATIONS_PATH}`;
}

/** Something the save went through with, but that a person should hear about. */
export interface DestinationWarning {
  code: typeof INTEGRATION_NOT_CONNECTED | typeof DESTINATION_INCOMPLETE;
  /** The entry's position in the list that was sent. */
  index: number;
  type: string;
  message: string;
  /** Where the provider is connected. Only for `INTEGRATION_NOT_CONNECTED`. */
  integrationsUrl?: string;
}

/** The refusal: the first new or changed entry that could not deliver. */
export interface DestinationRefusal {
  index: number;
  type: ConnectedDestinationType;
  message: string;
  integrationsUrl: string;
  /**
   * True when this DEPLOYMENT cannot connect the provider at all (Google
   * Sheets without a Google OAuth client): there is nothing to connect, so the
   * integrations page is no help and the same call will keep being refused.
   */
  unavailable: boolean;
}

export interface ConnectionVerdict {
  refusal: DestinationRefusal | null;
  warnings: DestinationWarning[];
}

type Entry = Record<string, unknown>;
const isEntry = (v: unknown): v is Entry => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Keys an editor stores for itself and a delivery never reads, at any depth.
 * `drafts` holds the half-filled rows of a CRM card (`hubspot`, `salesforce`),
 * kept so they survive a reload: an agent that never saw them and leaves them
 * out has changed nothing a respondent would notice.
 */
const EDITOR_ONLY_KEYS: ReadonlySet<string> = new Set(['drafts']);

/** The zod node a value is really checked by, under the wrappers that only add a default or `null`. */
function unwrap(schema: ZodTypeAny): ZodTypeAny {
  let node = schema;
  for (;;) {
    const def = node._def as { typeName?: string; innerType?: ZodTypeAny; schema?: ZodTypeAny; in?: ZodTypeAny; type?: ZodTypeAny; getter?: () => ZodTypeAny };
    switch (def.typeName) {
      case 'ZodOptional':
      case 'ZodNullable':
      case 'ZodDefault':
      case 'ZodCatch':
      case 'ZodReadonly':
        node = def.innerType!;
        break;
      case 'ZodEffects':
        node = def.schema!;
        break;
      case 'ZodBranded':
        node = def.type!;
        break;
      case 'ZodPipeline':
        node = def.in!;
        break;
      case 'ZodLazy':
        node = def.getter!();
        break;
      default:
        return node;
    }
  }
}

const typeOf = (schema: ZodTypeAny): string => String((schema._def as { typeName?: string }).typeName);

/**
 * A value in the one shape its schema allows, so two spellings of the same
 * setting compare equal. Walked from the zod schema itself, not from a list of
 * fields: `null` reads as absent everywhere (every nullable field here means
 * "not set" either way), an empty record reads as absent, an editor-only key is
 * dropped, and wherever a union accepts both one value and a list of them
 * (a CRM mapping's `"Email"` or `["Email"]`) the single value becomes a list.
 */
function normalized(schema: ZodTypeAny, value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  const node = unwrap(schema);
  switch (typeOf(node)) {
    case 'ZodObject': {
      if (!isEntry(value)) return value;
      const shape = (node as unknown as { shape: Record<string, ZodTypeAny> }).shape;
      const out: Entry = {};
      for (const [key, raw] of Object.entries(value)) {
        if (EDITOR_ONLY_KEYS.has(key)) continue;
        const v = shape[key] ? normalized(shape[key], raw) : raw;
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
    case 'ZodRecord': {
      if (!isEntry(value)) return value;
      const inner = (node._def as { valueType: ZodTypeAny }).valueType;
      const out: Entry = {};
      for (const [key, raw] of Object.entries(value)) {
        const v = normalized(inner, raw);
        if (v !== undefined) out[key] = v;
      }
      return Object.keys(out).length ? out : undefined;
    }
    case 'ZodArray': {
      if (!Array.isArray(value)) return value;
      const inner = (node._def as { type: ZodTypeAny }).type;
      return value.map((v) => normalized(inner, v) ?? null);
    }
    case 'ZodDiscriminatedUnion': {
      if (!isEntry(value)) return value;
      const def = node._def as { discriminator: string; optionsMap: Map<unknown, ZodTypeAny> };
      const option = def.optionsMap.get(value[def.discriminator]);
      return option ? normalized(option, value) : value;
    }
    case 'ZodUnion': {
      const options = (node._def as { options: ZodTypeAny[] }).options;
      const list = options.find((o) => typeOf(unwrap(o)) === 'ZodArray');
      if (list && !Array.isArray(value)) {
        const item = (unwrap(list)._def as { type: ZodTypeAny }).type;
        if (item.safeParse(value).success) return normalized(list, [value]);
      }
      const match = options.find((o) => o.safeParse(value).success);
      return match ? normalized(match, value) : value;
    }
    default:
      return value;
  }
}

/**
 * An entry in the one shape both sides of the comparison can share: the keys
 * `strip` removes taken out (the Sheets bookkeeping only the API writes), the
 * defaults the schema fills in filled in on both sides, and every remaining
 * spelling difference normalized away (see `normalized`).
 */
function canonical(entry: unknown, strip: (e: unknown) => unknown): unknown {
  const stripped = strip(entry);
  const parsed = formDestinationSchema.safeParse(stripped);
  return normalized(formDestinationSchema as unknown as ZodTypeAny, parsed.success ? parsed.data : stripped);
}

function notConnectedMessage(type: ConnectedDestinationType, url: string, index: number, unavailable: boolean): string {
  const name = CONNECTED_DESTINATIONS[type];
  if (unavailable) {
    const { why, until } = unavailableWording(type);
    return `Destination ${index + 1} is a new or changed ${name} destination, and ${why}, so it would deliver nothing. ${until}`;
  }
  return `Destination ${index + 1} is a new or changed ${name} destination, and ${name} is not connected in this workspace, so it would deliver nothing. An entry sent back exactly as the form stores it is kept; this one differs from every stored entry or is not stored at all. Connecting ${name} takes a browser: open ${url}, connect it there, then save the destinations again.`;
}

/** The warning for an entry saved while its provider is not connected. */
function savedMessage(type: ConnectedDestinationType, url: string, unchanged: boolean, unavailable: boolean): string {
  const name = CONNECTED_DESTINATIONS[type];
  const what = unchanged ? 'this destination was kept as it was stored, but it' : 'this destination was saved, but it';
  if (unavailable) return unavailableWording(type).saved(what);
  return `${name} is not connected in this workspace, so ${what} delivers nothing until someone connects ${name} at ${url} (in a browser).`;
}

/**
 * The verdict on a destination list about to be stored.
 *
 * `incoming` is the parsed body; `stored` what the form holds now (loosely
 * typed: a config written by an older version is still read). `strip` removes
 * what only the API writes (the Sheets bookkeeping), on both sides, so an
 * entry read with `get_form` and sent straight back compares as unchanged.
 */
export function connectionVerdict(input: {
  incoming: readonly unknown[];
  stored: unknown;
  connected: ReadonlySet<string>;
  /** Providers this deployment cannot connect at all; they are never in `connected`. */
  unavailable?: ReadonlySet<string>;
  agent: boolean;
  integrationsUrl: string;
  strip: (entry: unknown) => unknown;
}): ConnectionVerdict {
  const storedList = Array.isArray(input.stored) ? input.stored : [];
  const storedCanonical = storedList.map((s) => canonical(s, input.strip));
  const warnings: DestinationWarning[] = [];
  let refusal: DestinationRefusal | null = null;

  input.incoming.forEach((raw, index) => {
    if (!isEntry(raw) || raw.enabled === false) return;
    const type = typeof raw.type === 'string' ? raw.type : '';
    if (needsConnection(type) && !input.connected.has(type)) {
      const mine = canonical(raw, input.strip);
      const unchanged = storedCanonical.some((s) => isDeepStrictEqual(s, mine));
      const unavailable = input.unavailable?.has(type) ?? false;
      if (input.agent && !unchanged) {
        refusal ??= {
          index,
          type,
          message: notConnectedMessage(type, input.integrationsUrl, index, unavailable),
          integrationsUrl: input.integrationsUrl,
          unavailable,
        };
        return;
      }
      warnings.push({
        code: INTEGRATION_NOT_CONNECTED,
        index,
        type,
        message: savedMessage(type, input.integrationsUrl, unchanged, unavailable),
        integrationsUrl: input.integrationsUrl,
      });
      return;
    }
    if (!destinationIsDeliverable(raw as { type: string })) {
      warnings.push({
        code: DESTINATION_INCOMPLETE,
        index,
        type,
        message:
          'This Google Sheets destination is switched on but has no spreadsheet or no column with a header yet, so no response is written until it does.',
      });
    }
  });
  return { refusal, warnings };
}
