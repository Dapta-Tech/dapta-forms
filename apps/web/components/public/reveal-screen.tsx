'use client';

import { useEffect, useRef, useState } from 'react';
import {
  interpolate,
  resolveRevealPresentation,
  type Answers,
  type FormReveal,
} from '@quill/engine';

/** The interstitial's default play time when the config sets none. */
export const DEFAULT_REVEAL_MS = 2200;

/** Localized fallbacks when the config carries no reveal copy. */
export interface RevealScreenMessages {
  headline: string;
  subtitle: string;
  /** `versus` loader: the two marks' labels when the config names neither. */
  versusYou: string;
  versusMatch: string;
}

/**
 * Resolve what the reveal shows and for how long (pure; unit-tested):
 * configured copy falls back to the localized messages, `subtitleTemplate`
 * wins over `subtitle` with `[key]` tokens interpolated from the answers, and
 * `durationMs` defaults to 2200ms.
 */
export function resolveRevealCopy(
  reveal: FormReveal | null | undefined,
  answers: Answers,
  messages: RevealScreenMessages,
): {
  headline: string;
  subtitle: string;
  durationMs: number;
  versusYou: string;
  versusMatch: string;
} {
  const template = reveal?.subtitleTemplate;
  // Every configured line interpolates. `subtitleTemplate` always did, but the
  // headline and the plain subtitle did not — so "Matching [firstname]…" reached
  // the respondent as literal text on the very screen meant to feel personal.
  // The versus labels join that rule: they are authored copy on the same screen,
  // so "[company]" in one of them has to resolve too.
  return {
    headline: reveal?.headline ? interpolate(reveal.headline, answers) : messages.headline,
    subtitle: template
      ? interpolate(template, answers)
      : reveal?.subtitle
        ? interpolate(reveal.subtitle, answers)
        : messages.subtitle,
    durationMs: reveal?.durationMs ?? DEFAULT_REVEAL_MS,
    versusYou: reveal?.versusYouLabel
      ? interpolate(reveal.versusYouLabel, answers)
      : messages.versusYou,
    versusMatch: reveal?.versusMatchLabel
      ? interpolate(reveal.versusMatchLabel, answers)
      : messages.versusMatch,
  };
}

/**
 * What the `.pf` ROOT needs for this interstitial, spread by the caller.
 *
 * `accentBackground` floods the whole screen, not the content column, so it
 * cannot be a class on `.pf-reveal__inner` — it has to reach the element that
 * owns the page. Returning it from here keeps the decision in one place: the
 * three call sites spread it and never re-derive the rule.
 */
export function revealShellProps(
  reveal: FormReveal | null | undefined,
): { 'data-pf-reveal-bg'?: 'accent' } {
  return resolveRevealPresentation(reveal).accentBackground ? { 'data-pf-reveal-bg': 'accent' } : {};
}

/**
 * The two marks of the `versus` layout — the respondent on one side, whatever
 * they are being matched with on the other, the progress between them.
 *
 * `aria-hidden` on the whole group is deliberate. The interstitial's shell is an
 * `aria-live="polite"` region (it is a status), and the percentage re-renders
 * every 60ms — announcing it would read a new number to a screen-reader user
 * dozens of times for a screen that lasts two seconds and says nothing the
 * headline above has not already said.
 */
function VersusMarks({
  pct,
  youLabel,
  matchLabel,
}: {
  pct: number;
  youLabel: string;
  matchLabel: string;
}) {
  return (
    <div className="pf-reveal__versus" aria-hidden="true">
      <figure className="pf-reveal__mark">
        <div className="pf-reveal__mark-dot pf-reveal__mark-dot--you" />
        <figcaption className="pf-reveal__mark-label">{youLabel}</figcaption>
      </figure>
      <div className="pf-reveal__versus-mid">
        <span className="pf-reveal__pct">{pct}%</span>
        <div className="pf-reveal__track">
          <div className="pf-reveal__fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <figure className="pf-reveal__mark">
        <div className="pf-reveal__mark-dot pf-reveal__mark-dot--match">?</div>
        <figcaption className="pf-reveal__mark-label">{matchLabel}</figcaption>
      </figure>
    </div>
  );
}

/**
 * The reveal/processing interstitial body (pilot "matching loader" parity):
 * plays for `reveal.durationMs` (default 2200ms), renders the configured
 * headline + subtitle — `subtitleTemplate` wins over `subtitle` and gets its
 * `[key]` tokens interpolated from the answers via the engine's `interpolate`,
 * so e.g. "Finding the best advisor for [industry]…" personalizes live.
 *
 * HOW it animates is `reveal.loader` (see `resolveRevealPresentation`), and the
 * order of the parts follows from it: the `spinner` mark sits above the copy the
 * way it always has, while `bar` and `versus` put the copy first and the
 * progress under it. `none` is copy alone — the honest choice when the wait is
 * not really a computation. Every variant runs the SAME timer, so the screen's
 * duration never depends on how it is drawn.
 *
 * Fires `onComplete` exactly once when the bar fills; the caller owns the page
 * chrome (accent vars, banner, `revealShellProps`) and what happens next.
 */
export function RevealScreen({
  reveal,
  answers,
  messages,
  children,
  onComplete,
}: {
  reveal?: FormReveal | null;
  answers: Answers;
  messages: RevealScreenMessages;
  /** Rendered under the interstitial — the "trusted by" marquee, when scoped here. */
  children?: React.ReactNode;
  onComplete?: () => void;
}) {
  const { headline, subtitle, durationMs, versusYou, versusMatch } = resolveRevealCopy(
    reveal,
    answers,
    messages,
  );
  const { loader, loaderSize, textSize } = resolveRevealPresentation(reveal);

  const [pct, setPct] = useState(4);
  const completedRef = useRef(false);
  // Latest callback via a ref so the timer arms once per mount/duration — a
  // re-rendered parent closure never re-starts the bar.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      const p = Math.min(100, Math.round(((Date.now() - startedAt) / durationMs) * 100));
      setPct(p);
      if (p >= 100) {
        window.clearInterval(id);
        if (!completedRef.current) {
          completedRef.current = true;
          onCompleteRef.current?.();
        }
      }
    }, 60);
    return () => window.clearInterval(id);
  }, [durationMs]);

  return (
    <div
      className="pf-reveal__inner"
      data-pf-reveal-loader={loader}
      data-pf-reveal-mark={loaderSize}
      data-pf-reveal-text={textSize}
    >
      {loader === 'spinner' ? <div className="pf-reveal__spinner" aria-hidden="true" /> : null}
      <h1 className="pf-reveal__headline">{headline}</h1>
      <p className="pf-reveal__subtitle">{subtitle}</p>
      {loader === 'spinner' || loader === 'bar' ? (
        <div className="pf-reveal__track" aria-hidden="true">
          <div className="pf-reveal__fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {loader === 'versus' ? (
        <VersusMarks pct={pct} youLabel={versusYou} matchLabel={versusMatch} />
      ) : null}
      {children}
    </div>
  );
}
