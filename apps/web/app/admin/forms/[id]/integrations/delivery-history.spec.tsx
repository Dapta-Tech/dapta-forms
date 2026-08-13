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
 *   5. the ping note is always present, so "I sent a test and nothing showed up"
 *      reads as the truth rather than as a bug in this panel.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getMessages } from '@quill/shared';
import type { FormDelivery } from '@/lib/admin-api';
import { DeliveryHistoryView, isFailure, type HistoryState } from './delivery-history';

const m = getMessages('en').admin.integrations;

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

const render = (state: HistoryState, open = true): string =>
  renderToStaticMarkup(
    <DeliveryHistoryView
      state={state}
      open={open}
      onOpen={() => {}}
      onClose={() => {}}
      onRefresh={() => {}}
      title={m.historyWebhookTitle}
      locale="en"
      m={m}
      testId="webhook-history"
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
    expect(html).toContain('1 failed');
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

  it("shows a failure's reason verbatim", () => {
    const html = render(
      ready([delivery({ status: 'failed', lastError: 'webhook delivery failed: HTTP 400' })]),
    );
    expect(html).toContain('webhook delivery failed: HTTP 400');
    expect(html).toContain('data-status="failed"');
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
    expect(html).toContain('partial');
    expect(html).toContain('complete');
  });

  it('offers an empty state rather than an empty box', () => {
    expect(render(ready([]))).toContain(m.historyEmpty);
  });

  it('keeps the card usable when the lookup failed', () => {
    const html = render({ status: 'error' });
    expect(html).toContain(m.historyLoadError);
    expect(html).toContain('role="alert"');
  });

  it('always explains that a test delivery is not queued', () => {
    // The question ("where is my ping?") arrives exactly when the list is empty.
    expect(render(ready([]))).toContain(m.historyPingNote);
    expect(render(ready([delivery()]))).toContain(m.historyPingNote);
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
