// @vitest-environment happy-dom
/**
 * A preloaded Calendly widget the caller stops offering after mount.
 *
 * The case: a form embedded in a landing with a campaign, the form's own URL
 * with none, and the scheduler on screen before the landing's campaign is
 * known. The screen adopts the preloaded widget (the campaign was the page's
 * own, empty set), then the campaign arrives and the renderer withdraws the
 * preload key, since a preloaded widget cannot carry it. The adopted widget is
 * let go; the screen must then boot the cold embed, not sit on an empty slot.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const preload = vi.hoisted(() => ({
  CALENDLY_FALLBACK_HEIGHT: 700,
  hasPreloadedCalendly: vi.fn(() => true),
  holdCalendlyPreload: vi.fn(() => () => undefined),
  release: vi.fn(),
  showPreloadedCalendly: vi.fn(),
}));
vi.mock('@/lib/calendly-preload', () => preload);

const embed = vi.hoisted(() => ({
  loadCalendlyScript: vi.fn(async () => undefined),
  warmBookingEmbed: vi.fn(),
  attachBookingMessageListener: vi.fn(() => () => undefined),
  dcalMessageOrigin: vi.fn(() => null),
}));
vi.mock('@/lib/booking-embed', () => embed);

import { BookingScreen } from './booking-screen';

const URL_ = 'https://calendly.com/acme/intro';
let root: Root | null = null;
let host: HTMLElement | null = null;
const initInlineWidget = vi.fn();

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { Calendly: unknown }).Calendly = { initInlineWidget };
  preload.showPreloadedCalendly.mockImplementation((...args: unknown[]) => {
    (args[3] as { onShown: () => void }).onShown();
    return preload.release;
  });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.clearAllMocks();
});

const screen = (opts: { preloadKey?: string; utm?: Record<string, string> }) => (
  <BookingScreen
    booking={{ provider: 'calendly', url: URL_ }}
    answers={{}}
    sessionId="sess_1"
    preloadKey={opts.preloadKey}
    utm={opts.utm}
    onBooked={() => {}}
  />
);

describe('BookingScreen: a preload withdrawn after mount', () => {
  it('lets the adopted widget go and boots the cold embed with the campaign', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(screen({ preloadKey: URL_, utm: {} })));
    expect(preload.showPreloadedCalendly).toHaveBeenCalledTimes(1);
    expect(initInlineWidget).not.toHaveBeenCalled();

    // The landing's campaign arrives; the renderer withdraws the key.
    await act(async () => root!.render(screen({ utm: { utm_content: 'carousel-2' } })));
    await act(async () => {});

    expect(preload.release).toHaveBeenCalled();
    expect(initInlineWidget).toHaveBeenCalledTimes(1);
    const url = new URL((initInlineWidget.mock.calls[0]![0] as { url: string }).url);
    expect(url.searchParams.get('utm_content')).toBe('carousel-2');
    // The plain slot, not the adopted one, so nothing is left blank under it.
    expect(host.querySelector('[data-testid="booking-embed-calendly"]')?.hasAttribute('data-preloaded')).toBe(false);
  });

  it('keeps the adopted widget while the key stays', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(screen({ preloadKey: URL_ })));
    await act(async () => root!.render(screen({ preloadKey: URL_ })));
    expect(preload.release).not.toHaveBeenCalled();
    expect(initInlineWidget).not.toHaveBeenCalled();
  });
});
