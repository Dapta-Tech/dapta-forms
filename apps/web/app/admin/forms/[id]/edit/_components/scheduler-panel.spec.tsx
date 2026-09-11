/**
 * The scheduler panel's "paste a link" mode, on first render.
 *
 * `scheduler-link.spec.ts` proves what a pasted link parses to; this proves
 * the panel puts that field where an author can reach it. Static markup only
 * (the web suite runs in plain node): the event-type fetch never resolves
 * here, so the panel stays in its initial `loading` state — which is exactly
 * the render at issue. A step configured by link must show its link at once,
 * because that link never depended on the list; a step with nothing picked
 * shows the loading line and no link field, so the picker stays the first
 * thing an author meets.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FormStep } from '@quill/engine';
import { SchedulerPanel } from './scheduler-panel';
import { getBuilderMessages } from './builder-messages';

const bm = getBuilderMessages('en');

function render(scheduler: NonNullable<FormStep['scheduler']>) {
  return renderToStaticMarkup(
    <SchedulerPanel
      scheduler={scheduler}
      onChange={() => {}}
      fields={[]}
      laterSteps={[]}
      goto={undefined}
      onGotoChange={() => {}}
      bm={bm}
    />,
  );
}

describe('SchedulerPanel — configured by link', () => {
  it('shows the saved link immediately, before the event-type list loads', () => {
    const html = render({
      provider: 'calendly',
      eventTypeUri: null,
      eventTypeName: 'Onboarding scale up',
      url: 'https://calendly.com/dapta-onboarding/onboarding-scale_up',
    });
    expect(html).toContain('data-testid="scheduler-link"');
    expect(html).toContain('value="https://calendly.com/dapta-onboarding/onboarding-scale_up"');
    expect(html, 'not waiting on the list').not.toContain(bm.settings.schedulerLoading);
    // Autofill: name + email only, and the hint says why the event's own
    // questions are not offered.
    expect(html).toContain('data-testid="scheduler-map-name"');
    expect(html).toContain('data-testid="scheduler-map-email"');
    expect(html).toContain(bm.settings.schedulerMapLinkHint);
  });

  it('keeps the picker first when nothing is configured', () => {
    const html = render({ provider: 'calendly', prefill: true });
    expect(html).toContain(bm.settings.schedulerLoading);
    expect(html).not.toContain('data-testid="scheduler-link"');
    expect(html).toContain(bm.settings.schedulerMapPickFirst);
  });

  it('a picked event type is not link mode, even though it also stores a url', () => {
    const html = render({
      provider: 'calendly',
      eventTypeUri: 'https://api.calendly.com/event_types/ET1',
      eventTypeName: 'Demo 30m',
      url: 'https://calendly.com/acme/demo',
    });
    expect(html).not.toContain('data-testid="scheduler-link"');
  });
});
