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
import { destinationIsDeliverable, formDestinationSchema } from '@quill/types';

export const INTEGRATION_NOT_CONNECTED = 'INTEGRATION_NOT_CONNECTED';
export const DESTINATION_INCOMPLETE = 'DESTINATION_INCOMPLETE';

/** The destinations that deliver through an account-level connection, with their display names. */
export const CONNECTED_DESTINATIONS = {
  'google-sheets': 'Google Sheets',
  salesforce: 'Salesforce',
} as const;
export type ConnectedDestinationType = keyof typeof CONNECTED_DESTINATIONS;

const needsConnection = (type: string): type is ConnectedDestinationType =>
  Object.prototype.hasOwnProperty.call(CONNECTED_DESTINATIONS, type);

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
}

export interface ConnectionVerdict {
  refusal: DestinationRefusal | null;
  warnings: DestinationWarning[];
}

type Entry = Record<string, unknown>;
const isEntry = (v: unknown): v is Entry => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * An entry in the one shape both sides of the comparison can share: parsed
 * through the destination schema (so a default the schema fills in on the way
 * in is filled in on the stored side too), with the keys `strip` removes.
 */
function canonical(entry: unknown, strip: (e: unknown) => unknown): unknown {
  const stripped = strip(entry);
  const parsed = formDestinationSchema.safeParse(stripped);
  return parsed.success ? parsed.data : stripped;
}

function notConnectedMessage(type: ConnectedDestinationType, url: string): string {
  const name = CONNECTED_DESTINATIONS[type];
  return `${name} is not connected in this workspace, so this destination would deliver nothing. Connecting ${name} takes a browser: open ${url}, connect it there, then save the destinations again.`;
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
      const message = notConnectedMessage(type, input.integrationsUrl);
      const mine = canonical(raw, input.strip);
      const unchanged = storedCanonical.some((s) => isDeepStrictEqual(s, mine));
      if (input.agent && !unchanged) {
        refusal ??= { index, type, message, integrationsUrl: input.integrationsUrl };
        return;
      }
      warnings.push({ code: INTEGRATION_NOT_CONNECTED, index, type, message, integrationsUrl: input.integrationsUrl });
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
