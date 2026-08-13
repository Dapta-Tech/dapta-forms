/**
 * Webhooks this screen does not edit.
 *
 * The Connect tab's webhook card reads the FIRST stored webhook and used to be
 * the only one the save path emitted, so a form legitimately holding two lost
 * the second on any edit here — including one made to HubSpot, since autosave
 * rewrites the whole `destinations` array. Nothing warned, and nothing could:
 * the deleted webhook was never rendered on this screen.
 *
 * Two halves are pinned here. `carriedWebhooks` is the rule about WHICH ones
 * ride along, and the card's notice is what tells the author they exist —
 * placed in the `notice` slot, so it survives a card switched off. That is not
 * decoration: flipping the switch is itself an edit, and the autosave it fires
 * is what rewrites the array.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getMessages } from '@quill/shared';
import type { FormDestination } from '@quill/types';
import { carriedWebhooks, WebhookCard } from './integrations-editor';

const m = getMessages('en').admin.integrations;

const hook = (url: string, over: Record<string, unknown> = {}): FormDestination =>
  ({ type: 'webhook', enabled: true, settings: { url }, ...over }) as unknown as FormDestination;

const hubspot = (): FormDestination =>
  ({ type: 'hubspot', enabled: true, settings: {} }) as unknown as FormDestination;

describe('carriedWebhooks', () => {
  it('carries nothing when the form has one webhook or none', () => {
    expect(carriedWebhooks([])).toEqual([]);
    expect(carriedWebhooks([hubspot()])).toEqual([]);
    expect(carriedWebhooks([hook('https://a.test/one'), hubspot()])).toEqual([]);
  });

  it('carries every webhook after the first, in stored order', () => {
    const second = hook('https://b.test/two', { id: 'w2' });
    const third = hook('https://c.test/three', { id: 'w3' });
    expect(carriedWebhooks([hook('https://a.test/one'), second, hubspot(), third])).toEqual([
      second,
      third,
    ]);
  });

  it('carries them BY REFERENCE, so nothing about them is re-derived', () => {
    // They are written back verbatim: re-deriving would re-encode a masked
    // secret or drop a field this screen has no editor for.
    const second = hook('https://b.test/two', { id: 'w2', events: ['partial'] });
    expect(carriedWebhooks([hook('https://a.test/one'), second])[0]).toBe(second);
  });

  it('does not treat a HubSpot destination as a webhook', () => {
    expect(carriedWebhooks([hubspot(), hubspot()])).toEqual([]);
  });
});

describe('WebhookCard — the carried-webhooks notice', () => {
  function markup(over: { enabled: boolean; carriedCount: number }): string {
    return renderToStaticMarkup(
      <WebhookCard
        state={{
          enabled: over.enabled,
          url: 'https://a.test/one',
          secret: '',
          hasSecret: false,
          firePartial: true,
          fireComplete: true,
        }}
        onChange={() => {}}
        urlError={null}
        clearUrlError={() => {}}
        formId="form-1"
        carriedCount={over.carriedCount}
        m={m}
      />,
    );
  }

  const NOTICE = 'data-testid="webhook-carried"';

  it('shows the notice on a card switched OFF, where the settings are hidden', () => {
    const html = markup({ enabled: false, carriedCount: 1 });
    expect(html).toContain(NOTICE);
    // The settings really are hidden — otherwise the assertion above is trivial.
    expect(html).not.toContain('data-testid="webhook-ping"');
  });

  it('shows the notice on a card switched ON, beside the settings', () => {
    const html = markup({ enabled: true, carriedCount: 2 });
    expect(html).toContain(NOTICE);
    expect(html).toContain('data-testid="webhook-ping"');
  });

  it('names how many ride along', () => {
    expect(markup({ enabled: true, carriedCount: 2 })).toContain('2 more webhook(s)');
  });

  it('says nothing on the ordinary single-webhook form', () => {
    for (const enabled of [true, false]) {
      expect(markup({ enabled, carriedCount: 0 })).not.toContain(NOTICE);
    }
  });
});
