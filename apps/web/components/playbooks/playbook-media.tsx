'use client';

import { useRef } from 'react';
import type { PlaybookMedia } from '@quill/shared';
import { playbookMediaSize, playbookMediaUrls } from '@/lib/playbook-media';
import { useLoopSlot, useReducedMotion } from './loop-video';

/**
 * An inline animation or image of a playbook, where its marker line stood
 * (`<!-- anim: slug/name | alt -->`, `<!-- img: slug/name | alt -->`).
 *
 * An animation is a muted loop (webm, with the mp4 beside it for Safari) over
 * its poster, by the gallery's rules (`loop-video.ts`): it loads nothing
 * before it is needed, plays only on screen, counts toward the page's
 * `MAX_PLAYING`, and with reduced motion is only its poster. An image is a
 * lazy still. Both take the width and height of their still when the
 * manifest knows them, so the text does not move when they load, and the
 * marker's alt as their accessible name. Every URL is built from the marker's
 * `[a-z0-9-]+` tokens, never from free text.
 */
export function PlaybookMediaView({ media }: { media: PlaybookMedia }) {
  const ref = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const urls = playbookMediaUrls(media);
  const size = playbookMediaSize(media);
  const showVideo = media.kind === 'anim' && !reduced;
  useLoopSlot(ref, showVideo);

  const box = size ? { width: size.width, height: size.height } : {};
  const fill = 'block h-auto w-full';
  return (
    <figure
      data-testid="playbook-media"
      data-kind={media.kind}
      className="mt-6 overflow-hidden rounded-xl border border-border bg-panel first:mt-0"
    >
      {showVideo ? (
        <video
          ref={ref}
          muted
          loop
          playsInline
          preload="none"
          poster={urls.still}
          aria-label={media.alt}
          {...box}
          className={fill}
        >
          <source src={urls.webm!} type="video/webm" />
          <source src={urls.mp4!} type="video/mp4" />
        </video>
      ) : (
        <img src={urls.still} alt={media.alt} loading="lazy" decoding="async" {...box} className={fill} />
      )}
    </figure>
  );
}
