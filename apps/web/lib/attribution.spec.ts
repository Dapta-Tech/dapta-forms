/**
 * Inbound acquisition context — the wire contract in @quill/types.
 *
 * Tested from here rather than from the types package: `packages/types` ships no
 * test runner (its `test` script is a placeholder), and adding one would mean a
 * new devDependency plus a lockfile change in a PR that should stay surgical.
 * The web is the side that reads these tags off a real request, so this is the
 * closest real consumer.
 */
import { describe, it, expect } from 'vitest';
import { parseAttribution, accountAttributionSchema, ATTRIBUTION_KEYS, ATTRIBUTION_VALUE_MAX } from '@quill/types';

describe('parseAttribution — inbound acquisition context', () => {
  it('keeps the UTM set and the paid-click ids', () => {
    expect(
      parseAttribution({
        utm_source: 'landing',
        utm_medium: 'cpc',
        utm_campaign: 'launch',
        utm_term: 'forms',
        utm_content: 'hero',
        gclid: 'abc123',
        fbclid: 'xyz789',
      }),
    ).toEqual({
      utm_source: 'landing',
      utm_medium: 'cpc',
      utm_campaign: 'launch',
      utm_term: 'forms',
      utm_content: 'hero',
      gclid: 'abc123',
      fbclid: 'xyz789',
    });
  });

  it('drops any key not on the allowlist', () => {
    // The payload is attacker-supplied — anyone can craft a link — and it lands
    // in a JSONB column that later feeds a CRM. A copy-everything parser would
    // let a stranger write their own keys into our analytics.
    expect(parseAttribution({ utm_source: 'x', evil: 'drop me', password: 'hunter2' })).toEqual({
      utm_source: 'x',
    });
  });

  it('returns null when nothing is present, so first touch is not burned', () => {
    // The column is write-once. Persisting `{}` on a direct visit would spend
    // first touch and the real campaign could never be recorded afterwards.
    expect(parseAttribution({})).toBeNull();
    expect(parseAttribution({ utm_source: '', utm_medium: '   ' })).toBeNull();
    expect(parseAttribution({ unrelated: 'value' })).toBeNull();
  });

  it('trims, and caps each value', () => {
    const long = 'a'.repeat(ATTRIBUTION_VALUE_MAX + 50);
    const out = parseAttribution({ utm_campaign: '  spaced  ', fbclid: long })!;
    expect(out.utm_campaign).toBe('spaced');
    expect(out.fbclid).toHaveLength(ATTRIBUTION_VALUE_MAX);
  });

  it('takes the FIRST value of a repeated param', () => {
    // Last-wins would let an appended duplicate override the real campaign.
    expect(parseAttribution({ utm_source: ['real', 'injected'] })).toEqual({ utm_source: 'real' });
  });

  it('records referrer and landing path, which catch untagged in-product buttons', () => {
    expect(parseAttribution({ referrer: 'https://app.dapta.ai/home', landing_path: '/admin' })).toEqual({
      referrer: 'https://app.dapta.ai/home',
      landing_path: '/admin',
    });
  });
});

describe('accountAttributionSchema — what the API accepts off the wire', () => {
  it('strips unknown keys instead of rejecting the request', () => {
    // No `.strict()` on purpose: a stranger appending `?password=…` should be
    // ignored, not answered with a 400 that tells them the shape.
    const parsed = accountAttributionSchema.parse({ utm_source: 'landing', password: 'hunter2' });
    expect(parsed).toEqual({ utm_source: 'landing' });
  });

  it('rejects a value past the cap rather than truncating it server-side', () => {
    const long = 'a'.repeat(ATTRIBUTION_VALUE_MAX + 1);
    expect(accountAttributionSchema.safeParse({ utm_source: long }).success).toBe(false);
    expect(accountAttributionSchema.safeParse({ utm_source: 'a'.repeat(ATTRIBUTION_VALUE_MAX) }).success).toBe(true);
  });

  it('accepts an empty object — the CALLER decides that is nothing to store', () => {
    // The schema's job is shape, not policy. Refusing to spend the write-once
    // claim on `{}` belongs to parseAttribution and to the route.
    expect(accountAttributionSchema.safeParse({}).success).toBe(true);
  });

  it('ATTRIBUTION_KEYS is derived from the schema, so the two cannot drift', () => {
    expect([...ATTRIBUTION_KEYS].sort()).toEqual(Object.keys(accountAttributionSchema.shape).sort());
  });
});
