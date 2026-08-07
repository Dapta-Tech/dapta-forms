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

/**
 * The anchor for a step, or null when this screen does not have one.
 *
 * "Does not have one" is a real, ordinary state, not a bug to retry through.
 * `data-tour="edit"` sits on the question spine, which is `hidden lg:block` AND
 * inside the editor's `hasQuestions` branch — so it is absent below 1024px and
 * absent for the `blank` template, which starts with no questions. A hidden
 * element is still found by `querySelector` and still returns a rect, all zeros,
 * so the presence check has to be the SIZE.
 */
function anchorFor(step: TourStep): Element | null {
  const el = document.querySelector(`[data-tour="${step}"]`);
  const r = el?.getBoundingClientRect();
  return el && r && (r.width > 0 || r.height > 0) ? el : null;
}

/** ~2s at 60fps — long enough for the editor to stream in, short enough not to hang. */
const PROBE_FRAMES = 120;

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

/**
 * Do two placements describe the same pixels?
 *
 * `place()` builds a new object every call, so identity says nothing. Comparing
 * the numbers is what lets a scroll that did not actually move the anchor —
 * most of them, since the builder's panels scroll independently — cost nothing:
 * no state write, no render, and no dependent effect re-running.
 */
function samePlacement(a: Placement | null, b: Placement): boolean {
  return (
    a != null &&
    a.top === b.top &&
    a.left === b.left &&
    a.anchor.top === b.anchor.top &&
    a.anchor.left === b.anchor.left &&
    a.anchor.width === b.anchor.width &&
    a.anchor.height === b.anchor.height
  );
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
  /**
   * The steps this screen can actually show, resolved ONCE before the tour
   * starts. Null while still probing.
   *
   * Deciding up front is what makes the count honest. Walking `STEPS` blind
   * meant a step whose anchor never appears still emitted its `tour_step` event
   * and still counted toward "of 3", so a `blank` template on a laptop reported
   * a three-step tour, showed two, and logged a view of a card that never
   * rendered. The irony was that `blank` is the template most in need of the
   * tour and the one guaranteed to lose its first step.
   */
  const [steps, setSteps] = useState<readonly TourStep[] | null>(null);
  const step: TourStep | undefined = steps?.[index];
  const total = steps?.length ?? 0;
  /**
   * Which step the tour was on when it ended.
   *
   * A completed tour walks `index` one PAST the last step, which is how the
   * finish effect below knows it is over — so `step` is undefined by then.
   * Reporting `last_step: null` for every successful tour would make the one
   * number that says how far people get unreadable, so fall back to the final
   * step: "finished on publish", not "finished on nothing".
   */
  const reachedStep: TourStep | null = step ?? steps?.[steps.length - 1] ?? null;

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
      captureEvent('onboarding_tour_finished', { reason, last_step: reachedStep });
      clearParam();
    },
    [clearParam, reachedStep],
  );

  const advance = useCallback(() => setIndex((i) => i + 1), []);

  /**
   * Which steps this screen has anchors for. Runs once, before the first card.
   *
   * Bounded, and it stops early once all three have appeared: the editor streams
   * in, so an anchor missing on frame one is normal, but an anchor missing at
   * the end of the budget is genuinely not on this screen and no amount of
   * waiting will conjure it.
   */
  useEffect(() => {
    if (!armed || done || steps) return;
    let frame = 0;
    let tries = 0;
    const probe = () => {
      const found = STEPS.filter((s) => anchorFor(s) !== null);
      if (found.length === STEPS.length || tries++ >= PROBE_FRAMES) {
        setSteps(found);
        return;
      }
      frame = requestAnimationFrame(probe);
    };
    probe();
    return () => cancelAnimationFrame(frame);
  }, [armed, done, steps]);

  /**
   * Past the last step — or with no steps at all — the tour is over.
   *
   * An effect rather than a branch inside the `setIndex` updater: updaters must
   * be pure, and StrictMode invokes them twice in development, which fired
   * `tour_finished` twice for every completed tour.
   */
  useEffect(() => {
    if (!armed || done || !steps) return;
    if (index >= steps.length) finish(steps.length === 0 ? 'dismissed' : 'completed');
  }, [armed, done, steps, index, finish]);

  /**
   * Measure the anchor. `useLayoutEffect` so the card is positioned before paint
   * — with a plain effect it flashes at the top-left corner for one frame.
   *
   * The anchor is known to exist by now (the probe above only keeps steps whose
   * anchor rendered), so this places rather than retries.
   */
  useLayoutEffect(() => {
    if (!armed || done || !step) return;
    const el = anchorFor(step);
    setPlacement(el ? place(el, cardHeight) : null);
  }, [armed, done, step, cardHeight]);

  /**
   * Keep the card glued to its anchor while the page moves under it.
   *
   * Registered with `capture: true`, so this fires for scrolls inside EVERY
   * nested scroller in the builder — the question spine, the properties panel,
   * the preview — not only the window. That volume is why both guards matter:
   *
   *  - One `requestAnimationFrame` per frame, coalesced. Unthrottled, each
   *    event cost two forced reflows plus a React render, on the heaviest page
   *    in the app.
   *  - `setPlacement` only when the numbers actually changed. `place()` returns
   *    a fresh object literal every call, so an unconditional set handed every
   *    dependent effect a new identity on every scroll event — and one of those
   *    effects moves focus to the card. The symptom was the caret jumping out of
   *    a question input the moment the person scrolled, over and over, for the
   *    whole tour.
   */
  useEffect(() => {
    if (!armed || done || !step) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const el = anchorFor(step);
      // A resize can HIDE the anchor (dragging the window below the lg
      // breakpoint). Re-placing against a 0×0 rect would snap the ring to the
      // corner, so hold the last good position instead.
      if (!el) return;
      const next = place(el, cardHeight);
      setPlacement((prev) => (samePlacement(prev, next) ? prev : next));
    };
    const reposition = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [armed, done, step, cardHeight]);

  /**
   * One `tour_step` event per step ARRIVAL, and only for a step that RENDERED.
   *
   * Gated on `placement` because the count and the events have to agree: a step
   * with no resolved anchor draws nothing, so reporting a view of it would put
   * impressions in the funnel for a card nobody saw.
   */
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!armed || done || !step || !placement || seen.current.has(step)) return;
    seen.current.add(step);
    captureEvent('onboarding_tour_step', { tour_step: step, step_index: index, total_steps: total });
  }, [armed, done, step, placement, index, total]);

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

  /**
   * Move focus to the card so a keyboard user is not left behind it.
   *
   * Keyed on the STEP, not on `placement`. The card only needs focus once per
   * step, and depending on the placement object meant re-focusing on every
   * scroll-driven reposition — stealing the caret out of whatever the person was
   * typing in, which the tour's `pointer-events: none` explicitly invites them
   * to keep doing.
   */
  useEffect(() => {
    if (step && !done) cardRef.current?.focus();
  }, [step, done]);

  if (!armed || done || !step || !placement) return null;

  const copy = m[step];
  const last = index === total - 1;

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
        <p className="bt__step">{fill(m.step, { current: index + 1, total })}</p>
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
