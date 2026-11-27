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
  campaignProperties,
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

describe('resolveProductAnalytics: environment', () => {
  it('derives the environment from the host of PUBLIC_APP_URL', () => {
    expect(resolveProductAnalytics({ PUBLIC_APP_URL: 'https://app.example.com' }).environment).toBe('prd');
    expect(resolveProductAnalytics({ PUBLIC_APP_URL: 'https://app.dev.example.com' }).environment).toBe('dev');
    expect(resolveProductAnalytics({ PUBLIC_APP_URL: 'http://localhost:3400' }).environment).toBe('local');
  });

  it('is local on a bare clone with no PUBLIC_APP_URL', () => {
    expect(resolveProductAnalytics({}).environment).toBe('local');
  });
});

describe('buildAnalyticsSnippet: environment on every event', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Runs the snippet against an already-loaded fake, returning the init config. */
  function initConfig(environment: 'prd' | 'dev' | 'local') {
    const inits: Array<[string, Record<string, unknown>]> = [];
    const registered: unknown[] = [];
    // `__SV` set: the loader stub sees a library already in place and skips
    // itself, so only the `posthog.init(...)` half runs.
    const posthog = {
      __SV: 1,
      init: (key: string, config: Record<string, unknown>) => void inits.push([key, config]),
      register: (p: unknown) => void registered.push(p),
    };
    vi.stubGlobal('window', { posthog });
    vi.stubGlobal('posthog', posthog);
    vi.stubGlobal('document', {});
    new Function(buildAnalyticsSnippet('phc_abc', 'https://v.example.com', environment))();
    expect(inits).toHaveLength(1);
    // Nothing is registered: a registered value would persist in the shared cookie.
    expect(registered).toHaveLength(0);
    return inits[0]![1];
  }

  it('stamps the environment on each event as it leaves, autocaptured ones included', () => {
    const beforeSend = initConfig('dev').before_send as (e: unknown) => unknown;
    const pageview = { event: '$pageview', properties: { $current_url: 'https://app.dev.example.com/admin' } };
    expect(beforeSend(pageview)).toBe(pageview);
    expect(pageview.properties).toMatchObject({ environment: 'dev', $current_url: 'https://app.dev.example.com/admin' });
  });

  it('overrides a stale value instead of keeping it', () => {
    const beforeSend = initConfig('prd').before_send as (e: unknown) => unknown;
    const event = { event: 'forms_playbook_opened', properties: { environment: 'dev' } };
    beforeSend(event);
    expect(event.properties.environment).toBe('prd');
  });

  it('never drops an event, even one without properties', () => {
    const beforeSend = initConfig('local').before_send as (e: unknown) => unknown;
    const bare = { event: 'x' };
    expect(beforeSend(bare)).toBe(bare);
    expect(beforeSend(null)).toBeNull();
  });

  it('escapes the value it interpolates', () => {
    const snippet = buildAnalyticsSnippet('phc_abc', 'https://v.example.com', '</script>' as never);
    expect(snippet).not.toContain('</script>');
  });
});

describe('campaignProperties', () => {
  it('keeps only the non-empty utm tags, snake_cased', () => {
    expect(
      campaignProperties({
        utmSource: 'linkedin',
        utmCampaign: 'playbooks',
        utmMedium: '',
        gclid: 'abc',
        firstSeenAt: 123,
      }),
    ).toEqual({ utm_source: 'linkedin', utm_campaign: 'playbooks' });
  });

  it('is empty for direct traffic or an account with no attribution', () => {
    expect(campaignProperties(null)).toEqual({});
    expect(campaignProperties(undefined)).toEqual({});
    expect(campaignProperties({})).toEqual({});
  });
});

describe('buildAnalyticsSnippet', () => {
  it('initializes with the given key and host', () => {
    const snippet = buildAnalyticsSnippet('phc_abc', 'https://v.example.com', 'prd');
    expect(snippet).toContain('posthog.init("phc_abc"');
    expect(snippet).toContain('api_host:"https://v.example.com"');
  });

  it('leaves automatic pageview capture ON', () => {
    // The admin is a real multi-route app: every navigation is its own page.
    // Disabling this (as the single-route public form page does) would mean
    // per-account activity had to be instrumented screen by screen.
    expect(buildAnalyticsSnippet('phc_abc', DEFAULT_ANALYTICS_HOST, 'prd')).not.toContain(
      'capture_pageview:false',
    );
  });

  it('escapes a hostile key so it cannot break out of the inline script', () => {
    const snippet = buildAnalyticsSnippet('</script><script>alert(1)</script>', 'https://x.example', 'prd');
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

  it('stores the email as a person property, not only as the distinct id', () => {
    // Person lists and recordings display the `email` property; without it a
    // Forms-only user shows up as a bare id.
    const calls = stubWindow();
    identifyMember(identity());
    const identify = calls.find(([n]) => n === 'identify');
    expect(identify?.[1]).toBe('ana@example.com');
    expect(identify?.[2]).toMatchObject({ email: 'ana@example.com', member_id: 'mem_1' });
  });

  it('sets the referrer code on the person while the referral program is on', () => {
    // The other half of the referral funnel's join: each invitee carries
    // `referred_by` (set by the API at the claim), each referrer `referral_code`.
    const calls = stubWindow();
    identifyMember(identity({ referralCode: 'k7m2p9qx' }));
    expect(calls.find(([n]) => n === 'identify')?.[2]).toMatchObject({ referral_code: 'k7m2p9qx' });
  });

  it('sets no referral code while the program is off', () => {
    const calls = stubWindow();
    identifyMember(identity({ referralCode: null }));
    expect(calls.find(([n]) => n === 'identify')?.[2]).not.toHaveProperty('referral_code');
  });

  it('aliases the landing id onto the email explicitly, so call order does not matter', () => {
    // The vendor replays queued `alias` calls before `identify`. With no
    // original, alias would resolve "the current id" to the landing id itself
    // (shared apex cookie) and identify the browser as it, so the later
    // identify(email) never merged. Naming the original removes that race.
    const calls = stubWindow();
    identifyMember(identity({ landingDistinctId: '0198a1b2-c3d4' }));
    expect(calls.find(([n]) => n === 'alias')).toEqual(['alias', '0198a1b2-c3d4', 'ana@example.com']);
  });

  it('never aliases the email to itself', () => {
    const calls = stubWindow();
    identifyMember(identity({ landingDistinctId: 'ana@example.com' }));
    expect(calls.filter(([n]) => n === 'alias')).toHaveLength(0);
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
