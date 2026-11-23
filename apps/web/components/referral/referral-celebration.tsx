'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { Modal } from '@/components/modal';
import { BadgePill, RaceFlag } from './referral-banner';
import type { ReferralMessages } from './referral-share-modal';
import './referral-banner.css';
import './referral-celebration.css';

/** Where the badge's switch lives: the brand kit, under Account settings. */
export const BADGE_SETTING_HREF = '/admin/account/brand-kit';

/** The sparks' directions (degrees, 0 is right) and how far each one flies. */
const SPARKS: { a: number; d: number; delay: number }[] = [
  { a: -160, d: 70, delay: 0 },
  { a: -135, d: 92, delay: 0.08 },
  { a: -112, d: 64, delay: 0.16 },
  { a: -90, d: 84, delay: 0.04 },
  { a: -68, d: 70, delay: 0.12 },
  { a: -45, d: 96, delay: 0.2 },
  { a: -22, d: 66, delay: 0.06 },
  { a: 0, d: 80, delay: 0.14 },
  { a: 20, d: 54, delay: 0.1 },
  { a: 160, d: 58, delay: 0.18 },
  { a: 200, d: 48, delay: 0.02 },
  { a: -200, d: 74, delay: 0.22 },
];

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/** Put the badge's name where `{badge}` is, with the fire line through it. */
function withBadge(template: string, badge: string): ReactNode[] {
  const [before = '', after = ''] = template.split('{badge}');
  return [
    before,
    <span key="badge" className="rc-name">
      {badge}
    </span>,
    after,
  ];
}

/**
 * The one-time celebration when the person reaches the goal, in the banner's
 * language: the replica of the badge pill, crossed out by the fire line where
 * the banner left it (80%), burns all the way and away, sparks fly, and the
 * race flag waves at the end of a full track. Then what it means, a link to
 * the badge setting and Close.
 *
 * Under `prefers-reduced-motion` it is still: the pill fully crossed out and
 * dimmed, no sparks, the flag at rest (the CSS also stops every animation in
 * that case, should the media query change while it is open).
 */
export function ReferralCelebration({
  open,
  onClose,
  goal,
  badgeLabel,
  m,
}: {
  open: boolean;
  onClose: () => void;
  goal: number;
  /** The badge's localized label (`growth.madeWith`). */
  badgeLabel: string;
  m: ReferralMessages;
}) {
  const c = m.celebration;
  const [motion] = useState<'full' | 'reduce'>(() => (prefersReducedMotion() ? 'reduce' : 'full'));
  const labelId = 'referral-celebration-title';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={c.title.replaceAll('{badge}', badgeLabel)}
      labelId={labelId}
      portal
      bare
      lockScroll
      panelClassName="rc max-w-md overflow-hidden rounded-2xl shadow-2xl"
    >
      {/* A dark card in both colour schemes: the dark tokens, re-established on
          this subtree, feed the banner's palette (`rb-theme`). */}
      <div data-testid="referral-celebration" data-motion={motion} data-theme="dark" className="rb-theme rc-card">
        <div className="rc-stage" aria-hidden="true">
          <div className="rc-glow" />
          <div className="rc-burn">
            <BadgePill
              label={badgeLabel}
              strike={motion === 'reduce' ? 100 : 80}
              className="rc-pill"
              testId="referral-celebration-pill"
            />
            {motion === 'full' ? <span className="rc-front" /> : null}
            {motion === 'full'
              ? SPARKS.map((s, i) => (
                  <span
                    key={i}
                    className="rc-spark"
                    style={{ '--rc-a': `${s.a}deg`, '--rc-d': `${s.d}px`, '--rc-delay': `${s.delay}s` } as CSSProperties}
                  />
                ))
              : null}
          </div>
          <div className="rc-track">
            <div className="rc-fill" />
            <RaceFlag />
          </div>
        </div>
        <div className="rc-copy">
          <h2 id={labelId} data-testid="referral-celebration-title" className="rc-title">
            {withBadge(c.title, badgeLabel)}
          </h2>
          <p data-testid="referral-celebration-body" className="rc-body">
            {c.body.replaceAll('{goal}', String(goal))}
          </p>
          <div className="rc-actions">
            <Link
              href={BADGE_SETTING_HREF}
              onClick={onClose}
              data-testid="referral-celebration-setting"
              className="rc-btn rc-btn-primary"
            >
              {c.setting}
            </Link>
            <button type="button" onClick={onClose} data-testid="referral-celebration-close" className="rc-btn rc-btn-secondary">
              {c.close}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
