/**
 * The page a submission was answered on (#199), as the browser reports it.
 *
 * Everything here arrives from a page we do not control (the landing that
 * embeds the form), so the contract is TOLERANT: a bad field is dropped, never
 * turned into a refused submission. What survives is exactly what HubSpot and a
 * webhook receiver can be handed as is.
 */
import { describe, expect, it } from 'vitest';
import {
  parseSubmissionVisit,
  submissionSchema,
  toSubmissionVisitView,
  VISIT_PAGE_NAME_MAX,
  VISIT_PAGE_URI_MAX,
} from './index';

const HUTK = '0123456789abcdef0123456789ABCDEF';

describe('parseSubmissionVisit', () => {
  it('keeps a well-formed visit, lowercasing the HubSpot cookie', () => {
    expect(
      parseSubmissionVisit({
        pageUri: 'https://landing.example.com/offer?utm_source=fb',
        pageName: 'Home insurance',
        pageId: '123456789',
        hutk: HUTK,
        hsPortalId: '4321',
        embedded: true,
      }),
    ).toEqual({
      pageUri: 'https://landing.example.com/offer?utm_source=fb',
      pageName: 'Home insurance',
      pageId: '123456789',
      hutk: HUTK.toLowerCase(),
      hsPortalId: '4321',
      embedded: true,
    });
  });

  it('drops a cookie that is not 32 hex characters, and keeps the rest', () => {
    for (const hutk of ['abc', '', `${HUTK}0`, 'g'.repeat(32), ' ', 42]) {
      const visit = parseSubmissionVisit({ hutk, pageUri: 'https://a.example.com/', embedded: true });
      expect(visit).toEqual({ pageUri: 'https://a.example.com/', embedded: true });
    }
  });

  it('accepts only an absolute http(s) page URL, without its fragment or credentials', () => {
    expect(parseSubmissionVisit({ pageUri: 'https://a.example.com/p?x=1#top' })?.pageUri).toBe(
      'https://a.example.com/p?x=1',
    );
    expect(parseSubmissionVisit({ pageUri: 'https://user:pw@a.example.com/p' })?.pageUri).toBe(
      'https://a.example.com/p',
    );
    for (const pageUri of ['javascript:alert(1)', '/relative/path', 'ftp://a.example.com/', 'not a url', 7]) {
      expect(parseSubmissionVisit({ pageUri, pageName: 'x' })).toEqual({ pageName: 'x', embedded: false });
    }
  });

  it('shortens an over-long page URL to origin, path and utm_* before giving up on it', () => {
    const long = `https://a.example.com/landing?utm_source=fb&utm_campaign=w40&fbclid=${'x'.repeat(3000)}`;
    expect(parseSubmissionVisit({ pageUri: long })?.pageUri).toBe(
      'https://a.example.com/landing?utm_source=fb&utm_campaign=w40',
    );
    const hopeless = `https://a.example.com/${'p'.repeat(VISIT_PAGE_URI_MAX)}`;
    expect(parseSubmissionVisit({ pageUri: hopeless, embedded: true })).toEqual({ embedded: true });
  });

  it('collapses the page name, strips control characters and cuts it at the limit', () => {
    expect(parseSubmissionVisit({ pageName: '  Home\n\t insurance \u0000 quote  ' })?.pageName).toBe(
      'Home insurance quote',
    );
    const name = parseSubmissionVisit({ pageName: 'é'.repeat(VISIT_PAGE_NAME_MAX + 50) })?.pageName;
    expect(Array.from(name ?? '')).toHaveLength(VISIT_PAGE_NAME_MAX);
    // A lone surrogate is not valid JSON text for Postgres: it becomes U+FFFD.
    expect(parseSubmissionVisit({ pageName: 'a\ud800b' })?.pageName).toBe('a\ufffdb');
  });

  it('keeps a page id and a portal id only as up to 20 digits', () => {
    expect(parseSubmissionVisit({ pageId: 98765, hsPortalId: ' 4321 ' })).toEqual({
      pageId: '98765',
      hsPortalId: '4321',
      embedded: false,
    });
    for (const bad of ['12a', '', '1'.repeat(21), -3, {}]) {
      expect(parseSubmissionVisit({ pageId: bad, hsPortalId: bad, pageName: 'x' })).toEqual({
        pageName: 'x',
        embedded: false,
      });
    }
  });

  it('reads nothing out of a value that is not a visit', () => {
    for (const raw of [undefined, null, 'visit', 12, [], true]) {
      expect(parseSubmissionVisit(raw)).toBeUndefined();
    }
    // An object with nothing usable is no visit either.
    expect(parseSubmissionVisit({ hutk: 'nope', pageUri: 'mailto:a@b.c' })).toBeUndefined();
  });

  it('keeps a bare "answered inside a frame" fact on its own', () => {
    expect(parseSubmissionVisit({ embedded: true })).toEqual({ embedded: true });
    expect(parseSubmissionVisit({ embedded: 'yes' })).toBeUndefined();
  });
});

describe('submissionSchema: the visit never costs a submission', () => {
  const base = { sessionId: 's-1', data: { email: 'lead@example.com' } };

  it('parses a submission whose visit is malformed in every field', () => {
    const parsed = submissionSchema.parse({
      ...base,
      visit: { pageUri: 'javascript:x', pageName: 42, hutk: 'abc', pageId: 'x', hsPortalId: [], embedded: 'no' },
    });
    expect(parsed.data).toEqual(base.data);
    expect(parsed.visit).toBeUndefined();
  });

  it('parses a submission whose visit is not even an object', () => {
    for (const visit of ['https://a.example.com', 1, null, [HUTK]]) {
      expect(submissionSchema.parse({ ...base, visit }).visit).toBeUndefined();
    }
  });

  it('carries a good visit through, sanitized', () => {
    const parsed = submissionSchema.parse({
      ...base,
      visit: { pageUri: 'https://a.example.com/#x', pageName: ' Landing ', hutk: HUTK, embedded: true },
    });
    expect(parsed.visit).toEqual({
      pageUri: 'https://a.example.com/',
      pageName: 'Landing',
      hutk: HUTK.toLowerCase(),
      embedded: true,
    });
  });

  it('parses a submission with no visit exactly as before', () => {
    expect(submissionSchema.parse(base)).toEqual(base);
  });
});

describe('toSubmissionVisitView: what the dashboard may see', () => {
  it('never carries the HubSpot cookie, only whether one was linked', () => {
    const view = toSubmissionVisitView({
      pageUri: 'https://a.example.com/',
      pageName: 'Landing',
      pageId: '1',
      hutk: HUTK.toLowerCase(),
      hsPortalId: '2',
      embedded: true,
    });
    expect(view).toEqual({
      pageUri: 'https://a.example.com/',
      pageName: 'Landing',
      embedded: true,
      hubspotLinked: true,
    });
    expect(JSON.stringify(view)).not.toContain(HUTK.toLowerCase());
  });

  it('reads an absent visit as no visit, and fills the gaps with null', () => {
    expect(toSubmissionVisitView(null)).toBeNull();
    expect(toSubmissionVisitView(undefined)).toBeNull();
    expect(toSubmissionVisitView({ embedded: false })).toEqual({
      pageUri: null,
      pageName: null,
      embedded: false,
      hubspotLinked: false,
    });
  });
});
