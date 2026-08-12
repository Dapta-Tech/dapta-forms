import type { SVGProps } from 'react';

/**
 * The PARENT company's mark — Dapta's `d`, not the product's `F`.
 *
 * Kept in its own file, away from `forms-logo.tsx`, for the reason that file
 * states in its own header: the parent mark is never redrawn. The geometry below
 * is the shipped brand artwork ("Dapta D", 279×298) copied path-for-path; no
 * point was moved, rounded, or re-exported through a tracer.
 *
 * Two paths, and they are not interchangeable:
 *  - the **`d` bowl**, drawn in `currentColor` so it inherits whatever text
 *    colour it sits in and follows dark/light with no second asset. This is the
 *    role the official files call "Dark" (`#1A1A1C`) on a light ground and
 *    "Light" (`#EFEFEF`) on a dark one — one token replaces both.
 *  - the **lime tick**, literal. It is the one constant across every official
 *    variant except the flat single-colour ones, and it is what makes the mark
 *    read as Dapta's rather than as a generic lowercase d.
 *
 * The viewBox is CROPPED to the artwork (the source file pads it to 279×298).
 * A mark sized by CSS height must put its ink in that height — padding baked
 * into the viewBox would render a 16px `d` at about 8px of visible glyph. The
 * brand's clear space is supplied by the layout instead (`gap` on the badge).
 */

/**
 * Dapta's lime, taken from the parent artwork. It is a hair off `forms-logo.tsx`'s
 * `LIME` (`#cae940`) — that value comes from the Forms logotype, this one from
 * the Dapta files, and each stays faithful to its own source. The two marks never
 * appear side by side, so the difference is never visible as an inconsistency.
 */
const DAPTA_LIME = '#cbe84f';

/**
 * Just the `d`. Near-square (~0.98:1) — size it with a height and let width
 * follow, never the other way round.
 */
export function DaptaMark({ title, ...props }: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      /* Ink runs x 60.0684→202.425, y 76.9297→221.953; the box is rounded
         OUTWARD from those, never inward — rounding the origin up by a
         hundredth shaves the tick's left edge. `dapta-logo.spec.tsx` asserts
         both directions. */
      viewBox="60.06 76.92 142.37 145.04"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path
        fill="currentColor"
        d="M144.491 76.9297H115.499L110.071 99.3098H141.586C165.257 99.3098 177.302 112.571 177.302 134.941C177.302 167.053 155.707 199.573 122.067 199.573H87.1699L82.0732 221.953H116.873C170.247 221.953 202.425 179.069 202.425 132.452C202.425 96.1988 179.378 76.9297 144.491 76.9297Z"
      />
      <path
        fill={DAPTA_LIME}
        d="M93.4453 172.547L87.1694 199.574H60.0684L66.3442 172.547H93.4453Z"
      />
    </svg>
  );
}
