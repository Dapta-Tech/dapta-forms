// @vitest-environment happy-dom
/**
 * The home's announcement card: its copy and route, the close button (named,
 * stores the close, hides the card at once), the button (files the visit as
 * the card's), and the animation (poster on the server, the video only once
 * on screen and idle, never under reduced motion, following the theme).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANNOUNCEMENTS, getMessages, type Locale } from '@quill/shared';

const calls = vi.hoisted(() => ({ actions: [] as [string, string][], events: [] as [string, unknown][] }));
vi.mock('@/app/admin/announcement-actions', () => ({
  recordAnnouncementAction: async (id: string, event: string) => {
    calls.actions.push([id, event]);
    return { ok: true };
  },
}));
vi.mock('@/lib/product-analytics', () => ({
  captureEvent: (event: string, props: unknown) => calls.events.push([event, props]),
}));

import { AnnouncementCard } from './announcement-card';
import {
  markAnnouncementFollowed,
  reportAnnouncementSeen,
  resetAnnouncementLoad,
  takeAnnouncementSurface,
} from './announcement-client';

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

function card(locale: Locale = 'en', theme: 'light' | 'dark' = 'light') {
  const m = getMessages(locale).admin.announcements;
  return (
    <AnnouncementCard
      id={a.id}
      copy={m.items[a.copy]}
      cta={a.cta}
      visual={a.visual}
      closeLabel={m.close}
      theme={theme}
    />
  );
}

async function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(node));
}

/** The card scrolls into view, and the browser goes idle. */
async function showAndIdle() {
  await act(async () => {
    for (const o of observers) {
      // Only the card's media: next/link observes its anchors too, for prefetching.
      if (o.el?.getAttribute('data-testid') !== 'announcement-media') continue;
      o.cb([{ isIntersecting: true, target: o.el } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 250));
  });
}

beforeEach(() => {
  calls.actions = [];
  calls.events = [];
  observers = [];
  motion(false);
  document.documentElement.setAttribute('data-theme', 'light');
  window.sessionStorage.clear();
  resetAnnouncementLoad();
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
  // happy-dom has no media pipeline.
  HTMLMediaElement.prototype.play = () => Promise.resolve();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  takeAnnouncementSurface();
});

describe('AnnouncementCard: copy and controls', () => {
  it('says the news in both languages and links to the integrations page', () => {
    for (const locale of ['en', 'es'] as const) {
      const html = renderToStaticMarkup(card(locale));
      const copy = getMessages(locale).admin.announcements.items[a.copy];
      expect(html).toContain(copy.title);
      expect(html).toContain(copy.body);
      expect(html).toContain(copy.cta);
      const cta = html.match(/<a [^>]*data-testid="home-announcement-cta"[^>]*>/)?.[0] ?? '';
      expect(cta).toContain('href="/admin/integrations"');
    }
    expect(getMessages('es').admin.announcements.items[a.copy].cta).toBe('Ver integraciones');
  });

  it('has a close button with an accessible name, and takes no focus', async () => {
    const before = document.activeElement;
    await mount(card('es'));
    const close = $('[data-testid="home-announcement-close"]')!;
    expect(close.tagName).toBe('BUTTON');
    expect(close.getAttribute('aria-label')).toBe('Cerrar anuncio');
    expect(document.activeElement).toBe(before);
    expect(host.innerHTML).not.toContain('autofocus');
    expect(host.innerHTML).not.toContain('aria-modal');
  });

  it('closing it hides it at once, stores the close and tells analytics', async () => {
    await mount(card());
    expect(calls.events).toEqual([['announcement_seen', { announcement_id: a.id, surface: 'card' }]]);
    await act(async () => $('[data-testid="home-announcement-close"]')!.click());
    expect($('[data-testid="home-announcement"]')).toBeNull();
    expect(calls.actions).toEqual([
      [a.id, 'seen'],
      [a.id, 'dismissed'],
    ]);
    expect(calls.events.at(-1)).toEqual(['announcement_dismissed', { announcement_id: a.id, surface: 'card' }]);
  });

  it('the button files the visit it starts as the card’s', async () => {
    await mount(card());
    const cta = $('[data-testid="home-announcement-cta"]')!;
    cta.addEventListener('click', (e) => e.preventDefault());
    await act(async () => cta.click());
    expect(takeAnnouncementSurface()).toBe('card');
    expect(takeAnnouncementSurface()).toBe('page');
  });

  it('stays closed when Home is shown again on the same load (Back), and after its route was reached', async () => {
    await mount(card());
    await act(async () => $('[data-testid="home-announcement-close"]')!.click());
    await act(async () => root.unmount());
    host.remove();
    await mount(card());
    expect($('[data-testid="home-announcement"]')).toBeNull();

    resetAnnouncementLoad();
    markAnnouncementFollowed(a.id);
    await act(async () => root.unmount());
    host.remove();
    await mount(card());
    expect($('[data-testid="home-announcement"]')).toBeNull();
  });

  it('hands focus to the next control when closed from the keyboard', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root.render(
        <>
          {card()}
          <section>
            <a href="/admin/developers/connect" data-testid="next-cta">
              Connect your agent
            </a>
          </section>
        </>,
      ),
    );
    const close = $('[data-testid="home-announcement-close"]')!;
    close.focus();
    await act(async () => close.click());
    expect(document.activeElement).toBe($('[data-testid="next-cta"]'));
  });

  it('reports one sighting per load, shared with the rail', async () => {
    reportAnnouncementSeen(a.id);
    await mount(card());
    expect(calls.actions.filter(([, e]) => e === 'seen')).toHaveLength(1);
  });

  it('counts "seen" in analytics once per browser session', async () => {
    await mount(card());
    await act(async () => root.unmount());
    host.remove();
    await mount(card());
    expect(calls.events.filter(([e]) => e === 'announcement_seen')).toHaveLength(1);
  });
});

describe('AnnouncementCard: the animation', () => {
  it('renders the poster for the server theme, at the render’s aspect ratio, and no video', () => {
    const light = renderToStaticMarkup(card('en', 'light'));
    expect(light).toContain('src="/announcements/announce-integrations-light-poster.png"');
    expect(light).toContain('aspect-ratio:1280 / 720');
    expect(light).not.toContain('<video');
    const dark = renderToStaticMarkup(card('en', 'dark'));
    expect(dark).toContain('src="/announcements/announce-integrations-dark-poster.png"');
  });

  it('starts the video only once the card is on screen and the browser is idle, WebM first', async () => {
    await mount(card());
    expect($('video')).toBeNull();
    await showAndIdle();
    const video = $('video') as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.getAttribute('playsinline')).not.toBeNull();
    expect(video.getAttribute('poster')).toBe('/announcements/announce-integrations-light-poster.png');
    const sources = [...video.querySelectorAll('source')].map((s) => [s.getAttribute('type'), s.getAttribute('src')]);
    expect(sources).toEqual([
      ['video/webm', '/announcements/announce-integrations-light.webm'],
      ['video/mp4', '/announcements/announce-integrations-light.mp4'],
    ]);
    // Decorative: the title says what it shows.
    expect($('[data-testid="announcement-media"]')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('follows the theme toggle', async () => {
    await mount(card('en', 'light'));
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
    await mount(card());
    await showAndIdle();
    expect($('video')).toBeNull();
    expect($('[data-testid="announcement-media"] img')!.getAttribute('src')).toBe(
      '/announcements/announce-integrations-light-poster.png',
    );
  });
});
