// @vitest-environment happy-dom
/**
 * The gallery on screen: tabs with their counts, the cards of the selected
 * tab with their state, the visit recorded once, and the client events.
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

let root: Root | undefined;
let host: HTMLDivElement | undefined;
async function mount(
  initialTab: 'all' | 'ventas' | 'agentes' = 'all',
  tabs: ('all' | 'ventas' | 'agentes')[] = ['all', 'ventas', 'agentes'],
) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <PlaybooksGallery
        cards={CARDS}
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

beforeEach(() => {
  calls.visits = 0;
  calls.events = [];
  window.history.replaceState(null, '', '/admin/playbooks');
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
    expect(host!.querySelector('a[data-slug="a"]')!.getAttribute('href')).toBe('/admin/playbooks/a');
  });

  it('records the visit once and reports the gallery view', async () => {
    await mount('ventas');
    expect(calls.visits).toBe(1);
    expect(calls.events).toEqual([['playbooks_gallery_viewed', { new_count: 1, count: 3, category: 'ventas' }]]);
  });

  it('opens on the tab it is given and switches on a click, keeping it in the address', async () => {
    await mount('ventas');
    expect(slugs()).toEqual(['a', 'b']);
    await act(async () => host!.querySelector<HTMLElement>('[data-testid="playbooks-tab-agentes"]')!.click());
    expect(slugs()).toEqual(['c']);
    expect(host!.querySelector('[data-testid="playbooks-tab-agentes"]')!.getAttribute('aria-selected')).toBe('true');
    expect(window.location.search).toBe('?category=agentes');
    expect(calls.events.at(-1)).toEqual(['playbooks_category_selected', { category: 'agentes' }]);

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
