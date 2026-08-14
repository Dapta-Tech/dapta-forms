import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import Script from 'next/script';
import {
  DAPTA_PLATFORM_GTM_ID,
  PlatformGtm,
  SIGNUP_DATALAYER_EVENT,
  buildPlatformPrelude,
  platformDataLayerVars,
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

describe('platformDataLayerVars — the stored blob as container variables', () => {
  it('re-keys to the snake_case names the container declares', () => {
    expect(
      platformDataLayerVars({
        utmSource: 'google',
        utmMedium: 'cpc',
        utmCampaign: 'forms_launch',
        utmContent: 'variant_a',
        utmTerm: 'formularios',
        gclid: 'Cj0KCQ',
        fbclid: 'IwAR1',
      }),
    ).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'forms_launch',
      utm_content: 'variant_a',
      utm_term: 'formularios',
      gclid: 'Cj0KCQ',
      fbclid: 'IwAR1',
    });
  });

  it('publishes referrer and landing path under the FIRST-TOUCH names', () => {
    // These two are a cross-domain contract: daptaforms.ai pushes the same
    // variables under these names. Renaming one side alone does not fail — the
    // container variable just resolves undefined and the tags go quiet.
    expect(
      platformDataLayerVars({ referrer: 'https://example.test/x', landingPath: '/precios' }),
    ).toEqual({ first_touch_referrer: 'https://example.test/x', first_touch_path: '/precios' });
  });

  it('says nothing at all for an account with no tags', () => {
    // `{}` and not keys-with-empty-values: a blank utm_source in the layer reads
    // as "this signup was untagged", which is a different claim from "unknown".
    expect(platformDataLayerVars(null)).toEqual({});
    expect(platformDataLayerVars(undefined)).toEqual({});
    expect(platformDataLayerVars({})).toEqual({});
    expect(platformDataLayerVars({ utmSource: '', gclid: null })).toEqual({});
  });

  it('drops what a tag cannot read: unknown keys and non-strings', () => {
    expect(
      platformDataLayerVars({ utmSource: 'google', firstSeenAt: 1_700_000_000_000, nope: 'x' }),
    ).toEqual({ utm_source: 'google' });
  });
});

describe('buildPlatformPrelude — what the container sees when it boots', () => {
  it('initializes the layer even with nothing to push', () => {
    const out = buildPlatformPrelude({});
    expect(out).toBe('window.dataLayer=window.dataLayer||[];');
    expect(out).not.toContain('push');
  });

  it('emits the signup event only when an account id is passed', () => {
    expect(buildPlatformPrelude({}, 'acc_123')).toContain(SIGNUP_DATALAYER_EVENT);
    expect(buildPlatformPrelude({ utm_source: 'google' })).not.toContain(SIGNUP_DATALAYER_EVENT);
    expect(buildPlatformPrelude({}, null)).not.toContain(SIGNUP_DATALAYER_EVENT);
  });

  it('latches the signup event per account, and fires when storage is blocked', () => {
    const out = buildPlatformPrelude({}, 'acc_123');
    expect(out).toContain('"dapta_forms_signup:acc_123"');
    // The push sits OUTSIDE the try: a private-mode browser that throws on
    // localStorage must still report the conversion. Counted twice is
    // recoverable; never counted is not.
    const tryEnd = out.indexOf('catch(e){}');
    expect(tryEnd).toBeGreaterThan(-1);
    expect(out.indexOf('w.dataLayer.push')).toBeGreaterThan(tryEnd);
  });
});

describe('PlatformGtm — attribution reaches the layer before the container', () => {
  const snippetOf = (el: ReturnType<typeof PlatformGtm>) =>
    (byTestId(collect(el), 'platform-gtm').props as AnyProps).children as string;

  it('pushes the tags BEFORE gtm.js loads', () => {
    // The ordering IS the fix. A tag firing on container initialization reads
    // the layer as it stands at that moment, so a push that lands afterwards
    // produces a conversion with no campaign on it.
    const snippet = snippetOf(
      PlatformGtm({ gtmId: 'GTM-TEST123', attribution: { utmSource: 'google' } }),
    );
    expect(snippet).toContain('"utm_source":"google"');
    expect(snippet.indexOf('"utm_source"')).toBeLessThan(snippet.indexOf('gtm.js'));
  });

  it('fires the signup event on the wizard and nowhere else', () => {
    const wizard = snippetOf(
      PlatformGtm({ gtmId: 'GTM-TEST123', attribution: null, signupAccountId: 'acc_9' }),
    );
    expect(wizard).toContain(SIGNUP_DATALAYER_EVENT);
    // The dashboard passes the same tags without an id — an account signing in
    // three years later still wants its funnel sliced, and wants no new signup.
    const dashboard = snippetOf(
      PlatformGtm({ gtmId: 'GTM-TEST123', attribution: { utmSource: 'google' } }),
    );
    expect(dashboard).not.toContain(SIGNUP_DATALAYER_EVENT);
  });

  it('neutralizes a hostile tag — no </script> breakout out of a utm value', () => {
    // `utm_source` is whatever the last person to compose a link typed, it is
    // stored verbatim, and it lands inside an inline <script>.
    const hostile = `</script><script>alert(1)//`;
    const snippet = snippetOf(
      PlatformGtm({ gtmId: 'GTM-TEST123', attribution: { utmSource: hostile } }),
    );
    expect(snippet).not.toContain('</script>');
    expect(snippet).toContain('\\u003c/script>');
  });

  it('writes no dataLayer at all on a bare fork', () => {
    // No container means no reader. A fork stays at zero third-party anything.
    expect(
      PlatformGtm({ gtmId: null, attribution: { utmSource: 'google' }, signupAccountId: 'acc_1' }),
    ).toBeNull();
  });
});
