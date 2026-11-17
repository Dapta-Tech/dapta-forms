/**
 * Where the Select's menu hangs and how wide it is: the arithmetic, kept apart
 * from the component so it can be tested without a layout engine.
 *
 * The menu is `absolute` under its trigger, so two things can cut it off: the
 * window, and any ancestor that clips (a dialog body, a scroll container, the
 * builder's right rail). The component reads plain numbers off the DOM (the
 * trigger's box, what the options ask for, each ancestor's box and computed
 * style) and everything decided from them is decided here.
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

/** Gutter kept between the menu and whatever would cut it off. */
export const EDGE = 8;

/**
 * One ancestor of the Select's root, as the component reads it off the DOM:
 * two computed style values and the horizontal span of its padding box (the
 * box overflow is clipped to) in viewport coordinates.
 */
export interface AncestorBox {
  /** Computed `position`. */
  position: string;
  /** Computed `overflow-x`. */
  overflowX: string;
  /**
   * A `transform` other than `none`: the element is then the containing block
   * of its `absolute` AND `fixed` descendants, whatever its own `position`.
   */
  transformed?: boolean;
  /** `rect.left + clientLeft`, and that plus `clientWidth`. */
  inner: Span;
}

/**
 * The horizontal band of the viewport in which the menu can be seen: the
 * window, narrowed by every ancestor that clips it. `ancestors` runs from the
 * root's parent outward.
 *
 * Any `overflow-x` other than `visible` clips, and `overflow-y: auto` alone is
 * enough to get one: CSS computes `overflow-x` to `auto` along with it, so the
 * computed value read here already says so.
 *
 * The walk follows the containing-block chain, because that is what decides
 * clipping. A box in normal flow (`static`, `relative`, `sticky`) is clipped by
 * every ancestor. An `absolute` box skips the static ancestors below its
 * containing block. A `fixed` box (a dialog overlay) is laid out against the
 * window and skips everything, unless an ancestor is transformed.
 */
export function visibleBand(viewportWidth: number, ancestors: readonly AncestorBox[], edge = EDGE): Span {
  let left = edge;
  let right = viewportWidth - edge;
  // How the box whose clipping is being followed is positioned. It starts as
  // the Select's root, which is `relative`: in flow.
  let via: 'flow' | 'absolute' | 'fixed' = 'flow';
  for (const node of ancestors) {
    const contains =
      via === 'flow' || !!node.transformed || (via === 'absolute' && node.position !== 'static');
    if (!contains) continue;
    // A box with no width of its own (`display: contents`, an inline wrapper)
    // reports an overflow value it cannot apply; it clips nothing.
    if (node.overflowX !== 'visible' && node.inner.right > node.inner.left) {
      left = Math.max(left, node.inner.left + edge);
      right = Math.min(right, node.inner.right - edge);
    }
    via = node.position === 'fixed' ? 'fixed' : node.position === 'absolute' ? 'absolute' : 'flow';
  }
  return { left, right };
}

/**
 * The whole placement, from what the component measured. `content` is the
 * width the options ask for on their own (capped by CSS, but without the
 * "at least as wide as the trigger" floor): the floor is applied here, from the
 * trigger as it is NOW, so a menu that was only as wide as its trigger follows
 * the trigger when the layout around it changes.
 */
export function placeMenu(
  content: number,
  trigger: Span,
  viewportWidth: number,
  ancestors: readonly AncestorBox[],
): MenuFit {
  const natural = Math.max(content, trigger.right - trigger.left);
  return fitMenu(natural, trigger, visibleBand(viewportWidth, ancestors));
}

/** Same placement: lets a state setter keep the old object and skip a render. */
export function sameFit(a: MenuFit | null, b: MenuFit | null): boolean {
  return a === b || (!!a && !!b && a.side === b.side && Math.abs(a.width - b.width) < 0.01);
}
