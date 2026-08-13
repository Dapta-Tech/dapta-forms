/**
 * The account's webhook inventory, rendered.
 *
 * The section makes three promises that are easy to break with a well-meaning
 * edit, so they are pinned here rather than left to review:
 *
 *   1. a DISABLED webhook is still listed. Hiding it would erase the single most
 *      useful thing this table can tell you — that a form stopped sending and
 *      nobody noticed.
 *   2. nothing is rendered in the Delivery column unless something actually
 *      failed. There is no "healthy" badge, because successful deliveries are
 *      never queried and a quiet queue is indistinguishable from a webhook that
 *      has never run.
 *   3. the row links into the form's editor tab, which is where webhooks are
 *      edited — not into the retired per-form integrations route.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getMessages } from '@quill/shared';
import type { AccountWebhook } from '@/lib/admin-api';
import { WebhooksSection } from './webhooks-section';

const m = getMessages('en').admin.connections.webhooks;

const webhook = (over: Partial<AccountWebhook> = {}): AccountWebhook => ({
  formId: 'form-1',
  formName: 'Lead qualifier',
  webhookId: 'w1',
  url: 'https://acme.io/hook',
  enabled: true,
  firesPartial: true,
  firesComplete: true,
  hasSecret: false,
  failures: null,
  ...over,
});

const render = (items: AccountWebhook[], loadError = false): string =>
  renderToStaticMarkup(
    <WebhooksSection items={items} loadError={loadError} m={m} locale="en" />,
  );

describe('WebhooksSection', () => {
  it('invites the reader to a form when there is nothing to list', () => {
    const html = render([]);
    expect(html).toContain(m.emptyTitle);
    expect(html).toContain('/admin/forms');
    expect(html).not.toContain('<table');
  });

  it('says so when the list could not be loaded, instead of claiming emptiness', () => {
    const html = render([], true);
    expect(html).toContain(m.loadError);
    expect(html).not.toContain(m.emptyTitle);
  });

  it('lists a disabled webhook rather than hiding it', () => {
    const html = render([webhook({ enabled: false })]);
    expect(html).toContain('data-state="off"');
    expect(html).toContain('https://acme.io/hook');
  });

  it('links each row into the form’s Connect tab', () => {
    const html = render([webhook()]);
    expect(html).toContain('href="/admin/forms/form-1/edit?tab=connect"');
  });

  it('keeps a long endpoint on one line, with the whole value reachable', () => {
    const url = `https://very-long-host.example.com/${'segment/'.repeat(20)}end`;
    const html = render([webhook({ url })]);
    expect(html).toContain('truncate');
    expect(html).toContain(`title="${url}"`);
  });

  it('names the phases a webhook fires on', () => {
    expect(render([webhook()])).toContain(m.eventsBoth);
    expect(render([webhook({ firesPartial: false })])).toContain(m.eventsComplete);
    expect(render([webhook({ firesComplete: false })])).toContain(m.eventsPartial);
  });

  it('shows nothing in Delivery until something has failed', () => {
    expect(render([webhook()])).not.toContain('webhook-health');
    // ...and no scope note either, since there is no count to qualify.
    expect(render([webhook()])).not.toContain(m.failuresScopeNote);

    const failing = render([
      webhook({ failures: { count: 3, lastError: 'HTTP 502', lastAt: 1_755_000_000_000 } }),
    ]);
    expect(failing).toContain('webhook-health');
    expect(failing).toContain('3 failed');
    expect(failing).toContain('HTTP 502');
    expect(failing).toContain(m.failuresScopeNote);
  });

  it('renders one row per webhook when a form owns two', () => {
    const html = render([
      webhook({ webhookId: 'w1', url: 'https://a.test/one' }),
      webhook({ webhookId: 'w2', url: 'https://a.test/two' }),
    ]);
    expect(html.match(/data-testid="webhook-row"/g)).toHaveLength(2);
  });

  it('marks a signed webhook without showing anything of the secret', () => {
    expect(render([webhook({ hasSecret: false })])).not.toContain('pi-lock');
    expect(render([webhook({ hasSecret: true })])).toContain('pi-lock');
  });

  it('never gives its heading the accessible name of a connection card', () => {
    // The connect e2e locates the HubSpot and Calendly cards by their level-2
    // heading; a section heading matching either would capture that locator.
    const html = render([webhook()]);
    expect(html).toContain(`<h2 class="text-lg font-semibold text-foreground">${m.title}</h2>`);
    expect(html).not.toContain('>HubSpot</h2>');
    expect(html).not.toContain('>Calendly</h2>');
  });
});
