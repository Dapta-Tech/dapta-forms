/**
 * A member's public page is personal by design and keeps its handle, but the
 * forms it lists are ordinary form links: a visitor who copies one from here
 * must get the same neutral URL the builder hands out, not one that carries
 * the member's name along with it.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicProfile } from '@quill/types';

// `next/font/google` resolves at build time and has no runtime in vitest; the
// page's design props only need a className from it.
vi.mock('next/font/google', () => {
  const font = () => ({ className: 'font', variable: '--font', style: { fontFamily: 'font' } });
  return {
    DM_Sans: font,
    Figtree: font,
    Fraunces: font,
    IBM_Plex_Mono: font,
    Inter: font,
    Manrope: font,
    Playfair_Display: font,
    Poppins: font,
    Space_Grotesk: font,
    Work_Sans: font,
  };
});

const profile: PublicProfile = {
  handle: 'alex-rivera',
  displayName: 'Alex Rivera',
  avatarUrl: null,
  headline: null,
  bio: null,
  links: [],
  forms: [
    { slug: 'lead-qualifier', name: 'Lead Qualifier' },
    { slug: 'spring-launch', name: 'Spring launch' },
  ],
  branding: null,
};
vi.mock('@/lib/api', () => ({ getPublicProfile: async () => profile }));
vi.mock('@/lib/locale', () => ({ getLocale: async () => 'en' }));

import MemberProfilePage from './page';

describe('the public member page', () => {
  it('links every form it lists at the neutral form URL', async () => {
    const html = renderToStaticMarkup(
      await MemberProfilePage({ params: Promise.resolve({ accountCode: 'acme', handle: 'alex-rivera' }) }),
    );
    expect(html).toContain('href="/acme/f/lead-qualifier"');
    expect(html).toContain('href="/acme/f/spring-launch"');
    expect(html).not.toContain('/acme/alex-rivera/');
  });
});
