/**
 * The delivery history's words for a row: its lifecycle action and the
 * reason it did not land, in the author's language.
 *
 * The worker records both in English, because they are log lines first: the
 * action is the queue's own identifier (`complete`, `partial`, `crm_update`)
 * and the reason is whatever the adapter or the worker wrote. Shown verbatim,
 * a Spanish history read "partial" and "salesforce delivery failed: HTTP 503".
 *
 * So the part dForms wrote is matched and translated, and the part the
 * PROVIDER wrote (a Salesforce error code, Google's sentence, an HTTP status)
 * is kept exactly as it came, because it is the one detail that says what to
 * fix and paraphrasing it would lose that. A reason this table does not know
 * is shown as recorded, which is no worse than before.
 */
import type { FormsMessages } from '@quill/shared';
import { GOHIGHLEVEL_REASONS } from '@quill/types';
import type { DeliveryKind } from '@/lib/admin-api';

type Msgs = FormsMessages['admin']['integrations'];

/** `{n}`-style interpolation, same shape the rest of this screen uses. */
const fill = (s: string, vars: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

/** The action's label, or the action itself for one this table does not name. */
export function deliveryActionLabel(action: string, m: Msgs): string {
  const labels: Record<string, string> = m.historyActions;
  return Object.prototype.hasOwnProperty.call(labels, action) ? labels[action]! : action;
}

/** The provider's name for a kind, as the reasons say it. */
function providerName(kind: DeliveryKind, m: Msgs): string {
  switch (kind) {
    case 'google-sheets':
      return m.historyProviders.googleSheets;
    case 'salesforce':
      return m.historyProviders.salesforce;
    case 'gohighlevel':
      return m.historyProviders.highlevel;
    case 'hubspot':
    case 'booking_sync':
      return m.historyProviders.hubspot;
    case 'webhook':
      return m.historyProviders.webhook;
    default:
      return m.historyProviders.other;
  }
}

/** A reason the adapter writes word for word (`GOHIGHLEVEL_REASONS`), as a whole-string pattern. */
const exact = (reason: string): RegExp => new RegExp(`^${reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

/**
 * Exact reasons the adapters and the destination factory write, each with
 * its sentence. Matched whole, case-insensitively, so a provider's text that
 * merely contains one of these words is never rewritten.
 */
const FIXED: { pattern: RegExp; key: keyof Msgs['historyReasons'] }[] = [
  { pattern: /^no email in submission$/i, key: 'noEmail' },
  { pattern: /^google sheets destination has no usable access token$/i, key: 'sheetsNotConnected' },
  { pattern: /^google sheets destination missing a spreadsheet$/i, key: 'sheetsNoSpreadsheet' },
  { pattern: /^google sheets destination has no columns configured$/i, key: 'sheetsNoColumns' },
  { pattern: /^salesforce destination has no usable connection \(reconnect salesforce\)$/i, key: 'salesforceNotConnected' },
  { pattern: /^hubspot destination missing token\b.*$/i, key: 'hubspotNotConnected' },
  { pattern: /^webhook destination missing url$/i, key: 'webhookNoUrl' },
  { pattern: exact(GOHIGHLEVEL_REASONS.notConnected), key: 'highlevelNotConnected' },
  { pattern: exact(GOHIGHLEVEL_REASONS.noEmailOrPhone), key: 'highlevelNoEmailOrPhone' },
  { pattern: exact(GOHIGHLEVEL_REASONS.tokenRejected), key: 'highlevelTokenRejected' },
  { pattern: exact(GOHIGHLEVEL_REASONS.locationForbidden), key: 'highlevelLocationForbidden' },
];

/**
 * The reason a row did not land, as the author reads it.
 *
 * Three shapes carry a provider's own words, and only dForms' half of each is
 * translated:
 *   - `<provider> delivery failed: <detail>` (a retryable failure);
 *   - `hubspot [booking ]upsert failed: <detail>` (HubSpot's spelling of the same);
 *   - `HTTP <status>[: <provider text>]` (a permanent refusal).
 */
export function describeDeliveryReason(kind: DeliveryKind, reason: string, m: Msgs): string {
  const raw = reason.trim();
  const r = m.historyReasons;
  for (const { pattern, key } of FIXED) if (pattern.test(raw)) return r[key];

  const failed = /^(?:webhook|salesforce|gohighlevel|google sheets) delivery failed: ([\s\S]+)$/i.exec(raw) ??
    /^hubspot (?:booking )?upsert failed: ([\s\S]+)$/i.exec(raw);
  if (failed) return fill(r.deliveryFailed, { provider: providerName(kind, m), detail: failed[1]!.trim() });

  // The booking sync's refusal of the booking properties it was told to write.
  const booking = /^hubspot booking upsert rejected \(HTTP (\d{3})\)/i.exec(raw);
  if (booking) return fill(r.bookingRejected, { status: booking[1]! });

  const http = /^HTTP (\d{3})(?::\s*([\s\S]*))?$/.exec(raw);
  if (http) {
    const status = http[1]!;
    const detail = http[2]?.trim() ?? '';
    const vars = { provider: providerName(kind, m), status, detail };
    return fill(detail ? r.providerAnsweredDetail : r.providerAnswered, vars);
  }
  return reason;
}
