import { getMessages, t } from '@quill/shared';
import type { FormProgressStyle } from '@quill/engine';

/**
 * Progress across the CURRENTLY-visible steps (hidden branches never inflate
 * it). Four presentations, one meaning — and one accessibility contract: every
 * variant is the same `progressbar` with the same aria values, so the visual
 * choice never changes what a screen reader is told.
 *
 * `none` still renders the element (visually hidden by CSS) rather than
 * returning null, for the same reason: hiding the bar is a design decision
 * about the page, not a decision to withhold progress from assistive tech.
 */
export function FormProgress({
  total,
  currentIndex,
  locale = 'en',
  style = 'bar',
}: {
  total: number;
  currentIndex: number;
  locale?: string;
  style?: FormProgressStyle;
}) {
  const fillPct = total <= 1 ? 100 : Math.round((currentIndex / (total - 1)) * 100);
  const label = t(getMessages(locale).renderer.progressLabel, {
    current: currentIndex + 1,
    total,
  });
  return (
    <div
      className="pf-progress"
      role="progressbar"
      aria-label={label}
      aria-valuenow={currentIndex + 1}
      aria-valuemin={1}
      aria-valuemax={total}
      data-testid="pf-progress"
    >
      {style === 'dots' ? (
        <div className="pf-progress__dots" aria-hidden>
          {Array.from({ length: Math.max(total, 1) }).map((_, i) => (
            <span
              key={i}
              className={[
                'pf-progress__dot',
                i <= currentIndex ? 'pf-progress__dot--on' : '',
                i === currentIndex ? 'pf-progress__dot--current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            />
          ))}
        </div>
      ) : style === 'steps' ? (
        <p className="pf-progress__steps" aria-hidden>
          {label}
        </p>
      ) : (
        // `bar` and `none` share this markup — `none` is hidden in CSS, so the
        // aria contract above still holds.
        <div className="pf-progress__track">
          <div className="pf-progress__fill" style={{ width: `${fillPct}%` }} />
        </div>
      )}
    </div>
  );
}
