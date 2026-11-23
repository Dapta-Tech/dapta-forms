'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { dismissReferralBanner } from '@/app/admin/referral-actions';
import { BrandMark } from '@/components/brand/brand';
import { captureEvent } from '@/lib/product-analytics';
import type { ReferralMessages } from './referral-share-modal';
import { useReferralCopy } from './use-referral-copy';
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
  // The words around the pill are spans of their own: the narrowest strip
  // drops them from the short copy and keeps the pill whole.
  return [
    before ? <span key="before" className="rb-words">{before}</span> : null,
    <span key="badge">{badge}</span>,
    after ? <span key="after" className="rb-words">{after}</span> : null,
  ];
}

/**
 * A replica of the real "Made with dForms" pill (`MadeWithBadge`): the same
 * mark and the same localized label, so a new person sees what "the badge" is.
 * The fire line across it is `::after`, as wide as `--rb-strike`.
 */
function BadgePill({ label, strike, className = '', testId }: { label: string; strike: number; className?: string; testId?: string }) {
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

/** The checkered race flag at the end of the track. Decorative. */
function RaceFlag() {
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
      <path d="M6.2 6.4c1.8-.9 3.2-.1 4.6.2" fill="none" stroke="#fefefe" strokeWidth=".9" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}

const ICON = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const LinkIcon = () => (
  <svg {...ICON}>
    <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
  </svg>
);
const CheckIcon = () => (
  <svg {...ICON}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
const ShareIcon = () => (
  <svg {...ICON}>
    <path d="M4 12v7h16v-7M12 3v12M7 8l5-5 5 5" />
  </svg>
);
const CloseIcon = () => (
  <svg {...ICON}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/** The popover's widest size; narrower containers get the full width less a margin. */
const POP_WIDTH = 330;
/** Where the popover's arrow sits from its left edge, so it points at the "?". */
const ARROW_INSET = 40;

/**
 * The referral program's top banner, during the campaign (`bannerVisible`):
 * one 48 px strip at the top of the dashboard's main area. Its message shows
 * the badge itself, crossed out by a fire line as the count grows; a "?"
 * explains what the badge is; the bar flows to a race flag; Copy link, Share
 * (the share modal) and close (gone for 7 days, for the person).
 *
 * All motion is CSS and stops under `prefers-reduced-motion`. The strip sizes
 * itself by container query, never by the viewport: below 1024 px the copy
 * is short (the pill always whole), below 600 px the buttons are icons with
 * 44 px targets.
 */
export function ReferralBanner({
  link,
  count,
  goal,
  badgeLabel,
  m,
  onShare,
}: {
  link: string;
  count: number;
  goal: number;
  /** The badge's localized label (`growth.madeWith`). */
  badgeLabel: string;
  m: ReferralMessages;
  /** Open the share modal (from the banner). */
  onShare: () => void;
}) {
  const b = m.banner;
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ x: number; arrow: number } | null>(null);
  const { copied, copy } = useReferralCopy(link, 'banner');
  const wrapRef = useRef<HTMLDivElement>(null);
  const infoRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = `${useId().replace(/:/g, '')}-referral-badge`;

  // Point the popover at the "?", inside the strip's width.
  useLayoutEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current?.getBoundingClientRect();
    const info = infoRef.current?.getBoundingClientRect();
    if (!wrap || !info) return;
    const center = info.left - wrap.left + info.width / 2;
    const width = Math.min(POP_WIDTH, wrap.width - 16);
    const x = Math.max(8, Math.min(center - ARROW_INSET - 6, wrap.width - width - 8));
    setPlace({ x, arrow: Math.max(12, Math.min(center - x - 6, width - 24)) });
  }, [open]);

  // Escape closes it and hands focus back to the "?"; so does a press outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      infoRef.current?.focus();
    };
    const onPointer = (e: Event) => {
      const t = e.target as Node | null;
      if (t && (popRef.current?.contains(t) || infoRef.current?.contains(t))) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  if (dismissed) return null;

  const values = { count, goal };
  const heat = bannerHeat(count, goal);
  const strike = bannerStrike(count, goal);
  const width = fillWidth(count, goal);
  const last = count >= goal - 1;
  const long = count <= 0 ? b.message0 : last ? b.messageLast : b.messageSome;
  const short = count <= 0 ? b.short0 : last ? b.shortLast : b.shortSome;
  const fill = (t: string) =>
    t.replaceAll('{count}', String(count)).replaceAll('{goal}', String(goal)).replaceAll('{badge}', badgeLabel);
  const copyLabel = copied ? m.copied : b.copy;

  const onCopy = async () => {
    // No clipboard: the share modal shows the link, selectable.
    if (!(await copy())) onShare();
  };
  const onClose = () => {
    setDismissed(true);
    captureEvent('referral_banner_dismissed', { count });
    void dismissReferralBanner();
  };

  return (
    <div ref={wrapRef} className="rb" data-heat={heat} data-count={count} data-testid="referral-banner">
      <section className="rb-strip" aria-label={b.region}>
        <p className="rb-msg">
          <span className="rb-long" data-testid="referral-banner-long">
            {compose(long, values, <BadgePill label={badgeLabel} strike={strike} testId="referral-banner-pill" />)}
          </span>
          <span className="rb-short" data-testid="referral-banner-short">
            {compose(short, values, <BadgePill label={badgeLabel} strike={strike} />)}
          </span>
        </p>
        <button
          ref={infoRef}
          type="button"
          className="rb-info"
          aria-label={fill(b.infoLabel)}
          title={fill(b.infoLabel)}
          aria-expanded={open}
          aria-controls={open ? popId : undefined}
          data-testid="referral-banner-info"
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true">?</span>
        </button>
        <div className="rb-track" role="img" aria-label={fill(b.progressSr)} data-testid="referral-banner-track">
          <div className="rb-fill" style={{ width }} data-testid="referral-banner-fill" />
          <div className="rb-tip" style={{ left: width }} aria-hidden="true">
            <span className="rb-dot" />
            <span className="rb-spark" />
            <span className="rb-spark rb-spark-2" />
            <span className="rb-spark rb-spark-3" />
          </div>
          <RaceFlag />
        </div>
        <button
          type="button"
          className="rb-btn rb-btn-primary"
          aria-label={copyLabel}
          title={copyLabel}
          aria-live="polite"
          data-testid="referral-banner-copy"
          onClick={onCopy}
        >
          <span className="rb-face">
            {copied ? <CheckIcon /> : <LinkIcon />}
            <span className="rb-btn-label">{copyLabel}</span>
          </span>
        </button>
        <button
          type="button"
          className="rb-btn rb-btn-secondary"
          aria-label={b.share}
          title={b.share}
          data-testid="referral-banner-share"
          onClick={onShare}
        >
          <span className="rb-face">
            <ShareIcon />
            <span className="rb-btn-label">{b.share}</span>
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
      {open ? (
        <div
          ref={popRef}
          id={popId}
          role="dialog"
          aria-label={b.popoverLabel}
          className="rb-pop"
          data-testid="referral-banner-popover"
          style={
            {
              '--rb-pop-x': `${place?.x ?? 8}px`,
              '--rb-arrow-x': `${place?.arrow ?? ARROW_INSET}px`,
            } as CSSProperties
          }
        >
          <div className="rb-mock" aria-hidden="true">
            <div className="rb-mock-line" style={{ width: '55%' }} />
            <div className="rb-mock-line rb-mock-line-sub" style={{ width: '80%' }} />
            <div className="rb-mock-input" />
            <div className="rb-mock-input" />
            <div className="rb-mock-cta" />
            <span className="rb-pill rb-mock-pill" data-testid="referral-banner-mock-pill">
              <BrandMark className="rb-pill-mark" />
              <span>{badgeLabel}</span>
            </span>
          </div>
          <p className="rb-pop-text">
            <strong>{b.popoverTitle}</strong> {fill(b.popoverBody)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
