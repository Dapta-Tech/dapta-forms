/**
 * What the public page section is allowed to claim, and when.
 *
 * The switch and the "View page" link render only from authoritative state —
 * something the server said it stores, at a revision. Three failures used to be
 * collapsed into one: a page that could not be read looked like an empty page,
 * a save with no answer looked like a failed save, and a save that lost a race
 * looked like a save that worked.
 *
 * The web app's vitest runs in plain node (no jsdom), so the rendered markup is
 * read out of `renderToStaticMarkup`, and the fence decision is checked as a
 * pure function. The click-through orderings — a real timed-out action, the
 * off-queue fence, repeated "Check again" — need a browser and live in
 * `qa/e2e/public-page-transport.spec.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// `useRouter` needs a mounted app router; these tests render the section on its
// own, outside one. Refreshing is exercised in the browser suite.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
import { getMessages } from '@quill/shared';
import type { MemberProfile } from '@quill/types';
import {
  PublicPageSettings,
  readFenceOutcome,
  sameStoredProfile,
  type PublicPageLoad,
} from './public-page';

const m = getMessages('en').admin.settings;
const es = getMessages('es').admin.settings;
const publicPath = '/acme/alex-rivera';

const published: MemberProfile = {
  version: 1,
  enabled: true,
  headline: 'Growth partner',
  bio: null,
  links: [{ label: 'Site', url: 'https://example.com' }],
};
const hidden: MemberProfile = { ...published, enabled: false };

const screen = (load: PublicPageLoad): string =>
  renderToStaticMarkup(<PublicPageSettings publicPath={publicPath} load={load} m={m} />);

const switchIsOn = (html: string): boolean => html.includes('aria-checked="true"');
const hasSwitch = (html: string): boolean => html.includes('role="switch"');
const hasViewLink = (html: string): boolean => html.includes(`>${m.publicPageView}</a>`);

describe('the fence decides what a timed-out save did', () => {
  it('reports "not applied" when the fence wins, because that save can never land', () => {
    // Fence won: it spent the revision the ambiguous save expected.
    const out = readFenceOutcome(hidden, { status: 'ok', profile: hidden, revision: 8 });

    expect(out.notice).toBe('not-applied');
    expect(out.adopt).toEqual({ profile: hidden, revision: 8 });
  });

  it('adopts the winner and says the state changed, never that we saved it', () => {
    const out = readFenceOutcome(hidden, { status: 'conflict', profile: published, revision: 9 });

    expect(out.notice).toBe('latest-loaded');
    expect(out.adopt).toEqual({ profile: published, revision: 9 });
  });

  it('separates a no-op revision advance from a change made elsewhere', () => {
    // Someone advanced the revision without changing content (a second fence,
    // or a write that stored the same thing). Saying "changed elsewhere" here
    // would be false; so would "Saved".
    const out = readFenceOutcome(hidden, { status: 'conflict', profile: { ...hidden }, revision: 9 });

    expect(out.notice).toBe('no-op-advance');
  });

  it('compares stored pages by content, not by key order', () => {
    const reordered = { enabled: true, headline: 'Growth partner', bio: null, version: 1, links: published.links } as MemberProfile;

    expect(sameStoredProfile(published, reordered)).toBe(true);
    expect(sameStoredProfile(published, hidden)).toBe(false);
    expect(sameStoredProfile(null, null)).toBe(true);
    expect(sameStoredProfile(null, hidden)).toBe(false);
  });
});

describe('the section renders stored state, and only stored state', () => {
  it('shows the switch on and offers the link for a published page', () => {
    const html = screen({ status: 'ok', profile: published, revision: 3 });

    expect(switchIsOn(html)).toBe(true);
    expect(hasViewLink(html)).toBe(true);
    expect(html).toContain(`href="${publicPath}"`);
  });

  it('shows the switch off and no link for a page that is not published', () => {
    const html = screen({ status: 'ok', profile: hidden, revision: 3 });

    expect(switchIsOn(html)).toBe(false);
    expect(hasViewLink(html)).toBe(false);
  });

  it('offers no toggle at all when the page could not be read', () => {
    // A failed read is not an empty page: rendering an editable blank form here
    // is what would let the next save overwrite stored links and branding.
    const html = screen({ status: 'failed' });

    expect(hasSwitch(html)).toBe(false);
    expect(hasViewLink(html)).toBe(false);
    expect(html).toContain(m.publicPageLoadFailed);
    expect(html).toContain(m.publicPageReload);
  });

  it('offers no toggle when the server cannot guard writes', () => {
    const html = screen({ status: 'unsupported' });

    expect(hasSwitch(html)).toBe(false);
    expect(html).toContain(m.publicPageUnsupported);
    // No silent fall back to the unguarded write path.
    expect(html).not.toContain(m.publicPageSaved);
  });

  it('never dresses an unreadable page up as "Saving" or "Could not save"', () => {
    const html = screen({ status: 'failed' });

    expect(html).not.toContain(m.publicPageSaving);
    expect(html).not.toContain(m.publicPageError);
  });

  it('explains a missing handle instead of offering a URL to publish at', () => {
    const html = renderToStaticMarkup(
      <PublicPageSettings publicPath={null} load={{ status: 'ok', profile: published, revision: 1 }} m={m} />,
    );

    expect(html).toContain(m.publicPageNoHandle);
    expect(hasViewLink(html)).toBe(false);
  });
});

describe('every state family has its own copy, in both locales', () => {
  const families = [
    'publicPageLoadFailed',
    'publicPageUnsupported',
    'publicPageReconciling',
    'publicPageTimedOutNotApplied',
    'publicPageLatestLoaded',
    'publicPageChangedElsewhere',
    'publicPageUnresolved',
    'publicPageCheckAgain',
    'publicPageReload',
    'publicPageNoOpAdvance',
    'publicPageSaved',
    'publicPageError',
  ] as const;

  it('is filled in for en and es', () => {
    for (const key of families) {
      expect(m[key], `en.${key}`).toBeTruthy();
      expect(es[key], `es.${key}`).toBeTruthy();
    }
  });

  it('keeps ambiguity out of the save/failure copy', () => {
    // "Saving…" and "Could not save" are claims. An unknown outcome is neither.
    for (const key of [
      'publicPageReconciling',
      'publicPageTimedOutNotApplied',
      'publicPageUnresolved',
      'publicPageNoOpAdvance',
      'publicPageLatestLoaded',
    ] as const) {
      expect(m[key]).not.toBe(m.publicPageSaving);
      expect(m[key]).not.toBe(m.publicPageError);
      expect(m[key]).not.toBe(m.publicPageSaved);
      expect(es[key]).not.toBe(es.publicPageSaving);
      expect(es[key]).not.toBe(es.publicPageError);
      expect(es[key]).not.toBe(es.publicPageSaved);
    }
  });

  it('distinguishes a no-op advance from a change made elsewhere', () => {
    expect(m.publicPageNoOpAdvance).not.toBe(m.publicPageChangedElsewhere);
    expect(m.publicPageNoOpAdvance).not.toBe(m.publicPageLatestLoaded);
    expect(es.publicPageNoOpAdvance).not.toBe(es.publicPageChangedElsewhere);
    expect(es.publicPageNoOpAdvance).not.toBe(es.publicPageLatestLoaded);
  });
});
