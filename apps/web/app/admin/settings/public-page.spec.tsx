/**
 * The public page switch must never claim a state the server did not persist.
 *
 * Enabling used to move the switch on click and leave it there: when the save
 * came back rejected, the toggle stayed on — and so did the "View page" link
 * next to it — advertising a page that is still a 404. Disabling had the mirror
 * bug: the switch went off and the link disappeared while the page stayed
 * published. Both directions now render the profile the save came back with,
 * and a call that never reached the server settles nothing at all.
 *
 * The web app's vitest runs in plain node (no jsdom), so the switch and the link
 * are read out of `renderToStaticMarkup` for the profile the reconciler settles
 * on, rather than by clicking. Playwright drives the real DOM.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getMessages } from '@quill/shared';
import type { MemberProfile } from '@quill/types';
import { PublicPageSettings, reconcileProfileSave } from './public-page';

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

/** The section as the screen actually renders it for a persisted profile. */
const screen = (profile: MemberProfile | null): string =>
  renderToStaticMarkup(<PublicPageSettings publicPath={publicPath} initial={profile} m={m} />);

const switchIsOn = (html: string): boolean => html.includes('aria-checked="true"');
const hasViewLink = (html: string): boolean => html.includes(`>${m.publicPageView}</a>`);

describe('public page — a rejected save leaves persisted state on screen', () => {
  it('keeps the page hidden, and the View link gone, when an enable is rejected', () => {
    const next = reconcileProfileSave(hidden, { ok: false, message: 'Could not save.' });

    expect(next.saved).toBe(false);
    expect(next.profile).toEqual(hidden);

    const html = screen(next.profile);
    expect(switchIsOn(html)).toBe(false);
    expect(hasViewLink(html)).toBe(false);
  });

  it('keeps the page published, and the View link visible, when a disable is rejected', () => {
    const next = reconcileProfileSave(published, { ok: false, message: 'Could not save.' });

    expect(next.saved).toBe(false);
    expect(next.profile).toEqual(published);

    const html = screen(next.profile);
    expect(switchIsOn(html)).toBe(true);
    expect(hasViewLink(html)).toBe(true);
  });

  it('surfaces the server’s own reason so the screen need not guess', () => {
    expect(reconcileProfileSave(hidden, { ok: false, message: 'Handle taken.' }).message).toBe(
      'Handle taken.',
    );
  });
});

describe('public page — a call that never landed claims nothing', () => {
  it('leaves a hidden page hidden when the enable never reached the server', () => {
    const next = reconcileProfileSave(hidden, timedOut);

    // Not a success: no server verdict came back, so nothing may be announced
    // as saved — and the transport message is plumbing, not an answer about the
    // profile, so the screen falls back to its own copy instead of quoting it.
    expect(next.saved).toBe(false);
    expect(next.message).toBeNull();
    expect(next.profile).toEqual(hidden);
    expect(switchIsOn(screen(next.profile))).toBe(false);
  });

  it('leaves a published page published when the disable never reached the server', () => {
    const next = reconcileProfileSave(published, timedOut);

    expect(next.saved).toBe(false);
    expect(next.profile).toEqual(published);

    const html = screen(next.profile);
    expect(switchIsOn(html)).toBe(true);
    expect(hasViewLink(html)).toBe(true);
  });
});

describe('public page — a successful save renders what the server stored', () => {
  it('turns the switch on and offers the link once the server confirms the publish', () => {
    const next = reconcileProfileSave(hidden, { ok: true, profile: published });

    expect(next.saved).toBe(true);
    expect(next.profile).toEqual(published);

    const html = screen(next.profile);
    expect(switchIsOn(html)).toBe(true);
    expect(hasViewLink(html)).toBe(true);
    expect(html).toContain(`href="${publicPath}"`);
  });

  it('turns the switch off and drops the link once the server confirms the unpublish', () => {
    const next = reconcileProfileSave(published, { ok: true, profile: hidden });

    expect(next.saved).toBe(true);
    expect(next.profile).toEqual(hidden);

    const html = screen(next.profile);
    expect(switchIsOn(html)).toBe(false);
    expect(hasViewLink(html)).toBe(false);
  });

  it('takes a removed page (a null profile) as the persisted answer too', () => {
    const next = reconcileProfileSave(published, { ok: true, profile: null });

    expect(next.saved).toBe(true);
    expect(next.profile).toBeNull();
    expect(switchIsOn(screen(next.profile))).toBe(false);
  });
});

describe('public page — the screen without a handle', () => {
  it('explains the missing handle instead of offering a URL to publish at', () => {
    const html = renderToStaticMarkup(
      <PublicPageSettings publicPath={null} initial={published} m={m} />,
    );

    expect(html).toContain(m.publicPageNoHandle);
    expect(hasViewLink(html)).toBe(false);
  });
});
