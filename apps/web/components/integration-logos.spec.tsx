// @vitest-environment happy-dom
/**
 * The rail's Integrations icon: the marks of the services dForms connects to,
 * taking turns on the same clock and rules as the "Connect your agent" logos.
 * Dapta's mark only on a Dapta build; still under prefers-reduced-motion,
 * where HubSpot is the static icon; still while the pointer is on the row.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationLogos, INTEGRATION_LOGOS, integrationLogosFor } from './integration-logos';
import { LOGO_ROTATE_MS } from './logo-rotation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let reduced = false;

beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('reduce') && reduced,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mount(props: { paused?: boolean; daptaBrand?: boolean } = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<IntegrationLogos daptaBrand {...props} />));
}
const active = () => host.querySelector('[data-active="true"]')?.getAttribute('data-logo');
const tick = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

describe('IntegrationLogos', () => {
  it('stacks every integration mark, Dapta included, hidden from screen readers in a fixed square', async () => {
    await mount();
    const stack = host.querySelector<HTMLElement>('[data-testid="integration-logos"]')!;
    expect(stack.getAttribute('aria-hidden')).toBe('true');
    expect(stack.style.width).toBe('20px');
    expect(stack.style.height).toBe('20px');
    const logos = [...stack.querySelectorAll<HTMLElement>('.mcp-logos__logo')].map((l) => l.dataset.logo);
    expect(logos).toEqual([
      'hubspot',
      'salesforce',
      'gohighlevel',
      'google-sheets',
      'calendly',
      'dcal',
      'dapta',
    ]);
    expect(host.querySelectorAll('.is-active')).toHaveLength(1);
    expect(active()).toBe('hubspot');
  });

  it('draws each service with the mark the app already ships for it', async () => {
    await mount();
    const at = (logo: string) => host.querySelector(`[data-logo="${logo}"]`)!;
    expect(at('hubspot').querySelector('[data-provider-logo="hubspot"]')).not.toBeNull();
    expect(at('salesforce').querySelector('[data-provider-logo="salesforce"]')).not.toBeNull();
    expect(at('calendly').querySelector('[data-provider-logo="calendly"]')).not.toBeNull();
    expect(at('google-sheets').querySelector('[data-provider-logo="gsheets"]')).not.toBeNull();
    expect(at('gohighlevel').querySelector('[data-provider-logo="gohighlevel"]')).not.toBeNull();
    expect(at('dcal').querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 1141.464 715.8');
    // Dapta's `d`, cropped viewBox from brand/dapta-logo.tsx.
    expect(at('dapta').querySelector('svg')?.getAttribute('viewBox')).toBe('60.06 76.92 142.37 145.04');
  });

  it("leaves Dapta's mark out of a fork's rail", async () => {
    expect(integrationLogosFor(false)).not.toContain('dapta');
    expect(integrationLogosFor(true)).toEqual(INTEGRATION_LOGOS);
    await mount({ daptaBrand: false });
    expect(host.querySelector('[data-logo="dapta"]')).toBeNull();
    expect(host.querySelectorAll('.mcp-logos__logo')).toHaveLength(INTEGRATION_LOGOS.length - 1);
  });

  it('takes turns half a beat after the agent logos, then on the same interval, and wraps around', async () => {
    await mount();
    await tick(LOGO_ROTATE_MS);
    expect(active()).toBe('hubspot');
    await tick(800);
    expect(active()).toBe('salesforce');
    await tick(LOGO_ROTATE_MS);
    expect(active()).toBe('gohighlevel');
    await tick(LOGO_ROTATE_MS * (INTEGRATION_LOGOS.length - 2));
    expect(active()).toBe('hubspot');
  });

  it('holds still while paused', async () => {
    await mount({ paused: true });
    await tick(LOGO_ROTATE_MS * 5);
    expect(active()).toBe('hubspot');
  });

  it('shows one static logo under prefers-reduced-motion', async () => {
    reduced = true;
    await mount();
    await tick(LOGO_ROTATE_MS * 10);
    expect(active()).toBe('hubspot');
    expect(host.querySelectorAll('.is-active')).toHaveLength(1);
  });
});
