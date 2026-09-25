import { describe, expect, it } from 'vitest';
import { validateHandle } from '@quill/shared';
import { deriveHandleBase } from '@quill/engine';
import { PUBLIC_FORM_SEGMENT, canonicalFor, publicFormPath } from './public-form-path';

describe('publicFormPath', () => {
  it('builds /{accountCode}/f/{slug}, a path that names the workspace and never a member', () => {
    expect(publicFormPath('acme', 'lead-qualifier')).toBe('/acme/f/lead-qualifier');
  });

  it('encodes each segment, so a CRLF or a slash cannot leave its segment', () => {
    expect(publicFormPath('ac\r\nme', 'a/b')).toBe('/ac%0D%0Ame/f/a%2Fb');
  });
});

describe('canonicalFor', () => {
  // `live` is the slug the form answers to today; `old` is one it retired.
  it.each([
    {
      when: 'a neutral link to the live slug',
      route: { accountCode: 'acme', handle: 'f', slug: 'live' },
      canonical: null,
      redirect: null,
    },
    {
      when: 'a named link to the live slug',
      route: { accountCode: 'acme', handle: 'alex-rivera', slug: 'live' },
      canonical: '/acme/f/live',
      redirect: null,
    },
    {
      when: 'a neutral link to a retired slug',
      route: { accountCode: 'acme', handle: 'f', slug: 'old' },
      canonical: '/acme/f/live',
      redirect: '/acme/f/live',
    },
    {
      when: 'a named link to a retired slug',
      route: { accountCode: 'acme', handle: 'alex-rivera', slug: 'old' },
      canonical: '/acme/f/live',
      redirect: '/acme/f/live',
    },
  ])('$when: canonical $canonical, redirect $redirect', ({ route, canonical, redirect }) => {
    expect(canonicalFor(route, 'live')).toEqual({ canonical, redirect });
  });

  it('never echoes the handle a visitor typed into the redirect target', () => {
    const { canonical, redirect } = canonicalFor({ accountCode: 'acme', handle: '\r\nbad', slug: 'old' }, 'live');
    expect(redirect).toBe('/acme/f/live');
    expect(canonical).toBe('/acme/f/live');
  });
});

describe('PUBLIC_FORM_SEGMENT', () => {
  it('can never be a member handle, so no public page can sit behind it', () => {
    expect(validateHandle(PUBLIC_FORM_SEGMENT)).not.toBeNull();
    for (const [name, email] of [
      ['F', null],
      ['f', 'f@example.com'],
      [null, 'f@example.com'],
      ['F G', null],
    ] as const) {
      expect(deriveHandleBase(name, email)).not.toBe(PUBLIC_FORM_SEGMENT);
    }
  });
});
