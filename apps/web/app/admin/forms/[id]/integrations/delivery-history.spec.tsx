/**
 * The per-integration delivery history.
 *
 * This panel replaced a flat failure list that sat loose in the Connect tab and
 * mixed every outbox kind. The promises that made the move worth making are the
 * ones pinned here:
 *
 *   1. the CARD stays a settings form. Closed, the history is one line — a count
 *      and a button — so twenty-five rows of log can never bury the endpoint URL
 *      the reader came for. The rows exist only in the dialog;
 *   2. a red chip is the card's only standing signal, and it appears only when
 *      something actually failed. There is no badge for a healthy log;
 *   3. a failure carries the worker's reason verbatim, because that sentence is
 *      the only thing in the UI that says what to fix;
 *   4. a landed delivery is NOT dressed as a failure — the whole point of asking
 *      for `done` rows was to tell a working webhook from one that never fired;
 *   5. the ping note is present wherever a test can be sent (the webhook), so
 *      "I sent a test and nothing showed up" reads as the truth rather than as
 *      a bug in this panel, and absent where none can (Salesforce, Sheets);
 *   6. the red chip says what it counts: failed AND refused rows;
 *   7. dForms' own words are translated, the provider's are kept verbatim.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getMessages } from '@quill/shared';
import type { FormDelivery } from '@/lib/admin-api';
import { DeliveryHistoryView, hasTestSends, isFailure, notDelivered, type HistoryState } from './delivery-history';
import { deliveryActionLabel, describeDeliveryReason } from './delivery-reason';

const m = getMessages('en').admin.integrations;
const es = getMessages('es').admin.integrations;

const delivery = (over: Partial<FormDelivery> = {}): FormDelivery => ({
  id: 'row-1',
  kind: 'webhook',
  status: 'done',
  action: 'complete',
  lastError: null,
  attempts: 1,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  requestBody: null,
  responseStatus: null,
  responseBody: null,
  ...over,
});

const render = (
  state: HistoryState,
  open = true,
  opts: { testSends?: boolean; locale?: 'en' | 'es' } = { testSends: true },
): string =>
  renderToStaticMarkup(
    <DeliveryHistoryView
      state={state}
      open={open}
      onOpen={() => {}}
      onClose={() => {}}
      onRefresh={() => {}}
      title={m.historyWebhookTitle}
      locale={opts.locale ?? 'en'}
      m={opts.locale === 'es' ? es : m}
      testId="webhook-history"
      testSends={opts.testSends}
    />,
  );

const ready = (items: FormDelivery[]): HistoryState => ({ status: 'ready', items });

describe('isFailure', () => {
  it('counts what did not land, and only that', () => {
    expect(isFailure(delivery({ status: 'failed' }))).toBe(true);
    expect(isFailure(delivery({ status: 'skipped' }))).toBe(true);
    expect(isFailure(delivery({ status: 'done' }))).toBe(false);
    // `pending` is progress, not a problem — a webhook mid-backoff must not
    // paint the card red.
    expect(isFailure(delivery({ status: 'pending' }))).toBe(false);
  });
});

describe('a delivery the provider refused', () => {
  // What the worker now records for an adapter that resolved `delivered:false`:
  // skipped, the adapter's reason, and the provider's own answer. This row was
  // `done` before, and rendered as a green "Delivered · HTTP 400".
  const refused = (over: Partial<FormDelivery> = {}) =>
    delivery({
      kind: 'salesforce',
      status: 'skipped',
      lastError: 'HTTP 400: STRING_TOO_LONG: Last Name: data value too large (max length=80) [LastName]',
      requestBody: '{"LastName":"x"}',
      responseStatus: 400,
      responseBody: 'STRING_TOO_LONG: Last Name: data value too large (max length=80) [LastName]',
      ...over,
    });

  it('is labelled not delivered, with the reason, and never as delivered', () => {
    const html = render(ready([refused()]));
    expect(html).toContain('data-status="skipped"');
    expect(html).toContain('>Not delivered<');
    expect(html).not.toContain(m.historyDelivered);
    expect(html).toContain('STRING_TOO_LONG: Last Name: data value too large');
    expect(html).toContain('HTTP 400');
    expect(html).toContain('bg-destructive/10');
  });

  it('says not delivered in Spanish too', () => {
    expect(getMessages('es').admin.integrations.historySkipped).toBe('No entregada');
  });

  it('counts in the red chip on a complete', () => {
    const html = render(ready([refused(), delivery({ id: 'b', status: 'done' })]), false);
    // A refused row reads "Not delivered", so a chip saying "failed" would
    // not describe it: the chip names both.
    expect(html).toContain('Needs attention: 1');
    expect(html).not.toContain('1 failed');
    expect(html).toContain('data-failures="1"');
  });

  it('lists a skipped partial as not delivered, with its reason, without raising the alarm', () => {
    // HubSpot fires on partials, and a respondent who has not reached the email
    // question leaves one of these on most forms. The complete is what counts.
    const partial = delivery({ id: 'p', kind: 'hubspot', status: 'skipped', action: 'partial', lastError: 'no email in submission' });
    expect(notDelivered(partial)).toBe(true);
    expect(isFailure(partial)).toBe(false);

    const closed = render(ready([partial, delivery({ id: 'c', kind: 'hubspot' })]), false);
    expect(closed).toContain('data-failures="0"');
    expect(closed).not.toContain('webhook-history-failed-chip');

    const open = render(ready([partial]));
    expect(open).toContain('>Not delivered<');
    expect(open).toContain(m.historyReasons.noEmail);
    expect(open).not.toContain('bg-destructive/10');
  });

  it('still counts a partial whose retries ran out', () => {
    expect(isFailure(delivery({ status: 'failed', action: 'partial' }))).toBe(true);
  });
});

describe('DeliveryHistoryView — the card line', () => {
  it('keeps the log out of the card entirely when closed', () => {
    const html = render(ready([delivery(), delivery({ id: 'b' })]), false);
    expect(html).toContain(m.historyWebhookTitle);
    expect(html).toContain(m.historyOpen);
    // The single promise this whole redesign rests on.
    expect(html).not.toContain('data-testid="delivery-row"');
    expect(html).not.toContain('webhook-history-dialog');
  });

  it('counts failures in the card, not total deliveries', () => {
    const html = render(
      ready([
        delivery({ id: 'a', status: 'failed', lastError: 'HTTP 400' }),
        delivery({ id: 'b', status: 'done' }),
      ]),
      false,
    );
    expect(html).toContain('webhook-history-failed-chip');
    expect(html).toContain('Needs attention: 1');
    // The neutral count is for a clean history; a failing one must not also
    // advertise a reassuring total next to the red chip.
    expect(html).not.toContain('webhook-history-count-chip');
  });

  it('counts deliveries neutrally when none of them failed', () => {
    const html = render(ready([delivery({ id: 'a' }), delivery({ id: 'b' })]), false);
    expect(html).toContain('webhook-history-count-chip');
    expect(html).toContain('2 deliveries');
    expect(html).not.toContain('webhook-history-failed-chip');
  });

  it('claims nothing at all when there is no history', () => {
    const html = render(ready([]), false);
    expect(html).not.toContain('webhook-history-count-chip');
    expect(html).not.toContain('webhook-history-failed-chip');
  });

  it('will not open a dialog over a list it has not read yet', () => {
    expect(render({ status: 'loading' }, false)).toContain('disabled=""');
  });
});

describe('DeliveryHistoryView — the dialog', () => {
  it('scrolls the list inside the panel', () => {
    const html = render(ready([delivery()]));
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('aria-modal="true"');
  });

  it("shows a failure's reason, with the provider's part verbatim", () => {
    const html = render(
      ready([delivery({ status: 'failed', lastError: 'webhook delivery failed: HTTP 400' })]),
    );
    expect(html).toContain('Delivery to your endpoint failed: HTTP 400');
    expect(html).toContain('data-status="failed"');
  });

  it('shows a reason it does not know exactly as recorded', () => {
    const html = render(ready([delivery({ status: 'failed', lastError: 'socket hang up' })]));
    expect(html).toContain('socket hang up');
  });

  it('says so when the worker recorded no reason', () => {
    const html = render(ready([delivery({ status: 'failed', lastError: null })]));
    expect(html).toContain(m.historyNoReason);
  });

  it('does not dress a landed delivery as a failure', () => {
    const html = render(ready([delivery({ status: 'done' })]));
    expect(html).toContain(m.historyDelivered);
    expect(html).toContain('data-status="done"');
    expect(html).not.toContain('bg-destructive/10');
  });

  it('shows the attempt count only once there has been more than one', () => {
    expect(render(ready([delivery({ status: 'failed', attempts: 5 })]))).toContain('5 attempts');
    expect(render(ready([delivery({ attempts: 1 })]))).not.toContain('attempts');
  });

  it('names the queue action so two rows of one kind can be told apart', () => {
    const html = render(
      ready([delivery({ id: 'a', action: 'partial' }), delivery({ id: 'b', action: 'complete' })]),
    );
    expect(html).toContain(m.historyActions.partial);
    expect(html).toContain(m.historyActions.complete);
  });

  it('offers an empty state rather than an empty box', () => {
    expect(render(ready([]))).toContain(m.historyEmpty);
  });

  it('keeps the card usable when the lookup failed', () => {
    const html = render({ status: 'error' });
    expect(html).toContain(m.historyLoadError);
    expect(html).toContain('role="alert"');
  });

  it('explains test deliveries wherever a test can be sent', () => {
    // The question ("where is my ping?") arrives exactly when the list is empty.
    expect(render(ready([]))).toContain(m.historyPingNote);
    expect(render(ready([delivery()]))).toContain(m.historyPingNote);
  });

  it('says nothing about test deliveries where none can be sent', () => {
    const html = render(ready([delivery({ kind: 'salesforce' })]), true, { testSends: false });
    expect(html).not.toContain(m.historyPingNote);
    expect(html).not.toContain('webhook-history-ping-note');
  });

  it('offers a visible way out, not just Esc', () => {
    expect(render(ready([delivery()]))).toContain(m.historyClose);
  });
});

/**
 * The transcript. A status and a one-line error say a delivery failed; only the
 * body it carried and the answer it drew say WHY, which is the difference
 * between a log and a debugging tool.
 */
describe('DeliveryHistoryView — reading a delivery back', () => {
  const withTranscript = (over: Partial<FormDelivery> = {}) =>
    delivery({
      requestBody: '{"id":"sub-1","data":{"email":"a@b.test"}}',
      responseStatus: 400,
      responseBody: '{"error":"missing field"}',
      ...over,
    });

  it('surfaces the response status on the row itself, unopened', () => {
    // The one fact worth reading without a click: 400 and 500 send you to
    // different places.
    expect(render(ready([withTranscript()]))).toContain('HTTP 400');
  });

  it('offers a row with a transcript as expandable, and one without as not', () => {
    expect(render(ready([withTranscript()]))).toContain('aria-expanded="false"');
    // Nothing recorded → nothing to open. An empty code block would read as
    // "we sent nothing", which is a different and false claim.
    expect(render(ready([delivery()]))).toContain('disabled=""');
  });

  it('marks a test delivery as a test rather than hiding it', () => {
    // It reaches the endpoint for real, so it belongs in the log — but it is not
    // a respondent's lead, and reading it as one sends someone hunting for a
    // submission that never happened.
    const html = render(ready([delivery({ action: 'ping' })]));
    expect(html).toContain('delivery-test-badge');
    expect(html).toContain(m.historyTestBadge);
    expect(html).toContain('data-action="ping"');
  });

  it('does not badge a real delivery as a test', () => {
    const html = render(ready([delivery({ action: 'complete' })]));
    expect(html).not.toContain('delivery-test-badge');
  });
});

describe('which cards can list a test delivery', () => {
  it('is the webhook only', () => {
    expect(hasTestSends(['webhook'])).toBe(true);
    expect(hasTestSends(['salesforce'])).toBe(false);
    expect(hasTestSends(['google-sheets'])).toBe(false);
    expect(hasTestSends(['hubspot', 'booking_sync'])).toBe(false);
    expect(hasTestSends(['email'])).toBe(false);
  });
});

describe('a history read in Spanish', () => {
  it('names the lifecycle moment instead of the queue identifier', () => {
    const html = render(ready([delivery({ id: 'a', action: 'complete' }), delivery({ id: 'b', action: 'partial' })]), true, {
      locale: 'es',
    });
    expect(html).toContain('Respuesta completa');
    expect(html).toContain('Respuesta parcial');
    expect(html).not.toMatch(/>complete</);
    expect(html).not.toMatch(/>partial</);
  });

  it("translates dForms' half of a reason and keeps the provider's", () => {
    const html = render(
      ready([delivery({ kind: 'salesforce', status: 'failed', lastError: 'salesforce delivery failed: HTTP 503' })]),
      true,
      { locale: 'es' },
    );
    expect(html).toContain('Falló la entrega a Salesforce: HTTP 503');
    expect(html).not.toContain('salesforce delivery failed');
  });

  it('counts the red chip under the same neutral label', () => {
    const html = render(ready([delivery({ status: 'failed' })]), false, { locale: 'es' });
    expect(html).toContain('Para revisar: 1');
  });
});

describe('describeDeliveryReason', () => {
  it("keeps a provider's refusal text verbatim behind dForms' own words", () => {
    expect(
      describeDeliveryReason('google-sheets', 'HTTP 404: Requested entity was not found.', es),
    ).toBe('Rechazada por Google Sheets con HTTP 404: Requested entity was not found.');
    expect(describeDeliveryReason('salesforce', 'HTTP 400', m)).toBe('Refused by Salesforce with HTTP 400.');
  });

  it('words a revoked Google connection, which is how a lost spreadsheet access surfaces', () => {
    expect(describeDeliveryReason('google-sheets', 'google sheets destination has no usable access token', es)).toBe(
      es.historyReasons.sheetsNotConnected,
    );
  });

  it('translates HubSpot and network failures, keeping the detail', () => {
    expect(describeDeliveryReason('hubspot', 'hubspot upsert failed: HTTP 429 {"x":1}', es)).toBe(
      'Falló la entrega a HubSpot: HTTP 429 {"x":1}',
    );
    expect(describeDeliveryReason('google-sheets', 'google sheets delivery failed: fetch failed', m)).toBe(
      'Delivery to Google Sheets failed: fetch failed',
    );
  });

  it('words the booking sync, which writes HubSpot too', () => {
    expect(describeDeliveryReason('booking_sync', 'hubspot booking upsert failed: HTTP 502', es)).toBe(
      'Falló la entrega a HubSpot: HTTP 502',
    );
    expect(
      describeDeliveryReason(
        'booking_sync',
        'hubspot booking upsert rejected (HTTP 400). Check the configured booking properties',
        es,
      ),
    ).toBe(es.historyReasons.bookingRejected.replace('{status}', '400'));
  });

  it('never rewrites a provider sentence that only contains a known phrase', () => {
    const text = 'Contact has no email in submission field X';
    expect(describeDeliveryReason('hubspot', text, es)).toBe(text);
  });

  it('labels an action it does not know with its own name', () => {
    expect(deliveryActionLabel('complete', es)).toBe('Respuesta completa');
    expect(deliveryActionLabel('something_new', es)).toBe('something_new');
    expect(deliveryActionLabel('toString', es)).toBe('toString');
  });
});
