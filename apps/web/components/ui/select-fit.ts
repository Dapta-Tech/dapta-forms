/**
 * Where the Select's menu hangs and how wide it is: the arithmetic, kept apart
 * from the component so it can be tested without a layout engine.
 *
 * The menu is `absolute` under its trigger, so two things can cut it off: the
 * window, and any ancestor that clips (a dialog body, a scroll container, the
 * builder's right rail). `bounds` is the horizontal band left visible by all of
 * them, in viewport coordinates.
 */

export interface Span {
  left: number;
  right: number;
}

export interface MenuFit {
  /** `start` hangs from the trigger's left edge and grows right; `end` mirrors it. */
  side: 'start' | 'end';
  /** The menu's width in px, fixed for as long as it stays open. */
  width: number;
}

/** Layout hands back fractions; a hair over the edge is not an overflow. */
const SUBPIXEL = 0.5;

/**
 * Place a menu of `natural` width (what its longest option asks for, already
 * capped by CSS) against its trigger.
 *
 * It keeps the side it has always preferred, `start`, whenever it fits there.
 * It flips to `end` only when it fits THERE: flipping because one side is too
 * small says nothing about the other, and a trigger near the left edge of a
 * phone used to send most of the menu off-screen that way. When neither side
 * holds it, it takes the roomier one and gives up width instead, so the options
 * wrap inside the visible band rather than run out of it.
 */
export function fitMenu(natural: number, trigger: Span, bounds: Span): MenuFit {
  // Under the trigger is always fair game: wherever the trigger shows, a menu
  // of the same span shows too. It also keeps a trigger that sits closer to an
  // edge than the gutter from being read as "no room at all".
  const left = Math.min(bounds.left, trigger.left);
  const right = Math.max(bounds.right, trigger.right);
  const roomStart = right - trigger.left;
  const roomEnd = trigger.right - left;

  if (natural <= roomStart + SUBPIXEL) return { side: 'start', width: natural };
  if (natural <= roomEnd + SUBPIXEL) return { side: 'end', width: natural };
  return roomEnd > roomStart ? { side: 'end', width: roomEnd } : { side: 'start', width: roomStart };
}
