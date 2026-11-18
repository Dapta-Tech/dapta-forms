// @vitest-environment happy-dom
/**
 * The pop-up's animation: the poster first, at the render's aspect ratio; the
 * video only once on screen and idle (WebM first, MP4 for Safari, muted,
 * looping, inline); following the theme toggle; never under reduced motion.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ANNOUNCEMENTS } from '@quill/shared';
import { AnnouncementMedia } from './announcement-modal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const a = ANNOUNCEMENTS.find((x) => x.id === 'integrations-2026-11')!;
let root: Root;
let host: HTMLDivElement;
let observers: { cb: IntersectionObserverCallback; el?: Element }[];
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);

function motion(reduce: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: reduce && q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const media = (theme: 'light' | 'dark' = 'light') => <AnnouncementMedia visual={a.visual} theme={theme} />;

async function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(node));
}

/** It comes into view, and the browser goes idle. */
async function showAndIdle() {
  await act(async () => {
    for (const o of observers) o.cb([{ isIntersecting: true, target: o.el } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 250));
  });
}

beforeEach(() => {
  observers = [];
  motion(false);
  document.documentElement.setAttribute('data-theme', 'light');
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    private entry: { cb: IntersectionObserverCallback; el?: Element };
    constructor(cb: IntersectionObserverCallback) {
      this.entry = { cb };
      observers.push(this.entry);
    }
    observe(el: Element) {
      this.entry.el = el;
    }
    unobserve() {}
    disconnect() {}
  };
  delete (window as { requestIdleCallback?: unknown }).requestIdleCallback;
  HTMLMediaElement.prototype.play = () => Promise.resolve();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

describe('AnnouncementMedia', () => {
  it('renders the poster for the server theme, at the render’s aspect ratio, and no video', () => {
    const light = renderToStaticMarkup(media('light'));
    expect(light).toContain('src="/announcements/announce-integrations-light-poster.png"');
    expect(light).toContain('aspect-ratio:1280 / 720');
    expect(light).not.toContain('<video');
    expect(renderToStaticMarkup(media('dark'))).toContain('src="/announcements/announce-integrations-dark-poster.png"');
  });

  it('starts the video only once on screen and idle, WebM first, decorative', async () => {
    await mount(media());
    expect($('video')).toBeNull();
    await showAndIdle();
    const video = $('video') as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.getAttribute('playsinline')).not.toBeNull();
    expect(video.getAttribute('poster')).toBe('/announcements/announce-integrations-light-poster.png');
    expect([...video.querySelectorAll('source')].map((s) => [s.getAttribute('type'), s.getAttribute('src')])).toEqual([
      ['video/webm', '/announcements/announce-integrations-light.webm'],
      ['video/mp4', '/announcements/announce-integrations-light.mp4'],
    ]);
    expect($('[data-testid="announcement-media"]')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('follows the theme toggle', async () => {
    await mount(media('light'));
    await showAndIdle();
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      await new Promise((r) => setTimeout(r, 0));
    });
    expect($('video source')!.getAttribute('src')).toBe('/announcements/announce-integrations-dark.webm');
    expect($('[data-testid="announcement-media"] img')!.getAttribute('src')).toBe(
      '/announcements/announce-integrations-dark-poster.png',
    );
  });

  it('shows the poster alone under reduced motion', async () => {
    motion(true);
    await mount(media());
    await showAndIdle();
    expect($('video')).toBeNull();
    expect($('[data-testid="announcement-media"] img')).not.toBeNull();
  });
});
