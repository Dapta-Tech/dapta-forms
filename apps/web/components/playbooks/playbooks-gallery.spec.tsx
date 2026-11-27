// @vitest-environment happy-dom
/**
 * The gallery on screen: tabs with their counts, the cards of the selected
 * tab with their state, the visit recorded once, the client events, and the
 * ES / EN toggle (the language of the playbooks: the cards, the address, the
 * stored choice, the fallback note).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';
import type { PlaybookCard } from '@/lib/admin-api';

const calls = vi.hoisted(() => ({ visits: 0, events: [] as [string, unknown][] }));
vi.mock('@/app/admin/playbook-actions', () => ({
  recordPlaybooksGalleryVisitAction: async () => {
    calls.visits += 1;
    return { ok: true };
  },
}));
vi.mock('@/lib/product-analytics', () => ({
  captureEvent: (event: string, props: unknown) => calls.events.push([event, props]),
}));

import { PlaybooksGallery } from './playbooks-gallery';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.UTC(2026, 11, 10, 15);
const DAY = 86_400_000;
function card(slug: string, category: string, state: Partial<PlaybookCard> = {}): PlaybookCard {
  return {
    slug,
    locale: 'es',
    fallback: false,
    category,
    title: `Título ${slug}`,
    summary: `Resumen ${slug}`,
    publishedAt: NOW - 3 * DAY,
    promisedBy: [],
    template: 't',
    thumbnailVideo: null,
    thumbnailPoster: null,
    seen: false,
    firstSeenAt: null,
    lastSeenAt: null,
    isNew: false,
    ...state,
  };
}
const CARDS = [
  card('a', 'ventas', { isNew: true }),
  card('b', 'ventas', { seen: true, lastSeenAt: NOW - 2 * DAY, firstSeenAt: NOW - 2 * DAY }),
  card('c', 'agentes'),
];
/** The same cards in English: `a` is translated, `b` and `c` are their Spanish ones. */
const CARDS_EN = [
  { ...CARDS[0]!, locale: 'en', title: 'Title a', summary: 'Summary a' },
  { ...CARDS[1]!, fallback: true },
  { ...CARDS[2]!, fallback: true },
];
const KEY = 'dforms.playbooks.lang.member-1';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
async function mount(
  initialTab: 'all' | 'ventas' | 'agentes' = 'all',
  tabs: ('all' | 'ventas' | 'agentes')[] = ['all', 'ventas', 'agentes'],
  { initialLocale = 'es', langInUrl = false }: { initialLocale?: 'es' | 'en'; langInUrl?: boolean } = {},
) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <PlaybooksGallery
        cardsByLocale={{ es: CARDS, en: CARDS_EN }}
        initialLocale={initialLocale}
        langInUrl={langInUrl}
        storageKey={KEY}
        tabs={tabs}
        initialTab={initialTab}
        newCount={1}
        now={NOW}
        locale="es"
        m={getMessages('es').admin.playbooks}
      />,
    ),
  );
}
const slugs = () => [...host!.querySelectorAll('[data-testid="playbook-card"]')].map((a) => a.getAttribute('data-slug'));

const pressed = () =>
  [...host!.querySelectorAll('[data-testid="playbooks-locale"] button')].map((b) => [
    b.textContent,
    b.getAttribute('aria-pressed'),
  ]);
/** Each card's title with the language it is written in. */
const titles = () =>
  [...host!.querySelectorAll('[data-testid="playbook-card"]')].map((a) => {
    const title = a.querySelector('[lang]')!;
    return [title.getAttribute('lang'), title.textContent];
  });

beforeEach(() => {
  calls.visits = 0;
  calls.events = [];
  window.history.replaceState(null, '', '/admin/playbooks');
  window.localStorage.clear();
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
});

describe('PlaybooksGallery', () => {
  it('shows every card under "All", each with its state, and the tabs with their counts', async () => {
    await mount();
    expect(slugs()).toEqual(['a', 'b', 'c']);
    const tabs = [...host!.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(['Todos3', 'Ventas2', 'Agentes e IA1']);
    const states = [...host!.querySelectorAll('[data-status]')].map((s) => s.textContent);
    expect(states[0]).toMatch(/^Nuevo/);
    expect(states[1]).toBe('Visto hace 2 días');
    expect(states[2]).toBe('No visto');
    expect(host!.querySelector('[data-testid="playbooks-new-since"]')!.textContent).toBe('1 nuevo desde tu última visita');
    expect(host!.querySelector('a[data-slug="a"]')!.getAttribute('href')).toBe('/admin/playbooks/a?lang=es');
  });

  it('records the visit once and reports the gallery view', async () => {
    await mount('ventas');
    expect(calls.visits).toBe(1);
    expect(calls.events).toEqual([['playbooks_gallery_viewed', { new_count: 1, count: 3, category: 'ventas', locale: 'es' }]]);
  });

  it('opens on the tab it is given and switches on a click, keeping it in the address', async () => {
    await mount('ventas');
    expect(slugs()).toEqual(['a', 'b']);
    await act(async () => host!.querySelector<HTMLElement>('[data-testid="playbooks-tab-agentes"]')!.click());
    expect(slugs()).toEqual(['c']);
    expect(host!.querySelector('[data-testid="playbooks-tab-agentes"]')!.getAttribute('aria-selected')).toBe('true');
    expect(window.location.search).toBe('?category=agentes');
    expect(calls.events.at(-1)).toEqual(['playbooks_category_selected', { category: 'agentes', locale: 'es' }]);

    await act(async () => host!.querySelector<HTMLElement>('[data-testid="playbooks-tab-all"]')!.click());
    expect(slugs()).toEqual(['a', 'b', 'c']);
    expect(window.location.search).toBe('');
  });

  it('draws no tabs and no tab panel with "All" alone', async () => {
    await mount('all', ['all']);
    expect(host!.querySelector('[role="tablist"]')).toBeNull();
    const grid = host!.querySelector('#playbooks-grid')!;
    expect(grid.hasAttribute('role')).toBe(false);
    expect(grid.hasAttribute('aria-labelledby')).toBe(false);
    expect(slugs()).toEqual(['a', 'b', 'c']);
  });

  it('draws the category placeholder while a playbook has no thumbnail', async () => {
    await mount();
    expect(host!.querySelectorAll('[data-testid="playbook-thumb-placeholder"]')).toHaveLength(3);
  });
});

describe('the ES / EN toggle', () => {
  it('is a group of two pressed-state buttons, named by language and code, the shown one pressed', async () => {
    await mount();
    const group = host!.querySelector('[data-testid="playbooks-locale"]')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Idioma de los playbooks');
    expect(pressed()).toEqual([
      ['ES', 'true'],
      ['EN', 'false'],
    ]);
    expect([...group.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Español (ES)', 'Inglés (EN)']);
    expect(host!.querySelector('[data-testid="playbooks-fallback"]')).toBeNull();
  });

  it('switches the cards to English on a click, keeps the state, and says which ones are still in Spanish', async () => {
    window.history.replaceState(null, '', '/admin/playbooks?category=ventas');
    await mount('ventas');
    await act(async () => host!.querySelector<HTMLElement>('[data-testid="playbooks-locale-en"]')!.click());
    expect(pressed()).toEqual([
      ['ES', 'false'],
      ['EN', 'true'],
    ]);
    expect(titles()).toEqual([
      ['en', 'Title a'],
      ['es', 'Título b'],
    ]);
    // The state is the slug's: "New" and "read" do not move with the language.
    const states = [...host!.querySelectorAll('[data-status]')].map((s) => s.getAttribute('data-status'));
    expect(states).toEqual(['new', 'seen']);
    expect(host!.querySelector('[data-testid="playbooks-fallback"]')!.textContent).toBe(
      'Algunos playbooks aún no están en inglés: los ves en español.',
    );
    expect([...host!.querySelectorAll('[data-testid="playbook-card-fallback"]')].map((e) => e.closest('a')!.getAttribute('data-slug'))).toEqual(['b']);
    expect(host!.querySelector('a[data-slug="a"]')!.getAttribute('href')).toBe('/admin/playbooks/a?lang=en');
    // Kept in the address with the tab, and in the browser for this person.
    expect(window.location.search).toBe('?category=ventas&lang=en');
    expect(window.localStorage.getItem(KEY)).toBe('en');
    expect(calls.events.at(-1)).toEqual(['playbooks_locale_changed', { from: 'es', to: 'en', surface: 'gallery' }]);
    // The visit was recorded once, on open; a language change records nothing.
    expect(calls.visits).toBe(1);

    await act(async () => host!.querySelector<HTMLElement>('[data-testid="playbooks-tab-agentes"]')!.click());
    expect(calls.events.at(-1)).toEqual(['playbooks_category_selected', { category: 'agentes', locale: 'en' }]);
  });

  it('does nothing on a click of the language already shown', async () => {
    await mount();
    await act(async () => host!.querySelector<HTMLElement>('[data-testid="playbooks-locale-es"]')!.click());
    expect(calls.events.map(([e]) => e)).toEqual(['playbooks_gallery_viewed']);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('opens in the language this person chose last time, and says so in the address and the view event', async () => {
    window.localStorage.setItem(KEY, 'en');
    await mount();
    expect(pressed()[1]).toEqual(['EN', 'true']);
    expect(titles()[0]).toEqual(['en', 'Title a']);
    expect(window.location.search).toBe('?lang=en');
    expect(calls.events).toEqual([['playbooks_gallery_viewed', { new_count: 1, count: 3, category: 'all', locale: 'en' }]]);
  });

  it('keeps the choice per person: another member key reads nothing', async () => {
    window.localStorage.setItem('dforms.playbooks.lang.member-2', 'en');
    await mount();
    expect(pressed()[0]).toEqual(['ES', 'true']);
    expect(window.location.search).toBe('');
  });

  it('lets a shared link win over the stored choice', async () => {
    window.localStorage.setItem(KEY, 'en');
    window.history.replaceState(null, '', '/admin/playbooks?lang=es');
    await mount('all', undefined, { initialLocale: 'es', langInUrl: true });
    expect(pressed()[0]).toEqual(['ES', 'true']);
    expect(window.location.search).toBe('?lang=es');
  });

  it('opens in English when the page rendered it (a link with ?lang=en, or an English platform)', async () => {
    await mount('all', undefined, { initialLocale: 'en', langInUrl: true });
    expect(pressed()[1]).toEqual(['EN', 'true']);
    expect(host!.querySelector('[data-testid="playbooks-fallback"]')).not.toBeNull();
  });

  it('still works when the browser refuses storage', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      await mount();
      expect(pressed()[0]).toEqual(['ES', 'true']);
      await act(async () => host!.querySelector<HTMLElement>('[data-testid="playbooks-locale-en"]')!.click());
      expect(pressed()[1]).toEqual(['EN', 'true']);
      expect(window.location.search).toBe('?lang=en');
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
