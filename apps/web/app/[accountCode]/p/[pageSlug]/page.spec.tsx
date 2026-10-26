/**
 * `/{accountCode}/p/{pageSlug}`: one of a workspace's other link pages.
 *
 * It renders a published page, sends a retired slug (or a slug in another
 * case) to the page's current one and the default page to `/{accountCode}`,
 * each with the query string intact, keeps an old form link through a member
 * whose handle was `p` working, and is a 404 for anything else.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicForm, PublicLinkPage } from '@quill/types';

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

const PAGE: PublicLinkPage = {
  accountCode: 'acme',
  name: 'Acme at Expo',
  bio: null,
  logo: null,
  buttons: [{ type: 'link', label: 'Site', url: 'https://acme.example' }],
  socials: [],
  branding: {},
  pageSlug: 'expo-2026',
  isDefault: false,
};

const pages = new Map<string, PublicLinkPage>([
  ['expo-2026', PAGE],
  ['expo', PAGE],
  ['main', { ...PAGE, pageSlug: 'main', isDefault: true }],
]);
const forms = new Map<string, PublicForm>([['lead-qualifier', { slug: 'lead-qualifier' } as unknown as PublicForm]]);

vi.mock('@/lib/api', () => ({
  getPublicLinkPageBySlug: async (_code: string, slug: string) => pages.get(slug.toLowerCase()) ?? null,
  getPublicForm: async (_code: string, slug: string) => forms.get(slug) ?? null,
}));
vi.mock('@/lib/locale', () => ({ publicLocale: async () => 'en' }));
vi.mock('@/components/link-page/link-page-tracker', () => ({ LinkPageTracker: () => null }));

const permanentRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  permanentRedirect: (url: string) => permanentRedirect(url),
}));

import ExtraLinkPage, { generateMetadata } from './page';

function request(pageSlug: string, query: Record<string, string | string[]> = {}) {
  return { params: Promise.resolve({ accountCode: 'acme', pageSlug }), searchParams: Promise.resolve(query) };
}

describe('/{accountCode}/p/{pageSlug}', () => {
  beforeEach(() => {
    permanentRedirect.mockClear();
  });

  it('renders a published page at its current slug', async () => {
    const out = await ExtraLinkPage(request('expo-2026'));
    expect(out).toBeTruthy();
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it('sends a retired slug, or another case, to the current slug with the query', async () => {
    await expect(ExtraLinkPage(request('expo', { utm_source: 'qr', tag: ['a', 'b'] }))).rejects.toThrow(
      'NEXT_REDIRECT:/acme/p/expo-2026?utm_source=qr&tag=a&tag=b',
    );
    await expect(ExtraLinkPage(request('EXPO-2026'))).rejects.toThrow('NEXT_REDIRECT:/acme/p/expo-2026');
  });

  it('sends the default page to the workspace root', async () => {
    await expect(ExtraLinkPage(request('main', { utm_source: 'ig' }))).rejects.toThrow('NEXT_REDIRECT:/acme?utm_source=ig');
  });

  it('keeps an old form link through a member called `p` working', async () => {
    await expect(ExtraLinkPage(request('lead-qualifier'))).rejects.toThrow('NEXT_REDIRECT:/acme/f/lead-qualifier');
  });

  it('is a 404 for an unknown, unpublished or impossible slug', async () => {
    await expect(ExtraLinkPage(request('nothing-here'))).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(ExtraLinkPage(request('x'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('names the current address as canonical and points at the page’s own share card', async () => {
    const meta = await generateMetadata(request('expo'));
    expect(meta.alternates?.canonical).toBe('/acme/p/expo-2026');
    expect(JSON.stringify(meta.openGraph)).toContain('/api/public/pages/acme/expo-2026/og');
    expect((await generateMetadata(request('nothing-here'))).robots).toEqual({ index: false, follow: false });
  });
});
