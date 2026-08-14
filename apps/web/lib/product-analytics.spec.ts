/**
 * Product analytics config resolution + snippet building. The contract under
 * test is mostly a NEGATIVE one: with nothing configured the admin must load no
 * script and make no request, so a bare fork runs untouched.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  resolveProductAnalytics,
  buildAnalyticsSnippet,
  identifyMember,
  DEFAULT_ANALYTICS_HOST,
  type AnalyticsIdentity,
} from './product-analytics';

describe('resolveProductAnalytics', () => {
  it('is OFF when nothing is configured', () => {
    expect(resolveProductAnalytics({}).key).toBeNull();
  });

  it('treats a blank key as OFF, not as a key', () => {
    // A deployment that comments out its key but leaves `KEY=` behind must not
    // start firing requests at the vendor's default host with an empty key.
    expect(resolveProductAnalytics({ NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY: '   ' }).key).toBeNull();
  });

  it('reads the key and trims it', () => {
    const resolved = resolveProductAnalytics({
      NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY: '  phc_abc  ',
    });
    expect(resolved.key).toBe('phc_abc');
    expect(resolved.host).toBe(DEFAULT_ANALYTICS_HOST);
  });

  it('honors a host override (self-hosted / EU / reverse proxy)', () => {
    const resolved = resolveProductAnalytics({
      NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY: 'phc_abc',
      NEXT_PUBLIC_PRODUCT_ANALYTICS_HOST: 'https://v.example.com',
    });
    expect(resolved.host).toBe('https://v.example.com');
  });

  it('ignores the per-form tracking vars entirely', () => {
    // NEXT_PUBLIC_POSTHOG_KEY is the deployment default for the pixels a form
    // OWNER puts on their PUBLIC form page. Reading it here would inject our
    // own telemetry into every customer's form — the exact confusion the
    // separate names exist to prevent.
    const resolved = resolveProductAnalytics({
      NEXT_PUBLIC_POSTHOG_KEY: 'phc_customer_key',
      NEXT_PUBLIC_POSTHOG_HOST: 'https://customer.example.com',
    } as never);
    expect(resolved.key).toBeNull();
    expect(resolved.host).toBe(DEFAULT_ANALYTICS_HOST);
  });
});

describe('buildAnalyticsSnippet', () => {
  it('initializes with the given key and host', () => {
    const snippet = buildAnalyticsSnippet('phc_abc', 'https://v.example.com');
    expect(snippet).toContain('posthog.init("phc_abc"');
    expect(snippet).toContain('api_host:"https://v.example.com"');
  });

  it('leaves automatic pageview capture ON', () => {
    // The admin is a real multi-route app: every navigation is its own page.
    // Disabling this (as the single-route public form page does) would mean
    // per-account activity had to be instrumented screen by screen.
    expect(buildAnalyticsSnippet('phc_abc', DEFAULT_ANALYTICS_HOST)).not.toContain(
      'capture_pageview:false',
    );
  });

  it('escapes a hostile key so it cannot break out of the inline script', () => {
    const snippet = buildAnalyticsSnippet('</script><script>alert(1)</script>', 'https://x.example');
    expect(snippet).not.toContain('</script>');
    expect(snippet).toContain('\\u003c');
  });
});

describe('identifyMember — the landing-visit alias', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A window with a call-recording posthog and a real-enough localStorage. */
  function stubWindow(opts: { storageThrows?: boolean } = {}) {
    const calls: Array<[string, ...unknown[]]> = [];
    const record =
      (name: string) =>
      (...args: unknown[]) =>
        void calls.push([name, ...args]);
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      posthog: {
        identify: record('identify'),
        alias: record('alias'),
        register: record('register'),
        group: record('group'),
      },
      localStorage: opts.storageThrows
        ? {
            getItem() {
              throw new Error('blocked');
            },
            setItem() {
              throw new Error('blocked');
            },
          }
        : {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
          },
    });
    return calls;
  }

  const identity = (extra?: Partial<AnalyticsIdentity>): AnalyticsIdentity => ({
    email: 'ana@example.com',
    memberId: 'mem_1',
    accountId: 'acc_1',
    accountCode: 'ACME1',
    role: 'owner',
    ...extra,
  });

  it('aliases the landing id AFTER identify, so it lands on the person', () => {
    // Before identify, the current distinct id is this origin's anonymous id —
    // the landing visit would chain to a session instead of pinning to the
    // person. The order is the contract.
    const calls = stubWindow();
    identifyMember(identity({ landingDistinctId: '0198a1b2-c3d4' }));
    const names = calls.map(([n]) => n);
    expect(names.indexOf('alias')).toBeGreaterThan(names.indexOf('identify'));
    expect(calls.find(([n]) => n === 'alias')).toEqual(['alias', '0198a1b2-c3d4']);
  });

  it('makes no alias call at all without a landing id', () => {
    const calls = stubWindow();
    identifyMember(identity());
    identifyMember(identity({ landingDistinctId: null }));
    expect(calls.filter(([n]) => n === 'alias')).toHaveLength(0);
  });

  it('latches: the same landing id aliases once per browser', () => {
    // The cookie carrying the id lives ten minutes and cannot be deleted
    // server-side, so every render inside that window re-offers the id.
    const calls = stubWindow();
    identifyMember(identity({ landingDistinctId: 'ph-abc' }));
    identifyMember(identity({ landingDistinctId: 'ph-abc' }));
    expect(calls.filter(([n]) => n === 'alias')).toHaveLength(1);
  });

  it('fires anyway when localStorage is blocked — a repeat beats a never', () => {
    const calls = stubWindow({ storageThrows: true });
    identifyMember(identity({ landingDistinctId: 'ph-abc' }));
    expect(calls.filter(([n]) => n === 'alias')).toHaveLength(1);
  });

  it('does nothing without an email — no identify means nothing to pin to', () => {
    const calls = stubWindow();
    identifyMember(identity({ email: null, landingDistinctId: 'ph-abc' }));
    expect(calls).toHaveLength(0);
  });
});
