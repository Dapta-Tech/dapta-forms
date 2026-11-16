// @vitest-environment happy-dom
/**
 * The canvas card a dCal scheduler shows.
 *
 * Unpicked, it is the SETUP card rather than Calendly's "nothing configured"
 * line: this is the first place most authors meet dCal, so it says what dCal
 * is and offers the only two moves that make sense there. Picked, it is the
 * real booking page in an iframe, as the published form will render it.
 *
 * The back-compat rule is pinned here too, because it is the one a wrong
 * default would break silently: a scheduler with NO provider is Calendly, and
 * must go on rendering exactly as it did before dCal existed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FormStep } from '@quill/engine';
// The Calendly branch loads Calendly's widget script, and happy-dom tries to
// FETCH it: a unit test must not reach the network, and the unhandled failure
// exits vitest non-zero even while every assertion passes. The back-compat
// cases here only assert which branch rendered, so the loader is stubbed.
vi.mock('@/lib/booking-embed', () => ({ loadCalendlyScript: () => new Promise(() => {}) }));

import { SchedulerEmbedPreview } from './scheduler-embed-preview';
import { getBuilderMessages } from './builder-messages';

const m = getBuilderMessages('en');
const DCAL_URL = 'https://cal.example.test/dapta/ana/intro-call';

let root: Root | null = null;
let container: HTMLElement | null = null;
const fetchMock = vi.fn();

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  fetchMock.mockReset();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function step(scheduler: FormStep['scheduler']): FormStep {
  return { key: 'scheduler_1', type: 'scheduler', question: '', required: true, scheduler };
}

async function mount(s: FormStep['scheduler']) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<SchedulerEmbedPreview step={step(s)} m={m} />);
  });
  return container;
}

describe('the canvas card before an event type is picked', () => {
  it('sells dCal instead of only saying nothing is configured', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ enabled: true, createEventUrl: 'https://cal.example.test/admin/event-types' }),
    });
    const el = await mount({ provider: 'dcal', prefill: true });
    const card = el.querySelector('[data-testid="canvas-scheduler-dcal-setup"]')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain(m.canvas.schedulerDcalSetupTitle);
    expect(card.textContent).toContain(m.canvas.schedulerDcalSetupPointOne);
    // Calendly's bare placeholder must not be what a dCal step shows.
    expect(el.textContent).not.toContain(m.canvas.schedulerUnset);
  });

  it('links out to dCal to create one, in a new tab', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ enabled: true, createEventUrl: 'https://cal.example.test/admin/event-types' }),
    });
    const el = await mount({ provider: 'dcal', prefill: true });
    const link = el.querySelector<HTMLAnchorElement>('[data-testid="canvas-scheduler-dcal-create"]')!;
    expect(link.getAttribute('href')).toBe('https://cal.example.test/admin/event-types');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('drops the create link when the deployment reports no dCal', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ enabled: false, reason: 'no dcal' }) });
    const el = await mount({ provider: 'dcal', prefill: true });
    // The card still explains what dCal is; only the dead link goes.
    expect(el.querySelector('[data-testid="canvas-scheduler-dcal-setup"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="canvas-scheduler-dcal-create"]')).toBeNull();
  });
});

describe('the canvas card once an event type is picked', () => {
  it('embeds the booking page itself, in embed mode', async () => {
    const el = await mount({ provider: 'dcal', url: DCAL_URL, eventTypeName: 'Intro call' });
    const frame = el.querySelector<HTMLIFrameElement>('[data-testid="canvas-scheduler-dcal"]')!;
    expect(new URL(frame.getAttribute('src')!).searchParams.get('embed')).toBe('1');
    expect(el.textContent).toContain('Intro call');
    expect(el.querySelector('[data-testid="canvas-scheduler-dcal-setup"]')).toBeNull();
  });

  it('asks the list endpoint for nothing once there is an event to show', async () => {
    await mount({ provider: 'dcal', url: DCAL_URL, eventTypeName: 'Intro call' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('a scheduler authored before dCal existed', () => {
  it('still renders as Calendly when it names no provider', async () => {
    const el = await mount({ url: 'https://calendly.com/dapta/intro', eventTypeName: 'Intro' });
    expect(el.querySelector('[data-testid="canvas-scheduler-dcal"]')).toBeNull();
    expect(el.querySelector('[data-testid="canvas-scheduler-dcal-setup"]')).toBeNull();
    expect(el.querySelector('[data-testid="canvas-scheduler-preview"]')).not.toBeNull();
  });

  it('shows Calendly’s own placeholder when it names no provider and no event', async () => {
    const el = await mount({ prefill: true });
    expect(el.textContent).toContain(m.canvas.schedulerUnset);
    expect(el.querySelector('[data-testid="canvas-scheduler-dcal-setup"]')).toBeNull();
  });
});
