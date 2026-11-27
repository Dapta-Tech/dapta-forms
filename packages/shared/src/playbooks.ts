/**
 * Playbooks: the free resources of the in-app gallery and of the landing's
 * resource hub. Each one is a long markdown text with a category, a step done
 * with a dForms template, and a split between the preview (anyone may read
 * it) and the rest (signed-in people only).
 *
 * The catalog lives in code, like the announcements: publishing a playbook is
 * a pull request. Each playbook is a markdown file per language in
 * `content/playbooks/<locale>/` (front matter with the fields below, then the
 * body with a `<!-- muro -->` line between the preview and the rest), turned
 * into `playbooks.generated.ts` by `scripts/playbooks.mjs`. Spanish is the
 * base: every playbook has it, and a language a playbook lacks reads the
 * Spanish one (`localizedPlaybook`). What each person has opened lives in the
 * database (`playbook_state`, migration 0035), by slug: one state for every
 * language of a playbook.
 *
 * Imported from `@quill/shared/playbooks`, never from the package root: the
 * bodies are long, and the root is imported by every client bundle of the web
 * app.
 *
 * Framework-free: the API decides what a person gets with these helpers, and
 * the landing's build reads the same entries through `GET /v1/public/playbooks`.
 */
import { playbookMediaIn, stripHtmlComments, type PlaybookMedia } from './playbook-media';
import { PLAYBOOK_SOURCES } from './playbooks.generated';

/** The languages a playbook is written in. The first is the base, the one every other falls back to. Keep in step with `LOCALES` in scripts/playbooks.mjs. */
export const PLAYBOOK_LOCALES = ['es', 'en'] as const;
export type PlaybookLocale = (typeof PLAYBOOK_LOCALES)[number];
export const PLAYBOOK_BASE_LOCALE: PlaybookLocale = 'es';

export function isPlaybookLocale(value: unknown): value is PlaybookLocale {
  return typeof value === 'string' && (PLAYBOOK_LOCALES as readonly string[]).includes(value);
}

/** The gallery's tabs, in the order they show. Keep in step with `CATEGORIES` in scripts/playbooks.mjs. */
export const PLAYBOOK_CATEGORIES = ['ventas', 'marketing', 'ads', 'agentes'] as const;
export type PlaybookCategory = (typeof PLAYBOOK_CATEGORIES)[number];

/** One playbook as the markdown file states it. */
export interface PlaybookSource {
  /** Stable and never reused: it is the URL and the key of per-person state, the same in every language. */
  slug: string;
  /** The language this text is written in. */
  locale: PlaybookLocale;
  category: PlaybookCategory;
  title: string;
  summary: string;
  /** Epoch ms. Hidden everywhere before it; "New" for whoever last opened the gallery before it. */
  publishedAt: number;
  /**
   * The social accounts whose guide promises this playbook (`ig_homerovende`),
   * as the landing reads them from `utm_source`. A promised playbook opens in
   * full on the landing for whoever comes from that guide, so its whole body
   * is public. Empty for the rest.
   */
  promisedBy: readonly string[];
  /** The step done with a dForms template, in one line. */
  template: string;
  /** A short looping video for the card (a root-relative path or https URL), or null. */
  thumbnailVideo: string | null;
  /** The still shown before the video plays, or instead of it. */
  thumbnailPoster: string | null;
  /** The brief for whoever renders the thumbnail. Never shown. */
  thumbnailMotif: string | null;
  /** Markdown above the marker: the intro and the first section. */
  preview: string;
  /** Markdown below the marker. */
  rest: string;
}

export type Playbook = PlaybookSource;

const CATEGORY_ORDER = new Map<string, number>(PLAYBOOK_CATEGORIES.map((c, i) => [c, i]));

/** Newest first; for the same date, by category tab order, then by slug. */
export function sortPlaybooks(list: readonly Playbook[]): Playbook[] {
  return [...list].sort(
    (a, b) =>
      b.publishedAt - a.publishedAt ||
      (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99) ||
      a.slug.localeCompare(b.slug),
  );
}

/** Every language's playbooks, published or not, each in gallery order. */
export type PlaybookCatalog = Readonly<Record<PlaybookLocale, readonly Playbook[]>>;

export const PLAYBOOK_CATALOG: PlaybookCatalog = {
  es: sortPlaybooks(PLAYBOOK_SOURCES.es),
  en: sortPlaybooks(PLAYBOOK_SOURCES.en),
};

/**
 * Every playbook, published or not, in gallery order, in the base language:
 * the one every slug has. The other languages are in `PLAYBOOK_CATALOG`.
 */
export const PLAYBOOKS: readonly Playbook[] = PLAYBOOK_CATALOG[PLAYBOOK_BASE_LOCALE];

/**
 * A playbook in the language asked for: that version when it exists, else the
 * base one (Spanish), with `fallback` saying so. `locale` is the language of
 * the text served, so `fallback` is `locale !== asked`.
 */
export function localizedPlaybook(
  base: Playbook,
  locale: PlaybookLocale,
  catalog: PlaybookCatalog = PLAYBOOK_CATALOG,
): { playbook: Playbook; fallback: boolean } {
  const own = locale === base.locale ? base : catalog[locale]?.find((p) => p.slug === base.slug);
  return own ? { playbook: own, fallback: false } : { playbook: base, fallback: locale !== base.locale };
}

export function isPlaybookCategory(value: unknown): value is PlaybookCategory {
  return typeof value === 'string' && CATEGORY_ORDER.has(value);
}

export function isPlaybookPublished(p: Playbook, now: number): boolean {
  return now >= p.publishedAt;
}

/** The playbooks published by `now`, in gallery order. */
export function publishedPlaybooks(now: number, list: readonly Playbook[] = PLAYBOOKS): Playbook[] {
  return sortPlaybooks(list.filter((p) => isPlaybookPublished(p, now)));
}

/** The playbook with this slug, published or not, or undefined. */
export function findPlaybook(slug: string, list: readonly Playbook[] = PLAYBOOKS): Playbook | undefined {
  return list.find((p) => p.slug === slug);
}

/** The whole body, preview and rest, without the marker. */
export function playbookBody(p: Playbook): string {
  return `${p.preview}\n\n${p.rest}`;
}

const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * The calendar day of `publishedAt` in Bogota (UTC-5, no daylight saving),
 * as `YYYY-MM-DD`: the time zone the dates are written in.
 */
export function playbookPublishedDate(p: Playbook): string {
  return new Date(p.publishedAt - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The reading speed behind `playbookReadingMinutes`. */
export const PLAYBOOK_WORDS_PER_MINUTE = 200;

/**
 * The `## ` headings of the rest, in order, skipping any inside a fenced code
 * block or an HTML comment (on one line or several, as the reader drops it):
 * what a locked page lists as still to read, without the text itself.
 */
export function playbookOutline(p: Playbook): string[] {
  const out: string[] = [];
  let inCode = false;
  let inComment = false;
  for (const raw of p.rest.split('\n')) {
    let line = raw;
    // Drop the comments this line opens or closes; what follows a close is read again.
    for (;;) {
      if (inComment) {
        const close = line.indexOf('-->');
        if (close < 0) {
          line = '';
          break;
        }
        inComment = false;
        line = line.slice(close + 3);
      } else if (!inCode && /^\s*<!--/.test(line)) {
        inComment = true;
        line = line.slice(line.indexOf('<!--') + 4);
      } else break;
    }
    if (line.startsWith('```')) inCode = !inCode;
    else if (!inCode && line.startsWith('## ')) {
      const title = line.slice(3).trim();
      if (title !== '') out.push(title);
    }
  }
  return out;
}

/**
 * Minutes to read the whole body, preview and rest, at
 * `PLAYBOOK_WORDS_PER_MINUTE`, rounded up and never under 1. A word is a run
 * of letters, digits or underscores, so markdown punctuation does not count,
 * and HTML comments (the `<!-- anim: ... -->` and `<!-- img: ... -->`
 * markers among them) are not read, so they do not count either.
 */
export function playbookReadingMinutes(p: Playbook): number {
  const words = stripHtmlComments(playbookBody(p)).match(/[\p{L}\p{N}_]+/gu)?.length ?? 0;
  return Math.max(1, Math.ceil(words / PLAYBOOK_WORDS_PER_MINUTE));
}

/** The inline animations and images of the whole body, in order (see `playbook-media.ts`). */
export function playbookMedia(p: Playbook): PlaybookMedia[] {
  return playbookMediaIn(playbookBody(p));
}

/** Whether a guide promises this playbook, which makes its whole body public. */
export function isPlaybookPromised(p: Playbook): boolean {
  return p.promisedBy.length > 0;
}

/**
 * "New" for one person: published after their last visit to the gallery (or
 * they never visited it), and not opened since. A playbook someone reached
 * straight from a link is no longer new to them.
 */
export function isPlaybookNew(
  p: Playbook,
  state: { lastSeenAt: number | null; galleryLastSeenAt: number | null },
): boolean {
  if (state.lastSeenAt !== null) return false;
  return state.galleryLastSeenAt === null || p.publishedAt > state.galleryLastSeenAt;
}
