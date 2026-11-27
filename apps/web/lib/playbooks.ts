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
import { stripHtmlComments, t } from '@quill/shared';
import type { PlaybookCategory, PlaybookLocale } from '@quill/shared/playbooks';

type PlaybooksMessages = FormsMessages['admin']['playbooks'];

/** The catalog's categories, in tab order (`PLAYBOOK_CATEGORIES`). */
export const PLAYBOOK_TAB_CATEGORIES = ['ventas', 'marketing', 'ads', 'agentes'] as const satisfies readonly PlaybookCategory[];

/** The gallery's tabs: "All" first, then one per category. */
export const PLAYBOOK_TABS = ['all', ...PLAYBOOK_TAB_CATEGORIES] as const;
export type PlaybookTab = (typeof PLAYBOOK_TABS)[number];

/** The query parameter that keeps the selected tab across a reload. */
export const PLAYBOOK_TAB_PARAM = 'category';

/**
 * The languages a playbook can be read in (`PLAYBOOK_LOCALES`), in the order
 * the toggle shows them. Listed here for the same reason as the categories.
 */
export const PLAYBOOK_CONTENT_LOCALES = ['es', 'en'] as const satisfies readonly PlaybookLocale[];
export type PlaybookContentLocale = (typeof PLAYBOOK_CONTENT_LOCALES)[number];

/**
 * The query parameter with the language of the playbooks (`?lang=en`), so a
 * shared link opens in the language its sender read. It is the resources'
 * language only: the platform keeps its own.
 */
export const PLAYBOOK_LANG_PARAM = 'lang';

/** A playbook language from a query value or a stored one, or null for anything else. */
export function asPlaybookLocale(value: string | string[] | null | undefined): PlaybookContentLocale | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return (PLAYBOOK_CONTENT_LOCALES as readonly string[]).includes(raw ?? '') ? (raw as PlaybookContentLocale) : null;
}

/**
 * The language the playbooks open in: the one in the address when it names
 * one, else the platform's (both platform languages are playbook languages).
 * The choice stored in the browser is read on the client (`readStoredPlaybookLocale`):
 * the server cannot see it.
 */
export function playbookLocaleFor(param: string | string[] | null | undefined, platform: string): PlaybookContentLocale {
  return asPlaybookLocale(param) ?? asPlaybookLocale(platform) ?? 'es';
}

/**
 * Where a person's choice of playbook language is kept in the browser: one
 * key per member, so two people who share a browser keep their own.
 */
export function playbookLangStorageKey(memberId: string): string {
  return `dforms.playbooks.lang.${memberId}`;
}

/** The stored choice, or null when there is none or storage is unavailable (private mode, blocked). */
export function readStoredPlaybookLocale(key: string): PlaybookContentLocale | null {
  try {
    return asPlaybookLocale(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

/** Keep the choice; best effort, a blocked storage only loses it for next time. */
export function storePlaybookLocale(key: string, locale: PlaybookContentLocale): void {
  try {
    window.localStorage.setItem(key, locale);
  } catch {
    /* the language still changes on this page */
  }
}

/**
 * The stored choice a page is about to be asked again in, or null when the
 * language on screen stays: the address named it, nothing is stored, or the
 * stored choice is the one asked for. While there is one, whatever depends on
 * "the language being read" (the record of the open, an automatic download)
 * waits for it.
 */
export function pendingPlaybookLocale(
  langInUrl: boolean,
  storageKey: string,
  requested: PlaybookContentLocale,
): PlaybookContentLocale | null {
  if (langInUrl) return null;
  const stored = readStoredPlaybookLocale(storageKey);
  return stored && stored !== requested ? stored : null;
}

/**
 * The query parameter that asks the reader to start the PDF download on open
 * (`?pdf=1`): what the landing's resource hub adds to its return path.
 */
export const PLAYBOOK_PDF_PARAM = 'pdf';

/**
 * Where the PDF of a playbook in one language is downloaded: a route that asks
 * for a session (`app/api/playbooks/[slug]/pdf`) and answers an attachment.
 * The files are made by `scripts/playbook-pdfs.mjs`.
 */
export function playbookPdfHref(slug: string, locale: string): string {
  return `/api/playbooks/${slug}/pdf?lang=${asPlaybookLocale(locale) ?? 'es'}`;
}

/** The name the downloaded file is saved under: the two languages never overwrite each other. */
export function playbookPdfFileName(slug: string, locale: string): string {
  return `${slug}-${asPlaybookLocale(locale) ?? 'es'}.pdf`;
}

/**
 * `href` without `?pdf=`, keeping its other parameters and its hash, so a
 * reload (or a shared link) never downloads again.
 */
export function withoutPdfParam(href: string): string {
  const [beforeHash, hash] = href.split('#', 2) as [string, string | undefined];
  const [path, query = ''] = beforeHash.split('?', 2) as [string, string | undefined];
  const params = new URLSearchParams(query);
  params.delete(PLAYBOOK_PDF_PARAM);
  const rest = params.toString();
  return `${path}${rest ? `?${rest}` : ''}${hash !== undefined ? `#${hash}` : ''}`;
}

/**
 * `href` with `?lang=` set to `locale`, keeping its other parameters and its
 * hash. `?pdf=` stays last: `?lang=en&pdf=1` is the form the return path
 * accepts (`lib/return-path.ts`).
 */
export function withPlaybookLang(href: string, locale: PlaybookContentLocale): string {
  const [beforeHash, hash] = href.split('#', 2) as [string, string | undefined];
  const [path, query = ''] = beforeHash.split('?', 2) as [string, string | undefined];
  const params = new URLSearchParams(query);
  const pdf = params.get('pdf');
  params.delete('pdf');
  params.set(PLAYBOOK_LANG_PARAM, locale);
  if (pdf !== null) params.set('pdf', pdf);
  return `${path}?${params.toString()}${hash !== undefined ? `#${hash}` : ''}`;
}

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

/**
 * Minutes to read a markdown text at 200 words a minute, at least one. HTML
 * comments (the inline media markers among them) are not read, so they do
 * not count.
 */
export function readingMinutes(markdown: string): number {
  const words = stripHtmlComments(markdown).replace(/[#>*`|_-]+/g, ' ').split(/\s+/).filter(Boolean).length;
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
