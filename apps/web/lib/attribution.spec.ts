/**
 * Inbound acquisition context — the mapping in @quill/types between the URL's
 * snake_case tags and the camelCase shape stored on `account.attribution`.
 *
 * Tested from here rather than from the types package: `packages/types` ships no
 * test runner (its `test` script is a placeholder), and adding one would mean a
 * new devDependency plus a lockfile change in a PR that should stay surgical. The
 * web is the side that reads these tags off a real request, so this is the
 * closest real consumer.
 */
import { describe, it, expect } from 'vitest';
import { parseAttribution, attributionSchema, ATTRIBUTION_QUERY_KEYS } from '@quill/types';
import { attributionHandoffQuery, crossOriginReferer } from './attribution';

describe('parseAttribution — snake_case URL in, camelCase blob out', () => {
  it('maps the UTM set and the paid-click ids onto the stored field names', () => {
    // The landing appends snake_case (the ad-platform convention); the column
    // stores camelCase (what `attributionSchema` has always declared).
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
      utmSource: 'landing',
      utmMedium: 'cpc',
      utmCampaign: 'launch',
      utmTerm: 'forms',
      utmContent: 'hero',
      gclid: 'abc123',
      fbclid: 'xyz789',
    });
  });

  it('produces a value the documented reader accepts', () => {
    // The whole point of collapsing to one schema: whatever the writer stores,
    // `attributionSchema.parse` must return it intact rather than stripping it to
    // `{}` because the casing disagreed.
    const parsed = parseAttribution({ utm_source: 'landing', gclid: 'abc' })!;
    expect(attributionSchema.parse(parsed)).toEqual(parsed);
  });

  it('drops any key not on the allowlist', () => {
    // The input is attacker-supplied — anyone can craft a link — and it lands in a
    // column that later feeds a CRM.
    expect(parseAttribution({ utm_source: 'x', evil: 'drop me', password: 'hunter2' })).toEqual({
      utmSource: 'x',
    });
  });

  it('returns null when nothing is present, so first touch is not burned', () => {
    // The column is write-once. Persisting `{}` on a direct visit would spend
    // first touch and the real campaign could never be recorded afterwards.
    expect(parseAttribution({})).toBeNull();
    expect(parseAttribution({ utm_source: '', utm_medium: '   ' })).toBeNull();
    expect(parseAttribution({ unrelated: 'value' })).toBeNull();
  });

  it('trims, and TRUNCATES rather than failing the whole parse', () => {
    // A single over-long value (a hostile URL, or just a very long fbclid) must
    // not discard the campaign alongside it.
    const out = parseAttribution({ utm_campaign: '  spaced  ', fbclid: 'a'.repeat(900) })!;
    expect(out.utmCampaign).toBe('spaced');
    expect(out.fbclid).toHaveLength(512);
  });

  it('never returns null because a value was too long', () => {
    // Guards the cap table against drifting past the schema's own `.max()`: if it
    // ever did, safeParse would fail and the whole payload would be dropped.
    const hostile = Object.fromEntries(ATTRIBUTION_QUERY_KEYS.map((k) => [k, 'z'.repeat(4096)]));
    expect(parseAttribution(hostile)).not.toBeNull();
  });

  it('takes the FIRST value of a repeated param', () => {
    // Last-wins would let an appended duplicate override the real campaign.
    expect(parseAttribution({ utm_source: ['real', 'injected'] })).toEqual({ utmSource: 'real' });
  });

  it('records referrer and landing path, which catch untagged in-product buttons', () => {
    expect(
      parseAttribution({ referrer: 'https://app.example.com/home', landing_path: '/admin' }),
    ).toEqual({
      referrer: 'https://app.example.com/home',
      landingPath: '/admin',
    });
  });
});

describe('attributionHandoffQuery — hop 1, the seam that already broke', () => {
  /** What the login route does with whatever hop 1 emitted. */
  const receive = (query: string) => {
    const sp = new URLSearchParams(query);
    return parseAttribution(Object.fromEntries([...new Set(sp.keys())].map((k) => [k, sp.getAll(k)])));
  };

  it('round-trips every tag through both hops', () => {
    // The regression this pins: emitting the PARSED (camelCase) shape here loses
    // every utm_* tag while gclid/fbclid survive, because only those two keys are
    // spelled the same in both casings. Nothing throws, no other test fails, and
    // the write-once claim is then spent on a half-empty blob.
    const query = attributionHandoffQuery(
      { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'launch', gclid: 'CJ0abc' },
      null,
      null,
    );
    expect(receive(query)).toEqual({
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'launch',
      gclid: 'CJ0abc',
    });
  });

  it('emits nothing for an untagged visit, so no cookie is set downstream', () => {
    expect(attributionHandoffQuery({}, null, null)).toBe('');
    expect(attributionHandoffQuery({ unrelated: 'x' }, null, null)).toBe('');
  });

  it('carries a cross-origin referer and drops a same-origin one', () => {
    expect(receive(attributionHandoffQuery({}, 'https://ads.example.com/x', 'forms.example.com'))).toEqual(
      { referrer: 'https://ads.example.com/x' },
    );
    // Same origin says nothing, and storing it would spend first touch.
    expect(attributionHandoffQuery({}, 'https://forms.example.com/pricing', 'forms.example.com')).toBe('');
  });

  it('keeps the first of a repeated param across the hop', () => {
    expect(receive(attributionHandoffQuery({ utm_source: ['real', 'injected'] }, null, null))).toEqual({
      utmSource: 'real',
    });
  });

  it('caps a forwarded value so the redirect cannot carry a huge Location header', () => {
    const query = attributionHandoffQuery({ utm_source: 'a'.repeat(4096) }, null, null);
    expect(new URLSearchParams(query).get('utm_source')).toHaveLength(512);
  });
});

describe('crossOriginReferer', () => {
  it('treats a malformed referer as absent', () => {
    expect(crossOriginReferer('not a url', 'forms.example.com')).toBeUndefined();
    expect(crossOriginReferer(null, 'forms.example.com')).toBeUndefined();
  });

  it('keeps a referer when our own host is unknown', () => {
    // A self-host with no PUBLIC_APP_URL and no proxy headers: better to record the
    // referer than to silently treat every visit as internal.
    expect(crossOriginReferer('https://ads.example.com/x', null)).toBe('https://ads.example.com/x');
  });
});
