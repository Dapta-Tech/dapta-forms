/**
 * The playbooks gallery's view logic: which tab is selected, what a card's
 * state line says, how long a playbook takes to read, and where its sections
 * are. What a person has seen, and what is "New", is decided by the API
 * (`GET /v1/me/playbooks`); this only words it.
 *
 * The categories are listed here instead of imported from
 * `@quill/shared/playbooks`: that subpath carries every playbook's body, and
 * these helpers run in client components. The type import keeps the two lists
 * in step at compile time.
 */
import type { FormsMessages } from '@quill/shared';
import { t } from '@quill/shared';
import type { PlaybookCategory } from '@quill/shared/playbooks';

type PlaybooksMessages = FormsMessages['admin']['playbooks'];

/** The catalog's categories, in tab order (`PLAYBOOK_CATEGORIES`). */
export const PLAYBOOK_TAB_CATEGORIES = ['ventas', 'marketing', 'ads', 'agentes'] as const satisfies readonly PlaybookCategory[];

/** The gallery's tabs: "All" first, then one per category. */
export const PLAYBOOK_TABS = ['all', ...PLAYBOOK_TAB_CATEGORIES] as const;
export type PlaybookTab = (typeof PLAYBOOK_TABS)[number];

/** The query parameter that keeps the selected tab across a reload. */
export const PLAYBOOK_TAB_PARAM = 'category';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A slug the catalog could hold (lowercase words joined by hyphens). */
export function isPlaybookSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 120 && SLUG.test(value);
}

/**
 * The tabs to show: "All", then the categories that have at least one
 * published playbook (`categories` of the list), in tab order. A category the
 * build does not know is left out; its cards still show under "All".
 */
export function visibleTabs(categories: readonly string[]): PlaybookTab[] {
  const present = new Set(categories);
  return ['all', ...PLAYBOOK_TAB_CATEGORIES.filter((c) => present.has(c))];
}

/**
 * The tab a URL asks for (`?category=ventas`), or "All" when it names none,
 * an unknown one, or one with nothing published (an old link to an emptied
 * tab must not open on an empty page).
 */
export function tabFromParam(value: string | string[] | null | undefined, tabs: readonly PlaybookTab[]): PlaybookTab {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return 'all';
  return (tabs as readonly string[]).includes(raw) ? (raw as PlaybookTab) : 'all';
}

/** The cards one tab shows, in the order the API sent them. */
export function cardsForTab<T extends { category: string }>(cards: readonly T[], tab: PlaybookTab): T[] {
  return tab === 'all' ? [...cards] : cards.filter((c) => c.category === tab);
}

/** How many cards each tab holds, for the count beside its name. */
export function tabCounts(cards: readonly { category: string }[]): Record<PlaybookTab, number> {
  const counts = Object.fromEntries(PLAYBOOK_TABS.map((tab) => [tab, 0])) as Record<PlaybookTab, number>;
  for (const c of cards) {
    counts.all += 1;
    if ((PLAYBOOK_TAB_CATEGORIES as readonly string[]).includes(c.category)) counts[c.category as PlaybookCategory] += 1;
  }
  return counts;
}

/** The label of a category, or of "All"; an unknown category reads as its key. */
export function categoryLabel(category: string, m: PlaybooksMessages): string {
  return (m.categories as Record<string, string>)[category] ?? category;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "Read 2 days ago": how long ago the person last opened a playbook. Elapsed
 * time, not calendar days: under a minute "just now", then minutes, hours,
 * "yesterday" from 24 to 48 hours, days up to 30, and past that the date.
 */
export function seenAgoLabel(
  lastSeenAt: number,
  now: number,
  m: PlaybooksMessages['status'],
  formatDate: (ms: number) => string,
): string {
  const elapsed = Math.max(0, now - lastSeenAt);
  if (elapsed < MINUTE) return m.seenJustNow;
  if (elapsed < HOUR) return t(m.seenMinutes, { count: Math.floor(elapsed / MINUTE) });
  if (elapsed < DAY) return t(m.seenHours, { count: Math.floor(elapsed / HOUR) });
  if (elapsed < 2 * DAY) return m.seenYesterday;
  if (elapsed < 31 * DAY) return t(m.seenDays, { count: Math.floor(elapsed / DAY) });
  return t(m.seenOn, { date: formatDate(lastSeenAt) });
}

/**
 * When a playbook came out, for the line beside "New": the weekday within the
 * last week ("Published Monday"), the date before that ("Published Dec 1").
 */
export function publishedLabel(
  publishedAt: number,
  now: number,
  m: PlaybooksMessages['status'],
  locale: string,
  timeZone?: string,
): string {
  const recent = now - publishedAt < 7 * DAY;
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    ...(recent ? { weekday: 'long' as const } : { day: 'numeric' as const, month: 'short' as const }),
  }).format(publishedAt);
  return t(m.publishedOn, { date });
}

/** A card's state: "New" (with its publication), read some time ago, or not read yet. */
export type PlaybookStatus =
  | { kind: 'new'; label: string; detail: string }
  | { kind: 'seen'; label: string }
  | { kind: 'unseen'; label: string };

export function playbookStatus(
  card: { isNew: boolean; lastSeenAt: number | null; publishedAt: number },
  now: number,
  m: PlaybooksMessages['status'],
  locale: string,
  timeZone?: string,
): PlaybookStatus {
  if (card.isNew) return { kind: 'new', label: m.new, detail: publishedLabel(card.publishedAt, now, m, locale, timeZone) };
  if (card.lastSeenAt !== null) {
    const formatDate = (ms: number) =>
      new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(ms);
    return { kind: 'seen', label: seenAgoLabel(card.lastSeenAt, now, m, formatDate) };
  }
  return { kind: 'unseen', label: m.unseen };
}

/** The pill beside the title: "3 new since your last visit", or null with none. */
export function newSinceLabel(newCount: number, m: PlaybooksMessages): string | null {
  if (newCount <= 0) return null;
  return newCount === 1 ? m.newSinceOne : t(m.newSinceOther, { count: newCount });
}

/** Minutes to read a markdown text at 200 words a minute, at least one. */
export function readingMinutes(markdown: string): number {
  const words = markdown.replace(/[#>*`|_-]+/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

/** The anchor of a heading: lowercase ASCII words joined by hyphens ("Método 1: el precio" → "metodo-1-el-precio"). */
export function headingId(text: string): string {
  const id = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || 'seccion';
}

/**
 * The playbook to suggest after this one: the next of the same category in
 * gallery order (wrapping round), else the next of any category, else none.
 */
export function nextPlaybook<T extends { slug: string; category: string }>(cards: readonly T[], slug: string): T | null {
  const i = cards.findIndex((c) => c.slug === slug);
  if (i < 0) return null;
  const rotated = [...cards.slice(i + 1), ...cards.slice(0, i)];
  return rotated.find((c) => c.category === cards[i]!.category) ?? rotated[0] ?? null;
}
