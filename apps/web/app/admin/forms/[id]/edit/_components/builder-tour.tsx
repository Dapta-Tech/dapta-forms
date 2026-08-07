'use client';

/**
 * The three coach marks a person sees the first time they land in the builder,
 * straight out of the onboarding wizard.
 *
 * Armed by `?tour=1` on the redirect, never by a cookie or a stored flag. That
 * choice is what makes it un-repeatable without any bookkeeping: the parameter
 * only exists on the one navigation the wizard performs, so reloading the editor
 * later, or bookmarking it, simply does not carry it.
 *
 * Three steps, and every one of them dismissible. A tour that cannot be closed
 * is a modal dialog wearing a costume, and the person it interrupts most is the
 * one who already knows what they are doing.
 *
 * Anchors are looked up as `[data-tour="…"]` rather than passed as refs, so the
 * builder's own tree stays unaware of the tour: adding or moving a step here
 * touches this file and one attribute, never the editor's render path.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getMessages, type Locale } from '@quill/shared';
import { captureEvent } from '@/lib/product-analytics';
import { fill } from '@/lib/onboarding';
import './builder-tour.css';

type TourMessages = ReturnType<typeof getMessages>['admin']['onboarding']['tour'];

/** Anchor attribute value → which copy goes with it, in order. */
const STEPS = ['edit', 'preview', 'publish'] as const;
type TourStep = (typeof STEPS)[number];

interface Placement {
  top: number;
  left: number;
  anchor: { top: number; left: number; width: number; height: number };
}

const CARD_WIDTH = 300;
/** Assumed card height until the real one is measured (see `cardHeight`). */
const CARD_HEIGHT_ESTIMATE = 180;
const GAP = 12;
const MARGIN = 8;
/** An anchor taller than this fraction of the viewport is treated as a REGION. */
const TALL_ANCHOR_RATIO = 0.5;

/**
 * Where the card goes for a given anchor.
 *
 * Two things make this less trivial than "put it underneath":
 *
 *  - Some anchors are REGIONS, not controls. The builder's question spine runs
 *    the full height of the page, so its bottom edge sits below the fold and a
 *    card placed against it would render off-screen entirely — which is exactly
 *    what happened before this handled the case. A tall anchor is measured from
 *    its TOP instead, next to the part of it the person can actually see.
 *  - The publish button is in the top-RIGHT corner, so a card centred on it
 *    overflows the right edge.
 *
 * Both are covered by the same final clamp: whatever the preferred position, the
 * card is pushed back inside the viewport on both axes before it is returned. A
 * coach mark that cannot be read is worse than no coach mark.
 */
function place(el: Element, cardHeight: number): Placement {
  const r = el.getBoundingClientRect();
  const anchor = { top: r.top, left: r.left, width: r.width, height: r.height };
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const tall = r.height > vh * TALL_ANCHOR_RATIO;

  // For a region, hang the card off the top of the visible part; for a control,
  // off its actual bottom edge.
  const belowY = (tall ? Math.max(r.top, 0) + Math.min(r.height, 96) : r.bottom) + GAP;
  const aboveY = r.top - GAP - cardHeight;
  const preferred = belowY + cardHeight + MARGIN <= vh || aboveY < MARGIN ? belowY : aboveY;

  return {
    top: Math.max(MARGIN, Math.min(preferred, vh - cardHeight - MARGIN)),
    left: Math.max(
      MARGIN,
      Math.min(r.left + r.width / 2 - CARD_WIDTH / 2, vw - CARD_WIDTH - MARGIN),
    ),
    anchor,
  };
}

export function BuilderTour({ locale }: { locale: Locale }) {
  const router = useRouter();
  const params = useSearchParams();
  const armed = params.get('tour') === '1';

  const m: TourMessages = getMessages(locale).admin.onboarding.tour;
  const [index, setIndex] = useState(0);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [done, setDone] = useState(false);
  // The real card height, once it has rendered. Copy length differs per step,
  // so a fixed estimate mis-places the tallest one against the bottom edge.
  const [cardHeight, setCardHeight] = useState(CARD_HEIGHT_ESTIMATE);
  const cardRef = useRef<HTMLDivElement>(null);
  const step: TourStep | undefined = STEPS[index];

  /**
   * Drop `?tour=1` from the URL once the tour is over.
   *
   * `replace` rather than `push` so the browser's Back button does not walk the
   * person back into a tour they just finished. Running it on finish rather than
   * on mount is what lets a mid-tour refresh resume rather than silently cancel.
   */
  const clearParam = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete('tour');
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
  }, [params, router]);

  const finish = useCallback(
    (reason: 'completed' | 'dismissed') => {
      setDone(true);
      captureEvent('onboarding_tour_finished', { reason, last_step: step ?? null });
      clearParam();
    },
    [clearParam, step],
  );

  const advance = useCallback(() => {
    setIndex((i) => {
      const next = i + 1;
      if (next >= STEPS.length) {
        // Deferred: calling `finish` inside the updater would set state during
        // another component's render phase.
        queueMicrotask(() => finish('completed'));
        return i;
      }
      return next;
    });
  }, [finish]);

  /**
   * Measure the anchor. `useLayoutEffect` so the card is positioned before paint
   * — with a plain effect it flashes at the top-left corner for one frame.
   *
   * Two ways an anchor is unusable, and they need opposite handling:
   *
   *  - NOT THERE YET. The editor streams in, so the element can be missing for a
   *    few frames. Retry, bounded — an unbounded rAF loop would spin forever on
   *    a step whose anchor was renamed.
   *  - THERE BUT HIDDEN. The question spine is `hidden lg:block`, so below
   *    1024px it is in the DOM with a 0×0 rect. `querySelector` finds it and
   *    `getBoundingClientRect()` returns all zeros, which used to draw the ring
   *    around nothing in the top-left corner. Retrying cannot help — the anchor
   *    is genuinely not on this screen — so the step is SKIPPED.
   */
  useLayoutEffect(() => {
    if (!armed || done || !step) return;
    let frame = 0;
    let tries = 0;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${step}"]`);
      const rect = el?.getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) {
        setPlacement(place(el as Element, cardHeight));
        return;
      }
      // ~2s at 60fps. Past that, either the anchor does not exist or this
      // viewport does not render it; move on rather than sit on a blank step.
      if (tries++ < 120) {
        frame = requestAnimationFrame(measure);
        return;
      }
      setPlacement(null);
      advance();
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [armed, done, step, cardHeight, advance]);

  /** Keep the card glued to its anchor while the page moves under it. */
  useEffect(() => {
    if (!armed || done || !step) return;
    const reposition = () => {
      const el = document.querySelector(`[data-tour="${step}"]`);
      const rect = el?.getBoundingClientRect();
      // Same visibility guard: a resize can HIDE the anchor (dragging a window
      // below the lg breakpoint), and re-placing against a 0×0 rect would snap
      // the ring to the corner mid-tour.
      if (el && rect && (rect.width > 0 || rect.height > 0)) {
        setPlacement(place(el, cardHeight));
      }
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [armed, done, step, cardHeight]);

  /** One `tour_step` event per step ARRIVAL, not per reposition. */
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!armed || done || !step || seen.current.has(step)) return;
    seen.current.add(step);
    captureEvent('onboarding_tour_step', { tour_step: step, step_index: index });
  }, [armed, done, step, index]);

  /** Escape closes it. The most direct way out should not need a mouse. */
  useEffect(() => {
    if (!armed || done) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish('dismissed');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed, done, finish]);

  /**
   * Measure the rendered card and re-place if the estimate was off. Guarded on a
   * real difference so this cannot loop: `setCardHeight` re-runs placement, which
   * re-runs this, which finds the height unchanged and stops.
   */
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardHeight) > 1) setCardHeight(h);
  }, [cardHeight, placement, step]);

  /** Move focus to the card so a keyboard user is not left behind it. */
  useEffect(() => {
    if (placement && !done) cardRef.current?.focus();
  }, [placement, done]);

  if (!armed || done || !step || !placement) return null;

  const copy = m[step];
  const last = index === STEPS.length - 1;

  return (
    <div className="bt" role="presentation">
      {/* A ring around the anchor rather than a full-screen scrim: the point is
          to point AT something, and dimming the whole builder hides the thing
          the copy is talking about. `pointer-events: none` keeps the app usable
          underneath, so someone can act on the tip while reading it. */}
      <div
        className="bt__ring"
        style={{
          top: placement.anchor.top - 4,
          left: placement.anchor.left - 4,
          width: placement.anchor.width + 8,
          height: placement.anchor.height + 8,
        }}
      />
      <div
        ref={cardRef}
        className="bt__card"
        role="dialog"
        aria-modal="false"
        aria-labelledby="bt-title"
        tabIndex={-1}
        // `top` is already the card's absolute position — no transform. An
        // earlier translateY(-100%) for the "above" case shifted it a second
        // time and put the card outside the viewport.
        style={{ top: placement.top, left: placement.left, width: CARD_WIDTH }}
      >
        <p className="bt__step">{fill(m.step, { current: index + 1, total: STEPS.length })}</p>
        <h2 className="bt__title" id="bt-title">
          {copy.title}
        </h2>
        <p className="bt__body">{copy.body}</p>
        <div className="bt__actions">
          <button type="button" className="bt__dismiss" onClick={() => finish('dismissed')}>
            {m.dismiss}
          </button>
          <button type="button" className="bt__next" onClick={advance}>
            {last ? m.done : m.next}
          </button>
        </div>
      </div>
    </div>
  );
}
