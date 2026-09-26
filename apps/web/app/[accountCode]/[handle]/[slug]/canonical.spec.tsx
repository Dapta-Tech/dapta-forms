/**
 * What the public form page tells a visitor and a crawler about its URL.
 *
 * Every link handed out before the neutral `/{accountCode}/f/{slug}` shape
 * named a member in the middle segment, and those links live on in printed QR
 * codes, embeds and ads. They must keep serving the form (no forced redirect),
 * while the canonical tag names the neutral URL. A retired slug is the one case
 * that still moves the visitor, and it lands on the neutral URL with the query
 * string intact, never on the handle the visitor arrived with.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicForm } from '@quill/types';

// `next/font/google` resolves at build time and has no runtime in vitest; the
// renderers the page imports only need a className from it.
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

// The form answers to `lead-qualifier` today; any other slug reached it through
// the alias ledger.
const form = {
  slug: 'lead-qualifier',
  name: 'Lead Qualifier',
  config: { version: 1, steps: [{ key: 'q1', type: 'text', question: 'Your name?' }] },
} as unknown as PublicForm;
vi.mock('@/lib/api', () => ({ getPublicForm: async () => form }));
vi.mock('@/lib/locale', () => ({ publicLocale: async () => 'en' }));

// Next's redirect throws to end the render; so does this stand-in, carrying
// the target it was handed.
const permanentRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  permanentRedirect: (url: string) => permanentRedirect(url),
}));

import PublicFormPage, { generateMetadata } from './page';

function request(handle: string, slug: string, query: Record<string, string | string[]> = {}) {
  return {
    params: Promise.resolve({ accountCode: 'acme', handle, slug }),
    searchParams: Promise.resolve(query),
  };
}

describe('the canonical tag', () => {
  it('names the neutral URL when an old link names a member', async () => {
    const meta = await generateMetadata(request('alex-rivera', 'lead-qualifier', { utm_source: 'qa' }));
    expect(meta.alternates?.canonical).toBe('/acme/f/lead-qualifier');
  });

  it('is left out when the neutral URL is the one requested', async () => {
    const meta = await generateMetadata(request('f', 'lead-qualifier'));
    expect(meta.alternates).toBeUndefined();
  });

  it('names the current slug under the neutral segment for a retired one', async () => {
    const meta = await generateMetadata(request('alex-rivera', 'old-link'));
    expect(meta.alternates?.canonical).toBe('/acme/f/lead-qualifier');
  });
});

describe('the page', () => {
  beforeEach(() => {
    permanentRedirect.mockClear();
  });

  it('serves an old named link where it is, with no redirect', async () => {
    await expect(PublicFormPage(request('alex-rivera', 'lead-qualifier'))).resolves.toBeTruthy();
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it('moves a retired slug onto the neutral URL, keeping every query parameter', async () => {
    await expect(
      PublicFormPage(
        request('alex-rivera', 'old-link', { utm_source: 'qa', embed: '1', step: '2', tag: ['a', 'b'] }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(permanentRedirect).toHaveBeenCalledWith('/acme/f/lead-qualifier?utm_source=qa&embed=1&step=2&tag=a&tag=b');
  });
});
