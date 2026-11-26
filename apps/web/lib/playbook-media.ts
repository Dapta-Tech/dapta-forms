/**
 * Where the reader finds an inline animation or image of a playbook, and how
 * big its still is. The marker grammar and the file names live in
 * `@quill/shared` (`playbook-media.ts`); the files are served from
 * `public/playbooks/inline/`, and their sizes come from
 * `playbook-media.generated.ts` (`scripts/playbook-media.mjs`).
 */
import { PLAYBOOK_MEDIA_BASE, playbookMediaFiles, playbookMediaStill, type PlaybookMedia } from '@quill/shared';
import { PLAYBOOK_MEDIA_SIZES } from './playbook-media.generated';

type MediaRef = Pick<PlaybookMedia, 'kind' | 'slug' | 'name'>;

/** The URLs of a marker: the webm, the mp4 and the poster of a loop, the webp of an image (as `still`). */
export function playbookMediaUrls(media: MediaRef): { still: string; webm: string | null; mp4: string | null } {
  const served = (file: string) => `${PLAYBOOK_MEDIA_BASE}/${file}`;
  if (media.kind === 'img') return { still: served(playbookMediaStill(media)), webm: null, mp4: null };
  const [webm, mp4] = playbookMediaFiles(media);
  return { still: served(playbookMediaStill(media)), webm: served(webm!), mp4: served(mp4!) };
}

/** The pixel size of a marker's still, or null when the manifest does not know it. */
export function playbookMediaSize(
  media: MediaRef,
  sizes: Readonly<Record<string, { width: number; height: number }>> = PLAYBOOK_MEDIA_SIZES,
): { width: number; height: number } | null {
  return sizes[playbookMediaStill(media)] ?? null;
}
