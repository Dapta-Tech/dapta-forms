/**
 * The integration cards while spam protection holds a form's partial answers.
 *
 * With protection on, the API saves a partial but delivers it nowhere, whatever
 * the webhook's triggers say. The cards must say so: the Partial trigger reads
 * as paused (it is left as saved, so switching protection off restores it), a
 * webhook that ONLY listens to partials is called out as one that will not
 * fire, and HubSpot explains the contact now syncs on complete.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ContactKeyReadiness } from '@quill/engine';
import { getMessages } from '@quill/shared';
import { HubspotCard, WebhookCard } from './integrations-editor';

const m = getMessages('en').admin.integrations;

function webhook(over: { firePartial: boolean; fireComplete: boolean; partialsHeld?: boolean; enabled?: boolean }) {
  return renderToStaticMarkup(
    <WebhookCard
      state={{
        enabled: over.enabled ?? true,
        url: 'https://hooks.example.com/in',
        secret: '',
        hasSecret: false,
        firePartial: over.firePartial,
        fireComplete: over.fireComplete,
      }}
      onChange={() => {}}
      urlError={null}
      clearUrlError={() => {}}
      formId="form-1"
      carriedCount={0}
      partialsHeld={over.partialsHeld}
      locale="en"
      m={m}
    />,
  );
}

describe('WebhookCard with partials held', () => {
  it('marks the Partial trigger paused, and keeps it checked as saved', () => {
    const html = webhook({ firePartial: true, fireComplete: true, partialsHeld: true });
    expect(html).toContain('data-testid="webhook-partial-held"');
    expect(html).toContain(m.eventPartialHeld);
    expect(html).not.toContain('data-testid="webhook-partial-only-held"');
  });

  it('calls out a partial-only webhook as one that will not fire', () => {
    const html = webhook({ firePartial: true, fireComplete: false, partialsHeld: true });
    expect(html).toContain('data-testid="webhook-partial-only-held"');
    expect(html).toContain(m.webhookPartialOnlyHeld);
  });

  it('says nothing for a complete-only webhook: nothing it listens to is held', () => {
    const html = webhook({ firePartial: false, fireComplete: true, partialsHeld: true });
    expect(html).not.toContain('data-testid="webhook-partial-held"');
    expect(html).not.toContain('data-testid="webhook-partial-only-held"');
  });

  it('is exactly today’s card when nothing is held (protection off, or no keys on the deployment)', () => {
    for (const partialsHeld of [false, undefined]) {
      const html = webhook({ firePartial: true, fireComplete: false, partialsHeld });
      expect(html).not.toContain('webhook-partial-held');
      expect(html).not.toContain('webhook-partial-only-held');
    }
  });
});

describe('HubspotCard with partials held', () => {
  const ready = { ok: true, blocker: null, source: { kind: 'question', key: 'email' } } as ContactKeyReadiness;

  function hubspot(partialsHeld: boolean | undefined) {
    return renderToStaticMarkup(
      <HubspotCard
        state={{
          enabled: true,
          fieldMappings: [],
          utmMappings: {},
          scoreProperty: '',
          dateProperty: '',
          note: true,
          formActivity: false,
          valueMaps: [],
          outcomeProperty: '',
          staticProperties: [],
          inferCompanyFromEmail: false,
          bookingSync: { stageProperty: '', stageValue: '', dateProperty: '', hoursProperty: '' },
          dayTimezone: '',
        }}
        onChange={() => {}}
        properties={[]}
        pickerEnabled
        accountConnected
        showMapping
        extraHubspotStored={false}
        readiness={ready}
        questions={[{ key: 'email', type: 'email', label: 'Email' }]}
        formId="form-1"
        partialsHeld={partialsHeld}
        m={m}
      />,
    );
  }

  it('explains the contact syncs on complete', () => {
    const html = hubspot(true);
    expect(html).toContain('data-testid="hubspot-partial-held"');
    expect(html).toContain(m.hubspotPartialHeld);
  });

  it('says nothing when nothing is held', () => {
    expect(hubspot(false)).not.toContain('hubspot-partial-held');
    expect(hubspot(undefined)).not.toContain('hubspot-partial-held');
  });
});
