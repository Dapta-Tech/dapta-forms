/**
 * The public page switch must never claim a state the server did not store.
 *
 * Enabling used to move the switch on click and leave it there: when the save
 * came back rejected, the toggle stayed on — and so did the "View page" link
 * next to it — advertising a page that is still a 404. Disabling had the mirror
 * bug: the switch went off and the link disappeared while the page stayed
 * published.
 *
 * `readSaveVerdict` is what the screen is allowed to conclude from one save.
 * The web app's vitest runs in plain node (no jsdom), so the switch and the link
 * are read out of `renderToStaticMarkup` for the profile a verdict settles on.
 * The transport case — where the write may still land after the client stops
 * waiting — needs a real click and a real request in flight, so it is driven in
 * a browser by `qa/e2e/public-page-transport.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getMessages } from '@quill/shared';
import type { MemberProfile } from '@quill/types';
import { PublicPageSettings, readSaveVerdict } from './public-page';

const m = getMessages('en').admin.settings;
const publicPath = '/acme/alex-rivera';

const published: MemberProfile = {
  version: 1,
  enabled: true,
  headline: 'Growth partner',
  bio: null,
};
const hidden: MemberProfile = { ...published, enabled: false };

/** A transport failure: the call produced no server verdict, ok or not. */
const timedOut = {
  ok: false as const,
  transport: true as const,
  message: 'timed out after 15000ms',
};

/** The section as the screen actually renders it for a stored profile. */
const screen = (profile: MemberProfile | null): string =>
  renderToStaticMarkup(<PublicPageSettings publicPath={publicPath} initial={profile} m={m} />);

const switchIsOn = (html: string): boolean => html.includes('aria-checked="true"');
const hasViewLink = (html: string): boolean => html.includes(`>${m.publicPageView}</a>`);

describe('readSaveVerdict — what one save proves about stored state', () => {
  it('adopts the server’s copy of the profile on success', () => {
    expect(readSaveVerdict({ ok: true, profile: published })).toEqual({
      status: 'saved',
      profile: published,
    });
  });

  it('reads a removed page as stored too', () => {
    expect(readSaveVerdict({ ok: true, profile: null })).toEqual({
      status: 'saved',
      profile: null,
    });
  });

  it('carries the server’s reason when the save is refused, and no profile', () => {
    expect(readSaveVerdict({ ok: false, message: 'Handle taken.' })).toEqual({
      status: 'rejected',
      message: 'Handle taken.',
    });
  });

  it('concludes nothing at all when the call produced no verdict', () => {
    // Deliberately profile-free: a timeout does not abort the PUT, so neither
    // the value sent nor the one held before it is evidence of what is stored.
    const verdict = readSaveVerdict(timedOut);

    expect(verdict).toEqual({ status: 'unknown' });
    expect(verdict).not.toHaveProperty('profile');
  });
});

describe('the section renders the stored profile, both directions', () => {
  it('shows the switch on and offers the link for a published page', () => {
    const html = screen(published);

    expect(switchIsOn(html)).toBe(true);
    expect(hasViewLink(html)).toBe(true);
    expect(html).toContain(`href="${publicPath}"`);
  });

  it('shows the switch off and no link for a page that is not published', () => {
    const html = screen(hidden);

    expect(switchIsOn(html)).toBe(false);
    expect(hasViewLink(html)).toBe(false);
  });

  it('treats a member with no profile as not published', () => {
    const html = screen(null);

    expect(switchIsOn(html)).toBe(false);
    expect(hasViewLink(html)).toBe(false);
  });

  it('explains a missing handle instead of offering a URL to publish at', () => {
    const html = renderToStaticMarkup(
      <PublicPageSettings publicPath={null} initial={published} m={m} />,
    );

    expect(html).toContain(m.publicPageNoHandle);
    expect(hasViewLink(html)).toBe(false);
  });
});
