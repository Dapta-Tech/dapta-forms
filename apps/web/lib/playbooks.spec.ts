/**
 * The gallery's view logic: which tab a URL opens, what each tab holds, and
 * how a card words its state ("New", read some time ago, not read yet).
 */
import { describe, expect, it } from 'vitest';
import { getMessages } from '@quill/shared';
import { PLAYBOOK_CATEGORIES } from '@quill/shared/playbooks';
import {
  PLAYBOOK_TABS,
  PLAYBOOK_TAB_CATEGORIES,
  cardsForTab,
  categoryLabel,
  headingId,
  isPlaybookSlug,
  newSinceLabel,
  nextPlaybook,
  playbookStatus,
  publishedLabel,
  readingMinutes,
  seenAgoLabel,
  tabCounts,
  tabFromParam,
  visibleTabs,
} from './playbooks';

const es = getMessages('es').admin.playbooks;
const en = getMessages('en').admin.playbooks;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 11, 10, 15, 0); // Thursday 10 Dec 2026, 10:00 in Bogota
const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const card = (slug: string, category: string) => ({ slug, category });

describe('tabs', () => {
  it('lists the same categories as the catalog, in the same order', () => {
    expect([...PLAYBOOK_TAB_CATEGORIES]).toEqual([...PLAYBOOK_CATEGORIES]);
    expect(PLAYBOOK_TABS[0]).toBe('all');
  });

  it('shows "All" and only the categories with something published, in tab order', () => {
    expect(visibleTabs(['agentes', 'ventas'])).toEqual(['all', 'ventas', 'agentes']);
    expect(visibleTabs([])).toEqual(['all']);
    expect(visibleTabs(['ventas', 'recetas'])).toEqual(['all', 'ventas']);
  });

  it('opens the tab the URL names, and "All" for anything else', () => {
    const tabs = visibleTabs(['ventas', 'marketing']);
    expect(tabFromParam('marketing', tabs)).toBe('marketing');
    expect(tabFromParam(['ventas', 'ads'], tabs)).toBe('ventas');
    expect(tabFromParam(undefined, tabs)).toBe('all');
    expect(tabFromParam('', tabs)).toBe('all');
    expect(tabFromParam('recetas', tabs)).toBe('all');
    // A real category with nothing published: not an empty page.
    expect(tabFromParam('ads', tabs)).toBe('all');
    expect(tabFromParam('Ventas', tabs)).toBe('all');
  });

  it('filters the cards of a tab and counts every tab', () => {
    const cards = [card('a', 'ventas'), card('b', 'ads'), card('c', 'ventas'), card('d', 'recetas')];
    expect(cardsForTab(cards, 'all').map((c) => c.slug)).toEqual(['a', 'b', 'c', 'd']);
    expect(cardsForTab(cards, 'ventas').map((c) => c.slug)).toEqual(['a', 'c']);
    expect(cardsForTab(cards, 'marketing')).toEqual([]);
    expect(tabCounts(cards)).toEqual({ all: 4, ventas: 2, marketing: 0, ads: 1, agentes: 0 });
  });

  it('names each tab in both languages', () => {
    expect(PLAYBOOK_TABS.map((tab) => categoryLabel(tab, es))).toEqual(['Todos', 'Ventas', 'Marketing', 'Ads', 'Agentes e IA']);
    expect(categoryLabel('agentes', en)).toBe('Agents and AI');
    expect(categoryLabel('recetas', es)).toBe('recetas');
  });
});

describe('seenAgoLabel', () => {
  const at = (elapsed: number, m = es.status) => seenAgoLabel(NOW - elapsed, NOW, m, dateOf);

  it('words elapsed time from just now to a month, then gives the date', () => {
    expect(at(10_000)).toBe('Visto hace un momento');
    expect(at(5 * MIN)).toBe('Visto hace 5 min');
    expect(at(59 * MIN)).toBe('Visto hace 59 min');
    expect(at(HOUR)).toBe('Visto hace 1 h');
    expect(at(23 * HOUR)).toBe('Visto hace 23 h');
    expect(at(DAY)).toBe('Visto ayer');
    expect(at(47 * HOUR)).toBe('Visto ayer');
    expect(at(2 * DAY)).toBe('Visto hace 2 días');
    expect(at(30 * DAY)).toBe('Visto hace 30 días');
    expect(at(40 * DAY)).toBe(`Visto el ${dateOf(NOW - 40 * DAY)}`);
  });

  it('never says "in the future" when the clocks disagree', () => {
    expect(seenAgoLabel(NOW + 5 * MIN, NOW, es.status, dateOf)).toBe('Visto hace un momento');
  });

  it('speaks English too', () => {
    expect(at(2 * DAY, en.status)).toBe('Read 2 days ago');
    expect(at(DAY, en.status)).toBe('Read yesterday');
  });
});

describe('playbookStatus', () => {
  const tz = 'America/Bogota';
  it('"New" wins, with when it came out: the weekday within a week, the date before', () => {
    const monday = Date.UTC(2026, 11, 7, 5); // Monday 7 Dec, 00:00 in Bogota
    expect(playbookStatus({ isNew: true, lastSeenAt: null, publishedAt: monday }, NOW, es.status, 'es', tz)).toEqual({
      kind: 'new',
      label: 'Nuevo',
      detail: 'Publicado el lunes',
    });
    expect(publishedLabel(monday - 10 * DAY, NOW, es.status, 'es', tz)).toBe('Publicado el 27 nov');
    expect(publishedLabel(monday, NOW, en.status, 'en', tz)).toBe('Published Monday');
  });

  it('reads as seen, or not seen yet', () => {
    expect(playbookStatus({ isNew: false, lastSeenAt: NOW - 3 * DAY, publishedAt: 0 }, NOW, es.status, 'es', tz)).toEqual({
      kind: 'seen',
      label: 'Visto hace 3 días',
    });
    expect(playbookStatus({ isNew: false, lastSeenAt: null, publishedAt: 0 }, NOW, es.status, 'es', tz)).toEqual({
      kind: 'unseen',
      label: 'No visto',
    });
  });
});

describe('newSinceLabel', () => {
  it('counts the new ones, and says nothing without any', () => {
    expect(newSinceLabel(0, es)).toBeNull();
    expect(newSinceLabel(1, es)).toBe('1 nuevo desde tu última visita');
    expect(newSinceLabel(3, es)).toBe('3 nuevos desde tu última visita');
    expect(newSinceLabel(3, en)).toBe('3 new since your last visit');
  });
});

describe('reader helpers', () => {
  it('reads 200 words a minute, at least one', () => {
    expect(readingMinutes('')).toBe(1);
    expect(readingMinutes(Array(401).fill('palabra').join(' '))).toBe(3);
    expect(readingMinutes('## Título\n\n- **uno** dos')).toBe(1);
  });

  it('anchors a heading in plain ASCII', () => {
    expect(headingId('Método 1: la fórmula para cobrar más')).toBe('metodo-1-la-formula-para-cobrar-mas');
    expect(headingId('Hazlo con dForms')).toBe('hazlo-con-dforms');
    expect(headingId('¿?')).toBe('seccion');
  });

  it('suggests the next playbook of the same tab, wrapping round, else the next one', () => {
    const cards = [card('a', 'ventas'), card('b', 'ads'), card('c', 'ventas'), card('d', 'agentes')];
    expect(nextPlaybook(cards, 'a')?.slug).toBe('c');
    expect(nextPlaybook(cards, 'c')?.slug).toBe('a');
    expect(nextPlaybook(cards, 'b')?.slug).toBe('c');
    expect(nextPlaybook(cards, 'x')).toBeNull();
    expect(nextPlaybook([card('a', 'ventas')], 'a')).toBeNull();
  });

  it('accepts only slugs the catalog could hold', () => {
    expect(isPlaybookSlug('manual-del-vendedor')).toBe(true);
    for (const bad of ['', 'Manual', '../x', 'a--b', 'a b', '-a', 'a/b', 42]) expect(isPlaybookSlug(bad)).toBe(false);
  });
});
