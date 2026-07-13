import { getMessages, t } from '@quill/shared';

/**
 * Linear progress across the CURRENTLY-visible steps. A real `progressbar` with
 * aria-valuenow/min/max + a localized accessible label; the fill advances as the
 * respondent moves through steps (visible steps only — hidden branches don't
 * inflate the bar).
 */
export function FormProgress({
  total,
  currentIndex,
  locale = 'en',
}: {
  total: number;
  currentIndex: number;
  locale?: string;
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
    >
      <div className="pf-progress__track">
        <div className="pf-progress__fill" style={{ width: `${fillPct}%` }} />
      </div>
    </div>
  );
}
