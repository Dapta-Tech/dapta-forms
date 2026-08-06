/**
 * Product analytics config resolution + snippet building. The contract under
 * test is mostly a NEGATIVE one: with nothing configured the admin must load no
 * script and make no request, so a bare fork runs untouched.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveProductAnalytics,
  buildAnalyticsSnippet,
  DEFAULT_ANALYTICS_HOST,
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
