import { describe, expect, it } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import Script from 'next/script';
import { DEFAULT_POSTHOG_HOST, type ResolvedTracking } from './resolve-tracking';
import { TrackingScripts } from './tracking-scripts';

/**
 * next/script with `afterInteractive` renders null on the server and injects
 * the actual <script> tag client-side, so these specs assert on the React
 * element tree (which Script/noscript elements exist and with which props)
 * rather than on serialized markup. E2e asserts the injected DOM tags via the
 * same data-testid attributes.
 */

type AnyProps = Record<string, unknown> & { children?: ReactNode };

/** Depth-first flatten of a React element tree (no rendering, no DOM). */
function collect(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  out.push(node);
  collect((node.props as AnyProps).children, out);
  return out;
}

const OFF: ResolvedTracking = {
  gtmId: null,
  metaPixelId: null,
  posthogKey: null,
  posthogHost: DEFAULT_POSTHOG_HOST,
  hubspotTrackingId: null,
};

function render(overrides: Partial<ResolvedTracking>): ReactElement[] {
  return collect(TrackingScripts({ tracking: { ...OFF, ...overrides } }));
}

function testIds(elements: ReactElement[]): string[] {
  return elements
    .map((el) => (el.props as AnyProps)['data-testid'])
    .filter((id): id is string => typeof id === 'string');
}

function byTestId(elements: ReactElement[], id: string): ReactElement {
  const found = elements.find((el) => (el.props as AnyProps)['data-testid'] === id);
  expect(found, `expected an element with data-testid="${id}"`).toBeDefined();
  return found!;
}

function inlineSnippet(el: ReactElement): string {
  const children = (el.props as AnyProps).children;
  expect(typeof children).toBe('string');
  return children as string;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('TrackingScripts', () => {
  it('renders NOTHING when every tracker is off (zero third-party requests)', () => {
    expect(TrackingScripts({ tracking: OFF })).toBeNull();
  });

  it('renders only the GTM script + noscript iframe when only gtmId is set', () => {
    const els = render({ gtmId: 'GTM-TEST123' });
    expect(testIds(els).sort()).toEqual(['tracking-gtm', 'tracking-gtm-noscript']);

    const script = byTestId(els, 'tracking-gtm');
    expect(script.type).toBe(Script);
    const snippet = inlineSnippet(script);
    expect(snippet).toContain('https://www.googletagmanager.com/gtm.js');
    expect(snippet).toContain('"GTM-TEST123"');
    expect(snippet).toContain("'dataLayer'");

    const noscript = byTestId(els, 'tracking-gtm-noscript');
    expect(noscript.type).toBe('noscript');
    const iframe = collect((noscript.props as AnyProps).children).find(
      (el) => el.type === 'iframe',
    );
    expect(iframe).toBeDefined();
    expect((iframe!.props as AnyProps).src).toBe(
      'https://www.googletagmanager.com/ns.html?id=GTM-TEST123',
    );
  });

  it('renders the Meta Pixel with init + exactly one PageView when only metaPixelId is set', () => {
    const els = render({ metaPixelId: '1234567890' });
    expect(testIds(els).sort()).toEqual(['tracking-meta-pixel', 'tracking-meta-pixel-noscript']);

    const snippet = inlineSnippet(byTestId(els, 'tracking-meta-pixel'));
    expect(snippet).toContain('connect.facebook.net/en_US/fbevents.js');
    expect(snippet).toContain('fbq(\'init\',"1234567890")');
    expect(count(snippet, "fbq('track','PageView')")).toBe(1);

    const noscript = byTestId(els, 'tracking-meta-pixel-noscript');
    const img = collect((noscript.props as AnyProps).children).find((el) => el.type === 'img');
    expect((img!.props as AnyProps).src).toContain(
      'https://www.facebook.com/tr?id=1234567890&ev=PageView&noscript=1',
    );
  });

  it('renders PostHog with capture_pageview:false and exactly one manual $pageview', () => {
    const els = render({ posthogKey: 'phc_abc123', posthogHost: 'https://ph.example.com' });
    expect(testIds(els)).toEqual(['tracking-posthog']);

    const snippet = inlineSnippet(byTestId(els, 'tracking-posthog'));
    expect(snippet).toContain('posthog.init("phc_abc123"');
    expect(snippet).toContain('api_host:"https://ph.example.com"');
    expect(snippet).toContain('capture_pageview:false');
    expect(count(snippet, "posthog.capture('$pageview')")).toBe(1);
  });

  it('renders the HubSpot loader with the expected src when only hubspotTrackingId is set', () => {
    const els = render({ hubspotTrackingId: '424242' });
    expect(testIds(els)).toEqual(['tracking-hubspot']);

    const script = byTestId(els, 'tracking-hubspot');
    expect(script.type).toBe(Script);
    expect((script.props as AnyProps).src).toBe('https://js.hs-scripts.com/424242.js');
    // HubSpot's embed contract expects this exact element id.
    expect((script.props as AnyProps).id).toBe('hs-script-loader');
  });

  it('renders all four vendors when everything is configured', () => {
    const els = render({
      gtmId: 'GTM-ALL',
      metaPixelId: 'pixel-all',
      posthogKey: 'phc_all',
      hubspotTrackingId: 'hs-all',
    });
    const ids = testIds(els);
    expect(ids).toContain('tracking-gtm');
    expect(ids).toContain('tracking-meta-pixel');
    expect(ids).toContain('tracking-posthog');
    expect(ids).toContain('tracking-hubspot');
  });

  it('loads every script with the afterInteractive strategy', () => {
    const els = render({
      gtmId: 'GTM-ALL',
      metaPixelId: 'pixel-all',
      posthogKey: 'phc_all',
      hubspotTrackingId: 'hs-all',
    });
    const scripts = els.filter((el) => el.type === Script);
    expect(scripts.length).toBe(4);
    for (const script of scripts) {
      expect((script.props as AnyProps).strategy).toBe('afterInteractive');
    }
  });

  it('neutralizes hostile ids in inline snippets (no </script> breakout, no quote escape)', () => {
    const hostile = `"</script><script>alert(1)//`;
    const els = render({ gtmId: hostile, metaPixelId: hostile, posthogKey: hostile });
    for (const id of ['tracking-gtm', 'tracking-meta-pixel', 'tracking-posthog']) {
      const snippet = inlineSnippet(byTestId(els, id));
      expect(snippet).not.toContain('</script>');
      expect(snippet).not.toContain(hostile);
    }
  });

  it('URL-encodes ids interpolated into vendor URLs', () => {
    const els = render({ gtmId: 'GTM-A&B', hubspotTrackingId: '42/..' });
    const noscript = byTestId(els, 'tracking-gtm-noscript');
    const iframe = collect((noscript.props as AnyProps).children).find(
      (el) => el.type === 'iframe',
    );
    expect((iframe!.props as AnyProps).src).toBe(
      'https://www.googletagmanager.com/ns.html?id=GTM-A%26B',
    );
    expect((byTestId(els, 'tracking-hubspot').props as AnyProps).src).toBe(
      'https://js.hs-scripts.com/42%2F...js',
    );
  });
});
