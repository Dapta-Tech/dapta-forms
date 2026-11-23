'use client';

import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { dismissReferralBanner } from '@/app/admin/referral-actions';
import { BrandMark } from '@/components/brand/brand';
import { captureEvent } from '@/lib/product-analytics';
import type { ReferralMessages } from './referral-share-modal';
import './referral-banner.css';

/** How hot the strip runs: nothing yet, on the way, one to go. */
export type ReferralBannerHeat = 'cold' | 'warm' | 'hot';

export function bannerHeat(count: number, goal: number): ReferralBannerHeat {
  if (count <= 0) return 'cold';
  return count >= goal - 1 ? 'hot' : 'warm';
}

/**
 * How much of the pill the fire line crosses out, in percent: in step with
 * the count (58 at 3 of 5), and 80 at one to go, where it sizzles. Never the
 * whole pill: the last referral burns it away (the celebration).
 */
export function bannerStrike(count: number, goal: number): number {
  if (count <= 0) return 0;
  if (count >= goal - 1) return 80;
  return Math.max(0, Math.round((count / goal) * 100) - 2);
}

/** The bar's fill: a sliver at 0, so the tip and the track read as a bar to fill. */
function fillWidth(count: number, goal: number): string {
  if (count <= 0) return '2%';
  return `${Math.min(100, Math.round((count / Math.max(goal, 1)) * 100))}%`;
}

/** Fill `{count}`, `{goal}` and `{left}`, and put `badge` where `{badge}` is. */
function compose(template: string, values: { count: number; goal: number }, badge: ReactNode): ReactNode[] {
  const text = template
    .replaceAll('{count}', String(values.count))
    .replaceAll('{goal}', String(values.goal))
    .replaceAll('{left}', String(Math.max(0, values.goal - values.count)));
  const [before = '', after = ''] = text.split('{badge}');
  // The words around the pill are spans of their own: they are what gives way
  // when the strip runs out of room (they truncate, and the narrowest strip
  // drops them), while the pill never shrinks.
  return [
    before ? (
      <span key="before" className="rb-words">
        {before}
      </span>
    ) : null,
    <span key="badge" className="rb-badge">
      {badge}
    </span>,
    after ? (
      <span key="after" className="rb-words">
        {after}
      </span>
    ) : null,
  ];
}

/**
 * A replica of the real "Made with dForms" pill (`.pf__attribution-link`):
 * the same mark, the same localized label and the same semantic tokens, so a
 * new person sees what "the badge" is in either theme. The fire line across
 * it is `::after`, as wide as `--rb-strike` (0 draws none).
 */
export function BadgePill({
  label,
  strike = 0,
  className = '',
  testId,
}: {
  label: string;
  strike?: number;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      className={`rb-pill ${className}`}
      data-strike={strike}
      data-testid={testId}
      style={{ '--rb-strike': `${strike}%` } as CSSProperties}
    >
      <BrandMark className="rb-pill-mark" />
      <span>{label}</span>
    </span>
  );
}

/** The checkered race flag at the end of the track. Fixed artwork, decorative. */
export function RaceFlag() {
  const id = useId().replace(/:/g, '');
  const check = `rb-chk-${id}`;
  return (
    <svg className="rb-flag" viewBox="0 0 24 28" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={check} width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="#fefefe" />
          <rect width="1.5" height="1.5" fill="#1a1a1c" />
          <rect x="1.5" y="1.5" width="1.5" height="1.5" fill="#1a1a1c" />
        </pattern>
      </defs>
      <rect x="2" y="3" width="2.6" height="24.5" rx="1.3" fill="#d4d4da" stroke="#0b0b0c" strokeWidth="1" />
      <circle cx="3.3" cy="2.6" r="2" fill="#ffcb70" stroke="#0b0b0c" strokeWidth="1" />
      <path
        d="M4.6 4.6c3.2-2 5.6 1.6 9 0s5.4-1.2 8 .2v10c-2.6-1.4-4.6-1.8-8 0s-5.8-2-9 0z"
        fill={`url(#${check})`}
        stroke="#0b0b0c"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M6.2 6.4c1.8-.9 3.2-.1 4.6.2"
        fill="none"
        stroke="#fefefe"
        strokeWidth=".9"
        strokeLinecap="round"
        opacity=".7"
      />
    </svg>
  );
}

/**
 * The progress bar to the race flag: a flowing fill as hot as the count
 * (`data-heat`), a tip with sparks, the flag at the goal. One image for
 * assistive tech, named by `label`. Shared by the banner and the dialog.
 */
export function ReferralTrack({
  count,
  goal,
  label,
  className = '',
  testId,
}: {
  count: number;
  goal: number;
  /** Read aloud for the whole bar, e.g. "3 of 5 referrals". */
  label: string;
  className?: string;
  testId?: string;
}) {
  const width = fillWidth(count, goal);
  return (
    <div
      className={`rb-track ${className}`}
      data-heat={bannerHeat(count, goal)}
      role="img"
      aria-label={label}
      data-testid={testId}
    >
      <div className="rb-fill" style={{ width }} data-testid={testId ? `${testId}-fill` : undefined} />
      <div className="rb-tip" style={{ left: width }} aria-hidden="true">
        <span className="rb-dot" />
        <span className="rb-spark" />
        <span className="rb-spark rb-spark-2" />
        <span className="rb-spark rb-spark-3" />
      </div>
      <RaceFlag />
    </div>
  );
}

const ICON = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;
const CloseIcon = () => (
  <svg {...ICON}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/** Where the banner opened the dialog from: its call to action, or its "?". */
export type ReferralBannerOpener = 'banner' | 'banner_help';

/**
 * The referral program's top banner, during the campaign (`bannerVisible`):
 * one 48 px strip at the top of the dashboard's main area, in the app's own
 * theme, with a dForms green beam running around its edge. Its message shows
 * the badge itself, crossed out by a fire line as the count grows; the bar
 * flows to a race flag; ONE call to action, "Remove the badge", opens the
 * referral dialog (what the badge is, how it works, the link and the shares);
 * the "?" opens the same dialog; close hides it for 7 days, for the person.
 *
 * All motion is CSS and stops under `prefers-reduced-motion`. The strip sizes
 * itself by container query, never by the viewport: below 1024 px the copy is
 * short, below 600 px the call to action is one word. The pill is never cut:
 * the words around it give way first.
 */
export function ReferralBanner({
  count,
  goal,
  badgeLabel,
  m,
  onOpen,
}: {
  count: number;
  goal: number;
  /** The badge's localized label (`growth.madeWith`). */
  badgeLabel: string;
  m: ReferralMessages;
  /** Open the referral dialog, saying which control did. */
  onOpen: (from: ReferralBannerOpener) => void;
}) {
  const b = m.banner;
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const values = { count, goal };
  const heat = bannerHeat(count, goal);
  const strike = bannerStrike(count, goal);
  const last = count >= goal - 1;
  const long = count <= 0 ? b.message0 : last ? b.messageLast : b.messageSome;
  const short = count <= 0 ? b.short0 : last ? b.shortLast : b.shortSome;
  const fill = (t: string) =>
    t.replaceAll('{count}', String(count)).replaceAll('{goal}', String(goal)).replaceAll('{badge}', badgeLabel);

  const onClose = () => {
    setDismissed(true);
    captureEvent('referral_banner_dismissed', { count });
    void dismissReferralBanner();
  };

  return (
    <div className="rb" data-heat={heat} data-count={count} data-testid="referral-banner">
      <section className="rb-strip" aria-label={b.region}>
        {/* The beam: decorative, painted over the strip's edge, never in the layout. */}
        <span className="rb-beam" aria-hidden="true" data-testid="referral-banner-beam" />
        <p className="rb-msg">
          <span className="rb-long" data-testid="referral-banner-long">
            {compose(long, values, <BadgePill label={badgeLabel} strike={strike} testId="referral-banner-pill" />)}
          </span>
          <span className="rb-short" data-testid="referral-banner-short">
            {compose(
              short,
              values,
              <BadgePill label={badgeLabel} strike={strike} testId="referral-banner-pill-short" />,
            )}
          </span>
        </p>
        <button
          type="button"
          className="rb-info"
          aria-label={fill(b.infoLabel)}
          title={fill(b.infoLabel)}
          aria-haspopup="dialog"
          data-testid="referral-banner-info"
          onClick={() => onOpen('banner_help')}
        >
          <span aria-hidden="true">?</span>
        </button>
        <ReferralTrack count={count} goal={goal} label={fill(b.progressSr)} testId="referral-banner-track" />
        <button
          type="button"
          className="rb-btn rb-btn-primary"
          aria-label={b.cta}
          title={b.cta}
          aria-haspopup="dialog"
          data-testid="referral-banner-cta"
          onClick={() => onOpen('banner')}
        >
          <span className="rb-face">
            <span className="rb-btn-label">{b.cta}</span>
            <span className="rb-btn-label-short" aria-hidden="true">
              {b.ctaShort}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="rb-btn rb-btn-close"
          aria-label={b.close}
          title={b.close}
          data-testid="referral-banner-close"
          onClick={onClose}
        >
          <span className="rb-face">
            <CloseIcon />
          </span>
        </button>
      </section>
    </div>
  );
}
