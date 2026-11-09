import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicLinkPage } from '@quill/types';
import { daptaFormsMark } from '@/lib/og-brand';

/**
 * The share cards follow the workspace's attribution switch: a workspace that
 * turned it off (`showAttribution: false`) gets cards with no dForms mark, and
 * an absent flag (older API, untouched workspace) keeps today's card.
 *
 * `ImageResponse` is replaced by a recorder so the test reads the element tree
 * the card hands to the renderer instead of decoding a PNG.
 */

const rendered: ReactNode[] = [];
vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(element: ReactNode) {
      rendered.push(element);
    }
  },
}));
vi.mock('next/headers', () => ({
  headers: async () => new Map([['host', 'app.dforms.ai']]),
}));
vi.mock('@/lib/og-fonts', () => ({ cardFonts: () => [] }));
vi.mock('@/lib/og-remote-image', () => ({
  remoteImageDataUri: async (url?: string | null) => (url ? 'data:image/png;base64,QVVUSE9S' : null),
}));
vi.mock('@/lib/locale', () => ({ publicLocale: async () => 'en' }));
const getPublicForm = vi.fn();
vi.mock('@/lib/api', () => ({ getPublicForm: (...a: unknown[]) => getPublicForm(...a) }));

const AUTHOR_LOGO = 'data:image/png;base64,QVVUSE9S';
const MARKS = new Set([daptaFormsMark(true), daptaFormsMark(false)]);

/** Every `<img src>` the card draws, rendering function components on the way. */
function imageSources(node: ReactNode, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) imageSources(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const props = node.props as { src?: string; children?: ReactNode };
  if (typeof node.type === 'function') {
    return imageSources((node.type as (p: unknown) => ReactNode)(props), out);
  }
  if (node.type === 'img' && props.src) out.push(props.src);
  return imageSources(props.children, out);
}

function lastCard(): string[] {
  return imageSources(rendered[rendered.length - 1]);
}

const hasMark = (srcs: string[]) => srcs.some((s) => MARKS.has(s));

// The card draws the author's logo only on a branded form (a chosen background).
function form(showAttribution: boolean | undefined, logo?: string, logoPosition?: 'center') {
  return {
    id: 'f1',
    name: 'Contact',
    config: {
      version: 1,
      steps: [{ key: 'a', type: 'text', question: 'Your name?' }],
      ...(logo ? { branding: { logo, background: '#ffffff', ...(logoPosition ? { logoPosition } : {}) } } : {}),
    },
    ...(showAttribution === undefined ? {} : { showAttribution }),
  };
}

describe('form share card and the attribution switch', () => {
  beforeEach(() => {
    rendered.length = 0;
    getPublicForm.mockReset();
  });

  async function card(
    showAttribution: boolean | undefined,
    logo?: string,
    logoPosition?: 'center',
  ): Promise<string[]> {
    getPublicForm.mockResolvedValue(form(showAttribution, logo, logoPosition));
    const { default: OgImage } = await import('@/app/[accountCode]/[handle]/[slug]/opengraph-image');
    await OgImage({ params: Promise.resolve({ accountCode: 'acme', slug: 'contact' }) });
    return lastCard();
  }

  it('keeps the dForms mark when the flag is absent (older API, untouched workspace)', async () => {
    expect(hasMark(await card(undefined))).toBe(true);
  });

  it('keeps the dForms mark when the attribution shows', async () => {
    expect(hasMark(await card(true))).toBe(true);
    expect(hasMark(await card(true, 'https://cdn.example/logo.png'))).toBe(true);
  });

  it('draws no dForms mark when the workspace hides the attribution, with no author logo', async () => {
    expect(hasMark(await card(false))).toBe(false);
  });

  it('keeps the author logo and drops only the dForms mark', async () => {
    const srcs = await card(false, 'https://cdn.example/logo.png');
    expect(srcs).toContain(AUTHOR_LOGO);
    expect(hasMark(srcs)).toBe(false);
  });

  it('a centred author logo: the mark leaves the meta row too', async () => {
    const shown = await card(true, 'https://cdn.example/logo.png', 'center');
    expect(shown).toContain(AUTHOR_LOGO);
    expect(hasMark(shown)).toBe(true);
    const hidden = await card(false, 'https://cdn.example/logo.png', 'center');
    expect(hidden).toContain(AUTHOR_LOGO);
    expect(hasMark(hidden)).toBe(false);
  });
});

describe('link page share card and the attribution switch', () => {
  beforeEach(() => {
    rendered.length = 0;
  });

  async function card(showAttribution: boolean | undefined): Promise<string[]> {
    const { linkPageCardResponse } = await import('@/lib/link-page-og');
    const page = {
      accountCode: 'acme',
      name: 'Acme',
      bio: 'Hi',
      logo: null,
      branding: null,
      ...(showAttribution === undefined ? {} : { showAttribution }),
    } as unknown as PublicLinkPage;
    await linkPageCardResponse(page);
    return lastCard();
  }

  it('keeps the dForms mark when the flag is absent or true', async () => {
    expect(hasMark(await card(undefined))).toBe(true);
    expect(hasMark(await card(true))).toBe(true);
  });

  it('draws no dForms mark when the workspace hides the attribution', async () => {
    expect(hasMark(await card(false))).toBe(false);
  });
});
