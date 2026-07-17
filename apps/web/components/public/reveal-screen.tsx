'use client';

import { useEffect, useRef, useState } from 'react';
import { interpolate, type Answers, type FormReveal } from '@quill/engine';

/** The interstitial's default play time when the config sets none. */
export const DEFAULT_REVEAL_MS = 2200;

/** Localized fallbacks when the config carries no reveal copy. */
export interface RevealScreenMessages {
  headline: string;
  subtitle: string;
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
): { headline: string; subtitle: string; durationMs: number } {
  const template = reveal?.subtitleTemplate;
  return {
    headline: reveal?.headline ?? messages.headline,
    subtitle: template ? interpolate(template, answers) : (reveal?.subtitle ?? messages.subtitle),
    durationMs: reveal?.durationMs ?? DEFAULT_REVEAL_MS,
  };
}

/**
 * The reveal/processing interstitial body (pilot "matching loader" parity):
 * plays for `reveal.durationMs` (default 2200ms), renders the configured
 * headline + subtitle — `subtitleTemplate` wins over `subtitle` and gets its
 * `[key]` tokens interpolated from the answers via the engine's `interpolate`,
 * so e.g. "Finding the best advisor for [industry]…" personalizes live — above
 * an animated determinate progress bar (existing `.pf-reveal__*` styles).
 * Fires `onComplete` exactly once when the bar fills; the caller owns the
 * page chrome (accent vars, banner) and what happens next.
 */
export function RevealScreen({
  reveal,
  answers,
  messages,
  onComplete,
}: {
  reveal?: FormReveal | null;
  answers: Answers;
  messages: RevealScreenMessages;
  onComplete?: () => void;
}) {
  const { headline, subtitle, durationMs } = resolveRevealCopy(reveal, answers, messages);

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
    <div className="pf-reveal__inner">
      <div className="pf-reveal__spinner" aria-hidden="true" />
      <h1 className="pf-reveal__headline">{headline}</h1>
      <p className="pf-reveal__subtitle">{subtitle}</p>
      <div className="pf-reveal__track">
        <div className="pf-reveal__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
