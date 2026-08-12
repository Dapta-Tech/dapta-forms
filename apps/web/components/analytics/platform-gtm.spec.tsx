import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import Script from 'next/script';
import {
  DAPTA_PLATFORM_GTM_ID,
  PlatformGtm,
  resolvePlatformGtmId,
  type PlatformGtmEnv,
} from './platform-gtm';

/**
 * Same testing stance as tracking-scripts.spec.tsx: next/script renders null
 * server-side and injects the tag client-side, so these specs assert on the
 * React element tree rather than serialized markup.
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

function byTestId(elements: ReactElement[], id: string): ReactElement {
  const found = elements.find((el) => (el.props as AnyProps)['data-testid'] === id);
  expect(found, `expected an element with data-testid="${id}"`).toBeDefined();
  return found!;
}

describe('resolvePlatformGtmId — which container loads where', () => {
  const resolve = (env: PlatformGtmEnv) => resolvePlatformGtmId(env);

  it('lets an explicit env id beat the hardcoded default', () => {
    expect(resolve({ NEXT_PUBLIC_PLATFORM_GTM_ID: 'GTM-CUSTOM1', AUTH_PROVIDER: 'workos' })).toBe(
      'GTM-CUSTOM1',
    );
  });

  it('falls back to the Dapta container on a workos build with the env var missing', () => {
    // The whole reason the default is in code: prd once shipped a no-op because
    // a NEXT_PUBLIC_ var was missing at build time. A Dapta deployment must not
    // be able to lose its own marketing container that way.
    expect(resolve({ AUTH_PROVIDER: 'workos' })).toBe(DAPTA_PLATFORM_GTM_ID);
  });

  it('treats a whitespace-only id as unset', () => {
    expect(resolve({ NEXT_PUBLIC_PLATFORM_GTM_ID: '   ', AUTH_PROVIDER: 'workos' })).toBe(
      DAPTA_PLATFORM_GTM_ID,
    );
    expect(resolve({ NEXT_PUBLIC_PLATFORM_GTM_ID: '   ' })).toBeNull();
  });

  it('resolves to NOTHING on a bare fork — zero third-party requests stays true', () => {
    expect(resolve({})).toBeNull();
    expect(resolve({ AUTH_PROVIDER: 'local' })).toBeNull();
  });

  describe('in a browser bundle', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('throws rather than silently resolving null', () => {
      // Client-side, `process.env` is empty and the parameter object defeats
      // Next's inlining — a client call would be the exact silent no-op the
      // in-code fallback exists to prevent. Loud beats wrong.
      vi.stubGlobal('window', {});
      expect(() => resolve({ AUTH_PROVIDER: 'workos' })).toThrow(/server-only/);
    });
  });
});

describe('PlatformGtm', () => {
  it('renders nothing at all without a container id', () => {
    expect(PlatformGtm({ gtmId: null })).toBeNull();
  });

  it('renders the GTM loader + noscript iframe for the resolved container', () => {
    const els = collect(PlatformGtm({ gtmId: 'GTM-TEST123' }));

    const script = byTestId(els, 'platform-gtm');
    expect(script.type).toBe(Script);
    // A DIFFERENT Script id from the public-page `tracking-gtm`: next/script
    // dedupes by id, and the platform container must never suppress (or be
    // suppressed by) a form owner's container.
    expect((script.props as AnyProps).id).toBe('platform-gtm');
    expect((script.props as AnyProps).strategy).toBe('afterInteractive');
    const snippet = (script.props as AnyProps).children;
    expect(typeof snippet).toBe('string');
    expect(snippet).toContain('https://www.googletagmanager.com/gtm.js');
    expect(snippet).toContain('"GTM-TEST123"');
    expect(snippet).toContain("'dataLayer'");

    const noscript = byTestId(els, 'platform-gtm-noscript');
    expect(noscript.type).toBe('noscript');
    const iframe = collect((noscript.props as AnyProps).children).find(
      (el) => el.type === 'iframe',
    );
    expect(iframe).toBeDefined();
    expect((iframe!.props as AnyProps).src).toBe(
      'https://www.googletagmanager.com/ns.html?id=GTM-TEST123',
    );
  });

  it('neutralizes a hostile id — no </script> breakout, URL-encoded iframe src', () => {
    // Escaping itself is buildGtmSnippet's contract (covered in its own spec);
    // this pins that THIS component routes the id through it.
    const hostile = `"</script><script>alert(1)//`;
    const els = collect(PlatformGtm({ gtmId: hostile }));
    const snippet = (byTestId(els, 'platform-gtm').props as AnyProps).children as string;
    expect(snippet).not.toContain('</script>');
    expect(snippet).not.toContain(hostile);
    const iframe = collect(
      (byTestId(els, 'platform-gtm-noscript').props as AnyProps).children,
    ).find((el) => el.type === 'iframe');
    expect((iframe!.props as AnyProps).src).toBe(
      `https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(hostile)}`,
    );
  });
});
