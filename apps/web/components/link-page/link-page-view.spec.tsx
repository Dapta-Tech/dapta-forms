/**
 * The link page's one renderer, as the public route and the editor's preview
 * both draw it: the buttons in the order given, only the socials that are
 * filled, author links in a new tab with no referrer, forms on their neutral
 * URL, and the "Made with dForms" pill tagged for this surface.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { linkPageBranding, type PublicLinkPage } from '@quill/types';

// `next/font/google` resolves at build time and has no runtime in vitest.
vi.mock('next/font/google', () => {
  const font = () => ({ className: 'font', variable: '--font', style: { fontFamily: 'font' } });
  return {
    DM_Sans: font,
    Figtree: font,
    Fraunces: font,
    Hanken_Grotesk: font,
    JetBrains_Mono: font,
    Inter: font,
    Manrope: font,
    Playfair_Display: font,
    Poppins: font,
    Space_Grotesk: font,
    Work_Sans: font,
  };
});

const { LinkPageView } = await import('./link-page-view');

const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ['NEXT_PUBLIC_SIGNUP_URL', 'NEXT_PUBLIC_LANDING_URL', 'NEXT_PUBLIC_HIDE_BADGE']) saved[k] = process.env[k];
  process.env.NEXT_PUBLIC_SIGNUP_URL = 'https://example.com/signup';
  process.env.NEXT_PUBLIC_LANDING_URL = 'https://landing.example/';
  delete process.env.NEXT_PUBLIC_HIDE_BADGE;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function page(over: Partial<PublicLinkPage> = {}): PublicLinkPage {
  return {
    accountCode: 'acme',
    name: 'Acme Studio',
    bio: 'Forms for the booth.',
    logo: null,
    buttons: [
      { type: 'form', label: 'Get a quote', slug: 'quote' },
      { type: 'link', label: 'Our store', url: 'https://shop.acme.example' },
      { type: 'form', label: 'Join the list', slug: 'list' },
    ],
    socials: [
      { network: 'instagram', href: 'https://www.instagram.com/acme' },
      { network: 'whatsapp', href: 'https://wa.me/573001234567' },
    ],
    branding: linkPageBranding(null),
    ...over,
  };
}

const render = (p: PublicLinkPage, preview = false) =>
  renderToStaticMarkup(<LinkPageView page={p} locale="en" preview={preview} />);

describe('LinkPageView', () => {
  it('renders the buttons in the given order, forms on their neutral URL', () => {
    const html = render(page());
    const labels = [...html.matchAll(/class="pf__btn pf-lp__btn"[^>]*>([^<]+)/g)].map((x) => x[1]);
    expect(labels).toEqual(['Get a quote', 'Our store', 'Join the list']);
    expect(html).toContain('href="/acme/f/quote"');
    expect(html).toContain('data-lp-type="form"');
  });

  it('opens author links and socials in a new tab with no referrer', () => {
    const html = render(page());
    expect(html).toMatch(/href="https:\/\/shop\.acme\.example" target="_blank" rel="noopener noreferrer nofollow"/);
    expect(html).toMatch(/href="https:\/\/wa\.me\/573001234567" target="_blank" rel="noopener noreferrer nofollow"/);
  });

  it('draws only the socials it is given', () => {
    const html = render(page());
    expect(html).toContain('link-page-social-instagram');
    expect(html).toContain('link-page-social-whatsapp');
    expect(html).not.toContain('link-page-social-tiktok');
    expect(render(page({ socials: [] }))).not.toContain('link-page-socials');
  });

  it('shows initials without a logo and the logo when there is one', () => {
    expect(render(page())).toContain('>AS</span>');
    const withLogo = render(page({ logo: 'https://cdn.acme.example/logo.png' }));
    expect(withLogo).toContain('src="https://cdn.acme.example/logo.png"');
    expect(withLogo).not.toContain('link-page-initials');
  });

  it('carries the Made with dForms pill, tagged as the link page', () => {
    const html = render(page());
    expect(html).toContain('utm_medium=link-page');
    expect(html).toContain('utm_campaign=made-with-dforms');
    expect(html).toContain('utm_content=acme');
    expect(html).toContain('href="https://landing.example/?');
  });

  it('renders one button and twelve buttons alike, and no list at all with none', () => {
    const one = render(page({ buttons: [{ type: 'form', label: 'Only', slug: 'only' }] }));
    expect(one.match(/pf-lp__btn/g)).toHaveLength(1);
    const twelve = render(
      page({ buttons: Array.from({ length: 12 }, (_, i) => ({ type: 'form' as const, label: `Form ${i}`, slug: `f${i}` })) }),
    );
    expect(twelve.match(/pf-lp__btn/g)).toHaveLength(12);
    expect(render(page({ buttons: [] }))).not.toContain('link-page-buttons');
  });

  it('marks the preview so it fits its frame instead of the viewport', () => {
    expect(render(page(), true)).toContain('pf--linkpage-preview');
    expect(render(page())).not.toContain('pf--linkpage-preview');
  });
});
