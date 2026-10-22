import { describe, expect, it } from 'vitest';
import {
  LINK_PAGE_LOGO_MAX_CHARS,
  LINK_PAGE_MAX_BODY_BYTES,
  linkPageToInput,
  parseStoredLinkPage,
  LINK_PAGE_MAX_ITEMS,
  linkPageBranding,
  linkPageSchema,
  normalizeSocial,
  resolveLinkPage,
  whatsappDigits,
  whatsappHref,
  type LinkPageFormRef,
} from './link-page';

/** A page at every limit the schema has: the largest body a client can send. */
function maxPage() {
  return {
    version: 1,
    enabled: true,
    name: 'N'.repeat(80),
    bio: 'B'.repeat(280),
    logo: `data:image/png;base64,${'A'.repeat(LINK_PAGE_LOGO_MAX_CHARS - 'data:image/png;base64,'.length)}`,
    items: Array.from({ length: LINK_PAGE_MAX_ITEMS }, (_, i) => ({
      type: 'link',
      label: 'é'.repeat(80),
      url: `https://acme.example/${String(i).padStart(2, '0')}/${'p'.repeat(2048 - 'https://acme.example/00/'.length)}`,
    })),
    socials: {
      instagram: `https://www.instagram.com/${'a'.repeat(400)}`,
      x: `https://x.com/${'a'.repeat(400)}`,
      youtube: `https://www.youtube.com/@${'a'.repeat(400)}`,
      tiktok: `https://www.tiktok.com/@${'a'.repeat(400)}`,
      whatsapp: '+573001234567',
    },
  };
}

describe('whatsappDigits', () => {
  it('keeps digits only, country code first', () => {
    expect(whatsappDigits('+57 300 123 4567')).toBe('573001234567');
    expect(whatsappDigits('+57 (300) 123-4567')).toBe('573001234567');
    expect(whatsappDigits('wa.me/573001234567')).toBe('573001234567');
    expect(whatsappDigits('https://wa.me/573001234567?text=hi')).toBe('573001234567');
  });

  it('takes 00 as the international prefix, with or without a +', () => {
    expect(whatsappDigits('0057 300 123 4567')).toBe('573001234567');
    expect(whatsappDigits('+0057 300 123 4567')).toBe('573001234567');
  });

  it('refuses a number without its country code instead of guessing one', () => {
    expect(whatsappDigits('3001234567')).toBeNull();
    expect(whatsappDigits('300 123 4567')).toBeNull();
    expect(whatsappDigits('(57) 300-123-4567')).toBeNull();
  });

  it('refuses what wa.me cannot route', () => {
    expect(whatsappDigits('+57 300')).toBeNull();
    expect(whatsappDigits('call me')).toBeNull();
    expect(whatsappDigits('+1 234 567 890 123 456 7')).toBeNull();
  });

  it('renders the click-to-chat link', () => {
    expect(whatsappHref('573001234567')).toBe('https://wa.me/573001234567');
  });
});

describe('normalizeSocial', () => {
  it('accepts a full URL, a URL without scheme and a bare handle', () => {
    expect(normalizeSocial('instagram', 'https://www.instagram.com/acme/')).toBe('https://www.instagram.com/acme/');
    expect(normalizeSocial('instagram', 'instagram.com/acme')).toBe('https://instagram.com/acme');
    expect(normalizeSocial('instagram', '@acme')).toBe('https://www.instagram.com/acme');
    expect(normalizeSocial('x', 'twitter.com/acme')).toBe('https://twitter.com/acme');
    expect(normalizeSocial('x', 'acme')).toBe('https://x.com/acme');
    expect(normalizeSocial('youtube', '@acme')).toBe('https://www.youtube.com/@acme');
    expect(normalizeSocial('tiktok', 'tiktok.com/@acme')).toBe('https://tiktok.com/@acme');
    expect(normalizeSocial('tiktok', 'acme')).toBe('https://www.tiktok.com/@acme');
  });

  it('accepts dots where the network allows them', () => {
    expect(normalizeSocial('instagram', '@josue.hernandez')).toBe('https://www.instagram.com/josue.hernandez');
    expect(normalizeSocial('instagram', 'josue.hernandez')).toBe('https://www.instagram.com/josue.hernandez');
    expect(normalizeSocial('tiktok', '@brand.co')).toBe('https://www.tiktok.com/@brand.co');
    expect(normalizeSocial('youtube', '@acme.studio-tv_1')).toBe('https://www.youtube.com/@acme.studio-tv_1');
  });

  it('holds each handle to its network’s rules', () => {
    expect(normalizeSocial('x', '@acme.co')).toBeNull();
    expect(normalizeSocial('x', '@acme_hq')).toBe('https://x.com/acme_hq');
    expect(normalizeSocial('instagram', '@acme-hq')).toBeNull();
    expect(normalizeSocial('x', '@waytoolonghandle16')).toBeNull();
  });

  it('reads a bare domain as a link, so another site is still refused', () => {
    expect(normalizeSocial('instagram', 'acme.com')).toBeNull();
    expect(normalizeSocial('tiktok', 'brand.co')).toBeNull();
    expect(normalizeSocial('instagram', 'instagram.com')).toBeNull();
  });

  it('refuses another network, a bare home page, credentials and script URLs', () => {
    expect(normalizeSocial('instagram', 'https://evil.example/acme')).toBeNull();
    expect(normalizeSocial('instagram', 'tiktok.com/@acme')).toBeNull();
    expect(normalizeSocial('youtube', 'https://youtube.com/')).toBeNull();
    expect(normalizeSocial('x', 'https://user:pw@x.com/acme')).toBeNull();
    expect(normalizeSocial('x', 'javascript:alert(1)')).toBeNull();
    expect(normalizeSocial('x', '')).toBeNull();
  });
});

describe('linkPageSchema', () => {
  it('is off by default and keeps an empty page valid', () => {
    expect(linkPageSchema.parse({ version: 1 })).toEqual({ version: 1, enabled: false });
  });

  it('normalizes socials on the way in and clears blank ones', () => {
    const page = linkPageSchema.parse({
      version: 1,
      enabled: true,
      socials: { instagram: 'instagram.com/acme', whatsapp: '+57 300 123 4567', tiktok: '', x: null },
    });
    expect(page.socials).toEqual({
      instagram: 'https://instagram.com/acme',
      whatsapp: '573001234567',
      tiktok: null,
      x: null,
    });
  });

  it('refuses a social that is not that network, naming the network', () => {
    const r = linkPageSchema.safeParse({ version: 1, socials: { youtube: 'https://acme.example/video' } });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('Enter a YouTube channel link or handle, like @yourbrand.');
    const w = linkPageSchema.safeParse({ version: 1, socials: { whatsapp: '3001234567' } });
    expect(w.error?.issues[0]?.message).toContain('country code');
  });

  it('round-trips a stored page through linkPageToInput', () => {
    const stored = linkPageSchema.parse({
      version: 1,
      enabled: true,
      socials: { whatsapp: '+57 300 123 4567', instagram: '@acme' },
    });
    expect(linkPageSchema.parse(linkPageToInput(stored))).toEqual(stored);
  });

  it('reads a stored page back, WhatsApp digits included', () => {
    const stored = linkPageSchema.parse({ version: 1, enabled: true, socials: { whatsapp: '+57 300 123 4567' } });
    const raw = JSON.parse(JSON.stringify(stored)) as unknown;
    expect(parseStoredLinkPage(raw)).toEqual(stored);
    expect(parseStoredLinkPage(null)).toBeNull();
    expect(parseStoredLinkPage({ version: 2 })).toBeNull();
  });

  it('keeps a page at every limit under the body ceiling', () => {
    expect(new TextEncoder().encode(JSON.stringify({ page: maxPage() })).length).toBeLessThan(LINK_PAGE_MAX_BODY_BYTES);
    expect(linkPageSchema.safeParse(maxPage()).success).toBe(true);
  });

  it('refuses non-http links and too many buttons', () => {
    expect(
      linkPageSchema.safeParse({ version: 1, items: [{ type: 'link', label: 'x', url: 'javascript:alert(1)' }] }).success,
    ).toBe(false);
    const many = Array.from({ length: LINK_PAGE_MAX_ITEMS + 1 }, (_, i) => ({ type: 'form', formId: `f${i}` }));
    expect(linkPageSchema.safeParse({ version: 1, items: many }).success).toBe(false);
  });

  it('takes an http(s) logo or an inlined raster image, never SVG or an oversized one', () => {
    const ok = (logo: unknown) => linkPageSchema.safeParse({ version: 1, logo }).success;
    expect(ok('https://cdn.acme.example/logo.png')).toBe(true);
    expect(ok('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(ok(null)).toBe(true);
    expect(ok('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(ok('javascript:alert(1)')).toBe(false);
    expect(ok(`data:image/png;base64,${'A'.repeat(LINK_PAGE_LOGO_MAX_CHARS)}`)).toBe(false);
  });
});

describe('resolveLinkPage', () => {
  const forms: LinkPageFormRef[] = [
    { id: 'f1', slug: 'contact', name: 'Contact (internal)', title: 'Talk to us' },
    { id: 'f2', slug: 'quote', name: 'Quote', title: null },
    { id: 'f3', slug: 'rsvp', name: 'RSVP', title: null },
  ];
  const ctx = { accountCode: 'acme', accountName: 'Acme Inc', forms, brandKit: null };

  it('keeps the author’s order, mixing forms and links', () => {
    const page = linkPageSchema.parse({
      version: 1,
      enabled: true,
      items: [
        { type: 'form', formId: 'f2' },
        { type: 'link', label: 'Store', url: 'https://shop.acme.example' },
        { type: 'form', formId: 'f1' },
        { type: 'link', label: 'Blog', url: 'https://blog.acme.example' },
        { type: 'form', formId: 'f3' },
      ],
    });
    expect(resolveLinkPage(page, ctx).buttons).toEqual([
      { type: 'form', label: 'Quote', slug: 'quote' },
      { type: 'link', label: 'Store', url: 'https://shop.acme.example' },
      { type: 'form', label: 'Talk to us', slug: 'contact' },
      { type: 'link', label: 'Blog', url: 'https://blog.acme.example' },
      { type: 'form', label: 'RSVP', slug: 'rsvp' },
    ]);
  });

  it('drops a form that no longer exists, silently', () => {
    const page = linkPageSchema.parse({
      version: 1,
      items: [{ type: 'form', formId: 'gone' }, { type: 'form', formId: 'f2' }],
    });
    expect(resolveLinkPage(page, ctx).buttons).toEqual([{ type: 'form', label: 'Quote', slug: 'quote' }]);
  });

  it('renders only the filled socials, in network order', () => {
    const page = linkPageSchema.parse({
      version: 1,
      socials: { tiktok: '@acme', instagram: '@acme', whatsapp: '+57 300 123 4567' },
    });
    expect(resolveLinkPage(page, ctx).socials).toEqual([
      { network: 'instagram', href: 'https://www.instagram.com/acme' },
      { network: 'tiktok', href: 'https://www.tiktok.com/@acme' },
      { network: 'whatsapp', href: 'https://wa.me/573001234567' },
    ]);
  });

  it('falls back to the workspace name and the brand kit logo; null means no logo', () => {
    const kit = { logo: 'https://cdn.acme.example/kit.png' };
    const inherit = resolveLinkPage(linkPageSchema.parse({ version: 1, name: '  ' }), { ...ctx, brandKit: kit });
    expect(inherit.name).toBe('Acme Inc');
    expect(inherit.logo).toBe(kit.logo);
    const none = resolveLinkPage(linkPageSchema.parse({ version: 1, logo: null }), { ...ctx, brandKit: kit });
    expect(none.logo).toBeNull();
    const own = resolveLinkPage(linkPageSchema.parse({ version: 1, logo: 'https://cdn.acme.example/own.png' }), {
      ...ctx,
      brandKit: kit,
    });
    expect(own.logo).toBe('https://cdn.acme.example/own.png');
  });
});

describe('linkPageBranding', () => {
  it('takes the brand kit colours and font over the new-form defaults', () => {
    const b = linkPageBranding({ primaryColor: '#ff0066', fontFamily: 'inter', logo: 'https://x.example/l.png' });
    expect(b.primaryColor).toBe('#ff0066');
    expect(b.fontFamily).toBe('inter');
    // The kit's logo is the page's header, not part of its design.
    expect((b as { logo?: unknown }).logo).toBeUndefined();
    expect(b.background).toBeTruthy();
  });

  it('gives a workspace with no kit the look a new form is born with', () => {
    const b = linkPageBranding(null);
    expect(b.background).toBeTruthy();
    expect(b.foreground).toBeTruthy();
    expect(b.primaryColor).toBeTruthy();
  });
});
