// @vitest-environment happy-dom
/**
 * The inline media of a playbook on screen: an animation as a muted lazy loop
 * over its poster (only the poster with reduced motion), an image as a lazy
 * still, both sized from the manifest and named by the marker's alt; the
 * loops share the page's cap with the gallery's thumbnails; and nothing in a
 * body becomes raw HTML.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/playbook-media.generated', () => ({
  PLAYBOOK_MEDIA_SIZES: { 'es/formularios-que-venden-con-ia/demo-poster.webp': { width: 464, height: 288 } },
}));

import { parseMarkdown } from '@/lib/markdown';
import { MarkdownView } from './markdown-view';
import { MAX_PLAYING } from './loop-video';
import { PlaybookThumb } from './playbook-thumb';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = 'formularios-que-venden-con-ia';
const ANIM = `<!-- anim: ${SLUG}/demo | Claude | ChatGPT crean el form -->`;
const IMG = `<!-- img: ${SLUG}/panel | El panel de respuestas -->`;

let reduced = false;
let observed: Element[] = [];
let fire: ((entries: { target: Element; isIntersecting: boolean }[]) => void) | null = null;
const playing = new Set<HTMLMediaElement>();

beforeEach(() => {
  reduced = false;
  observed = [];
  playing.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('reduce'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  window.matchMedia = globalThis.matchMedia;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: typeof fire) {
        fire = cb;
      }
      observe(el: Element) {
        observed.push(el);
      }
      unobserve(el: Element) {
        observed = observed.filter((e) => e !== el);
      }
    },
  );
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return !playing.has(this);
    },
  });
  HTMLMediaElement.prototype.play = async function (this: HTMLMediaElement) {
    playing.add(this);
  };
  HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
    playing.delete(this);
  };
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;
async function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  vi.unstubAllGlobals();
});

const body = (markdown: string, locale = 'es') => <MarkdownView blocks={parseMarkdown(markdown)} locale={locale} />;

describe('an inline animation', () => {
  it('is a muted lazy loop over its poster, sized and named', async () => {
    await mount(body(`Antes\n\n${ANIM}\n\nDespués`));
    const figure = host!.querySelector('figure[data-testid="playbook-media"]')!;
    expect(figure.getAttribute('data-kind')).toBe('anim');
    const video = figure.querySelector('video')!;
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.getAttribute('preload')).toBe('none');
    expect(video.getAttribute('poster')).toBe(`/playbooks/inline/es/${SLUG}/demo-poster.webp`);
    expect(video.getAttribute('aria-label')).toBe('Claude | ChatGPT crean el form');
    expect(video.getAttribute('width')).toBe('464');
    expect(video.getAttribute('height')).toBe('288');
    expect([...video.querySelectorAll('source')].map((s) => [s.getAttribute('src'), s.getAttribute('type')])).toEqual([
      [`/playbooks/inline/es/${SLUG}/demo.webm`, 'video/webm'],
      [`/playbooks/inline/es/${SLUG}/demo.mp4`, 'video/mp4'],
    ]);
    // The text on both sides stays.
    expect([...host!.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['Antes', 'Después']);
  });

  it('is only its poster with reduced motion', async () => {
    reduced = true;
    await mount(body(ANIM));
    expect(host!.querySelector('video')).toBeNull();
    const img = host!.querySelector('figure img')!;
    expect(img.getAttribute('src')).toBe(`/playbooks/inline/es/${SLUG}/demo-poster.webp`);
    expect(img.getAttribute('alt')).toBe('Claude | ChatGPT crean el form');
    expect(img.getAttribute('width')).toBe('464');
  });

  it('plays only on screen, and shares the cap of the page with the thumbnails', async () => {
    const anims = Array.from({ length: 3 }, (_, i) => ANIM.replace('/demo ', `/demo-${i} `)).join('\n\n');
    await mount(
      <>
        <PlaybookThumb video="/playbooks/a.webm" poster={null} category="ventas" />
        <PlaybookThumb video="/playbooks/b.webm" poster={null} category="ventas" />
        {body(anims)}
      </>,
    );
    const videos = [...host!.querySelectorAll('video')];
    expect(videos).toHaveLength(5);
    expect(observed).toHaveLength(5);
    expect(playing.size).toBe(0);
    await act(async () => fire!(videos.map((v) => ({ target: v, isIntersecting: true }))));
    await act(async () => {});
    // The first three in page order: the two thumbnails and the first animation.
    expect(videos.filter((v) => playing.has(v))).toEqual(videos.slice(0, MAX_PLAYING));
    await act(async () => fire!([{ target: videos[0]!, isIntersecting: false }]));
    await act(async () => {});
    expect(videos.filter((v) => playing.has(v))).toEqual(videos.slice(1, 1 + MAX_PLAYING));
  });
});

describe('the language of the playbook', () => {
  it('picks the folder of its media, and its size', async () => {
    await mount(body(`${ANIM}\n\n${IMG}`, 'en'));
    const video = host!.querySelector('video')!;
    expect(video.getAttribute('poster')).toBe(`/playbooks/inline/en/${SLUG}/demo-poster.webp`);
    expect([...video.querySelectorAll('source')].map((s) => s.getAttribute('src'))).toEqual([
      `/playbooks/inline/en/${SLUG}/demo.webm`,
      `/playbooks/inline/en/${SLUG}/demo.mp4`,
    ]);
    expect(host!.querySelector('figure img')!.getAttribute('src')).toBe(`/playbooks/inline/en/${SLUG}/panel.webp`);
    // The manifest only knows the Spanish poster: the English one has no size of its own.
    expect(video.hasAttribute('width')).toBe(false);
  });
});

describe('an inline image', () => {
  it('is a lazy still with its alt, without a size the manifest does not know', async () => {
    await mount(body(IMG));
    const figure = host!.querySelector('figure[data-testid="playbook-media"]')!;
    expect(figure.getAttribute('data-kind')).toBe('img');
    const img = figure.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(`/playbooks/inline/es/${SLUG}/panel.webp`);
    expect(img.getAttribute('alt')).toBe('El panel de respuestas');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.hasAttribute('width')).toBe(false);
    expect(figure.querySelector('video')).toBeNull();
  });
});

describe('the body around them', () => {
  it('shows no comment and renders no raw HTML', async () => {
    await mount(
      body(
        [
          'Texto <!-- nota --> visible.',
          '<!-- comentario\nde dos líneas -->',
          `<!-- anim: ${SLUG}/demo -->`,
          '<script>window.__x = 1</script>',
          '<img src="/x.png" onerror="window.__x = 2">',
          '<!-- muro -->',
        ].join('\n\n'),
      ),
    );
    expect(host!.querySelector('script')).toBeNull();
    expect(host!.querySelector('img')).toBeNull();
    expect(host!.querySelector('figure')).toBeNull();
    expect(host!.textContent).not.toContain('<!--');
    expect(host!.textContent).not.toContain('nota');
    expect(host!.textContent).toContain('<script>window.__x = 1</script>');
    expect(host!.textContent).toContain('Texto  visible.');
  });
});
