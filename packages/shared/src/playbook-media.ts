/**
 * The inline media of a playbook body: a looping animation or a still image,
 * each placed by a line of its own that is an HTML comment, so any markdown
 * reader that does not know it simply skips it:
 *
 *   <!-- anim: <slug>/<name> | <alt> -->
 *   <!-- img: <slug>/<name> | <alt> -->
 *
 * `slug` is the playbook's own slug and `name` names the asset; both are
 * `[a-z0-9-]+`. Everything after the first `|` is the alt text, so the alt
 * may hold a `|` of its own. It is required, and may not hold `<!--` or
 * `-->`. The files live in the web app under
 * `/playbooks/inline/<locale>/<slug>/`, one folder per language (an
 * animation with words on it is translated too): `<name>.webm`, `<name>.mp4`
 * and `<name>-poster.webp` for an animation, `<name>.webp` for an image. The
 * marker names no language: the playbook's own language picks the folder,
 * and every language of a playbook names the same assets in the same order.
 *
 * Exported from the package root and kept free of the catalog, so the web
 * app's renderer can read a marker without pulling the bodies into a bundle.
 * `scripts/playbooks.mjs` validates the markers with the same grammar (it
 * cannot import this file); `src/playbook-media.spec.ts` holds the two together.
 */

export const PLAYBOOK_MEDIA_KINDS = ['anim', 'img'] as const;
export type PlaybookMediaKind = (typeof PLAYBOOK_MEDIA_KINDS)[number];

/** One inline marker, read. */
export interface PlaybookMedia {
  kind: PlaybookMediaKind;
  slug: string;
  name: string;
  alt: string;
}

/** Where the inline assets are served from in the web app. */
export const PLAYBOOK_MEDIA_BASE = '/playbooks/inline';

const MARKER = /^<!--\s*(anim|img):\s*([a-z0-9-]+)\/([a-z0-9-]+)\s*\|\s*(.*?)\s*-->$/;

/** A line that means to be an inline media marker, valid or not. */
export const PLAYBOOK_MEDIA_HINT = /<!--\s*(?:anim|img)\b/;

/**
 * The marker on this line, or null when the line is not exactly one valid
 * marker (surrounding whitespace aside).
 */
export function parsePlaybookMediaMarker(line: string): PlaybookMedia | null {
  const m = MARKER.exec(line.trim());
  if (!m) return null;
  const alt = m[4]!;
  if (alt === '' || alt.includes('-->') || alt.includes('<!--')) return null;
  return { kind: m[1] as PlaybookMediaKind, slug: m[2]!, name: m[3]!, alt };
}

/** The marker line for this media: the inverse of `parsePlaybookMediaMarker`. */
export function playbookMediaMarker(media: PlaybookMedia): string {
  return `<!-- ${media.kind}: ${media.slug}/${media.name} | ${media.alt} -->`;
}

/**
 * The files one marker needs in one language, relative to
 * `PLAYBOOK_MEDIA_BASE` (`<locale>/<slug>/<name>...`): the webm, the mp4 and
 * the poster of an animation, the webp of an image. `locale` is a playbook
 * language (`PLAYBOOK_LOCALES`); it is a plain string here so this file stays
 * free of the catalog.
 */
export function playbookMediaFiles(media: Pick<PlaybookMedia, 'kind' | 'slug' | 'name'>, locale: string): string[] {
  const stem = `${locale}/${media.slug}/${media.name}`;
  return media.kind === 'anim' ? [`${stem}.webm`, `${stem}.mp4`, `${stem}-poster.webp`] : [`${stem}.webp`];
}

/** The still that sizes a marker's frame in one language: the poster of an animation, the image itself. */
export function playbookMediaStill(media: Pick<PlaybookMedia, 'kind' | 'slug' | 'name'>, locale: string): string {
  const stem = `${locale}/${media.slug}/${media.name}`;
  return media.kind === 'anim' ? `${stem}-poster.webp` : `${stem}.webp`;
}

/**
 * Every valid marker of a markdown text, in order, skipping fenced code
 * blocks (a marker shown as code is code).
 */
export function playbookMediaIn(markdown: string): PlaybookMedia[] {
  const out: PlaybookMedia[] = [];
  let inCode = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    else if (!inCode) {
      const media = parsePlaybookMediaMarker(line);
      if (media) out.push(media);
    }
  }
  return out;
}

/** The text with its HTML comments (inline media markers included) taken out. */
export function stripHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, ' ');
}
