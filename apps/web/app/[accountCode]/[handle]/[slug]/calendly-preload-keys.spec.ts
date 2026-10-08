/**
 * Which Calendly embeds a form boots hidden (`preloadableCalendlyKeys`), and
 * that each key is exactly what the renderer later hands `BookingScreen`, so
 * the preloaded widget is adopted rather than a second one booted.
 */
import { describe, expect, it } from 'vitest';
import type { FormStep } from '@quill/engine';
import type { OutcomeBooking } from '@quill/types';
import {
  MAX_PRELOADED_CALENDLY,
  preloadableCalendlyKeys,
  schedulerToBooking,
} from './renderer-shared';

const P1 = 'https://calendly.com/d/aaaa/p1';
const P2 = 'https://calendly.com/d/bbbb/p2';
const P3 = 'https://calendly.com/d/cccc/p3';

function scheduler(key: string, scheduler: FormStep['scheduler']): FormStep {
  return { key, type: 'scheduler', question: key, scheduler } as FormStep;
}
const question = { key: 'q1', type: 'text', question: 'Q' } as FormStep;

describe('preloadableCalendlyKeys', () => {
  it('keys one widget per tier scheduler, in step order', () => {
    const steps = [
      question,
      scheduler('p1', { provider: 'calendly', url: P1, hideEventDetails: true }),
      scheduler('p2', { url: P2 }),
      scheduler('p3', { provider: 'calendly', url: P3 }),
    ];
    expect(preloadableCalendlyKeys({ steps })).toEqual([`${P1}?hide_event_type_details=1`, P2, P3]);
  });

  it('matches the key the renderer passes for that step (no mapped custom answers)', () => {
    const step = scheduler('p1', { url: P1, hideEventDetails: true });
    const [key] = preloadableCalendlyKeys({ steps: [step] });
    expect(key).toBe(schedulerToBooking(step.scheduler!)?.url);
    // The answers' custom fields ride the cold URL, never the key.
    expect(schedulerToBooking(step.scheduler!, { a2: 'Acme' })?.url).not.toBe(key);
  });

  it('skips HubSpot Meetings, other hosts, unpicked and unsafe schedulers', () => {
    const steps = [
      scheduler('custom', { url: 'https://book.acme.com/intro' }),
      scheduler('http', { url: 'http://calendly.com/d/aaaa/p1' }),
      scheduler('hs', { provider: 'hubspot_meetings', url: 'https://meetings.hubspot.com/ada' }),
      scheduler('empty', { provider: 'calendly' }),
      scheduler('js', { url: 'javascript:alert(1)' }),
    ];
    expect(preloadableCalendlyKeys({ steps })).toEqual([]);
  });

  it('adds Calendly outcome bookings after the steps, deduped', () => {
    const outcomes: { booking?: OutcomeBooking | null }[] = [
      { booking: { provider: 'calendly', url: P2 } },
      { booking: { provider: 'hubspot_meetings', url: 'https://meetings.hubspot.com/ada' } },
      { booking: null },
      {},
    ];
    expect(preloadableCalendlyKeys({ steps: [scheduler('p2', { url: P2 })], outcomes })).toEqual([
      P2,
    ]);
    expect(preloadableCalendlyKeys({ steps: [], outcomes })).toEqual([P2]);
  });

  it(`caps the set at ${MAX_PRELOADED_CALENDLY}`, () => {
    const steps = [1, 2, 3, 4, 5].map((n) =>
      scheduler(`s${n}`, { url: `https://calendly.com/d/x/${n}` }),
    );
    expect(preloadableCalendlyKeys({ steps })).toHaveLength(MAX_PRELOADED_CALENDLY);
  });

  it('is empty for a form without a scheduler', () => {
    expect(preloadableCalendlyKeys({ steps: [question] })).toEqual([]);
  });
});
