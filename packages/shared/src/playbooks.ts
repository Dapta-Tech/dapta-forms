/**
 * Playbooks: the free resources of the in-app gallery and of the landing's
 * resource hub. Each one is a long markdown text with a category, a step done
 * with a dForms template, and a split between the preview (anyone may read
 * it) and the rest (signed-in people only).
 *
 * The catalog lives in code, like the announcements: publishing a playbook is
 * a pull request. Each playbook is a markdown file in `content/playbooks/`
 * (front matter with the fields below, then the body with a `<!-- muro -->`
 * line between the preview and the rest), turned into
 * `playbooks.generated.ts` by `scripts/playbooks.mjs`. What each person has
 * opened lives in the database (`playbook_state`, migration 0035).
 *
 * Imported from `@quill/shared/playbooks`, never from the package root: the
 * bodies are long, and the root is imported by every client bundle of the web
 * app.
 *
 * Framework-free: the API decides what a person gets with these helpers, and
 * the landing's build reads the same entries through `GET /v1/public/playbooks`.
 */
import { PLAYBOOK_SOURCES } from './playbooks.generated';

/** The gallery's tabs, in the order they show. Keep in step with `CATEGORIES` in scripts/playbooks.mjs. */
export const PLAYBOOK_CATEGORIES = ['ventas', 'marketing', 'ads', 'agentes'] as const;
export type PlaybookCategory = (typeof PLAYBOOK_CATEGORIES)[number];

/** One playbook as the markdown file states it. */
export interface PlaybookSource {
  /** Stable and never reused: it is the URL and the key of per-person state. */
  slug: string;
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

/** Every playbook, published or not, in gallery order. */
export const PLAYBOOKS: readonly Playbook[] = sortPlaybooks(PLAYBOOK_SOURCES);

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
