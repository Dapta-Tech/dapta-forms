import { describe, expect, it } from 'vitest';
import { publicPagePath, publishedPublicPagePath } from './public-page';

const me = { accountCode: 'isna88', handle: 'josue' };

describe('publicPagePath', () => {
  it('builds /{accountCode}/{handle}', () => {
    expect(publicPagePath(me)).toBe('/isna88/josue');
  });

  it('is null without a handle (no reserved fallback like "me")', () => {
    expect(publicPagePath({ accountCode: 'isna88', handle: null })).toBeNull();
  });
});

describe('publishedPublicPagePath', () => {
  it('returns the path only while the page is published', () => {
    expect(publishedPublicPagePath(me, { enabled: true })).toBe('/isna88/josue');
  });

  it('is null when the page is off, so Home hides its box', () => {
    expect(publishedPublicPagePath(me, { enabled: false })).toBeNull();
  });

  it('is null when there is no profile at all', () => {
    expect(publishedPublicPagePath(me, null)).toBeNull();
    expect(publishedPublicPagePath(me, undefined)).toBeNull();
  });

  it('is null when published but the member has no handle', () => {
    expect(publishedPublicPagePath({ accountCode: 'isna88', handle: null }, { enabled: true })).toBeNull();
  });
});
