// @vitest-environment happy-dom
/**
 * The Design tab's badge control with the referral program on:
 *
 *   - locked, for an owner: Off stays out of reach, and under it "Invite 5 or
 *     pay for Dapta AI" with the pill replica, the progress bar and the link,
 *     the same line as Off's hover text, in English and Spanish;
 *   - unlocked by a referral: Off works, with one line saying why;
 *   - no referral lock (the program off, or not an owner) and paid: as before.
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormConfig } from '@quill/engine';
import { getMessages } from '@quill/shared';
import type { AttributionStatus } from '@/lib/admin-api';
import type { ReferralLock } from '@/lib/referral-lock';

vi.mock('next/font/google', () => {
  const font = () => ({ className: 'font', variable: '--font', style: { fontFamily: 'font' } });
  return {
    DM_Sans: font,
    Figtree: font,
    Fraunces: font,
    Hanken_Grotesk: font,
    JetBrains_Mono: font,
    Inter: font,
    Manrope: font,
    Playfair_Display: font,
    Poppins: font,
    Space_Grotesk: font,
    Work_Sans: font,
  };
});
vi.mock('./preview-frame', () => ({ PreviewFrame: () => null }));
const save = vi.hoisted(() => vi.fn());
vi.mock('@/app/admin/account/brand-kit/actions', () => ({ saveAttributionAction: save }));

vi.mock('@/lib/product-analytics', () => ({ captureEvent: () => {} }));

import { DesignPanel } from './design-panel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LINK = 'https://landing.example.test/?ref=abcd2345';
const TWO: ReferralLock = { link: LINK, count: 2, goal: 5 };

const FREE: AttributionStatus = { hideAttribution: false, canHide: false, showing: true, verdictSeen: false, referralUnlocked: false };
const BY_REFERRAL: AttributionStatus = { hideAttribution: true, canHide: true, showing: false, verdictSeen: false, referralUnlocked: true };
const PAID_ON: AttributionStatus = { hideAttribution: false, canHide: true, showing: true, verdictSeen: true, referralUnlocked: false };

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => save.mockReset());
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

function Harness({ initial, referral, locale }: { initial: AttributionStatus; referral: ReferralLock | null; locale: 'en' | 'es' }) {
  const [status, setStatus] = useState(initial);
  const config = {
    version: 1,
    layout: 'slides',
    steps: [{ key: 'email', type: 'email', question: 'Email?' }],
    branding: { badgeSize: 'md' },
  } as unknown as FormConfig;
  return (
    <DesignPanel
      config={config}
      name="Clinic contact"
      publicPath="/acme/f/contact"
      locale={locale}
      layout="slides"
      onTitleChange={() => {}}
      onLanguageChange={() => {}}
      onLabelsChange={() => {}}
      onLayoutChange={() => {}}
      hasReveal={false}
      onEndRevealChange={() => {}}
      onCoverChange={() => {}}
      onBrandingChange={() => {}}
      showAttribution={status.showing}
      attribution={{ status, canEdit: true, daptaAiUrl: 'https://dapta.ai', referral, onChange: setStatus }}
      m={getMessages(locale).admin.editor}
    />
  );
}

async function mount(initial: AttributionStatus, opts: { referral?: ReferralLock | null; locale?: 'en' | 'es' } = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <Harness initial={initial} referral={opts.referral === undefined ? TWO : opts.referral} locale={opts.locale ?? 'en'} />,
    ),
  );
}

const q = (id: string) => host!.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const group = () => q('design-badge-size')!;
const option = (label: string) =>
  [...group().querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === label)!;
const checked = () => group().querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')?.textContent;

describe('Design: the badge control with the referral program on', () => {
  const d = getMessages('en').admin.editor.design;

  it('locked: Off is out of reach, and the way out is invite or pay, with the pill, the bar and the link', async () => {
    await mount(FREE);
    const off = option(d.badgeOff);
    expect(off.getAttribute('aria-disabled')).toBe('true');
    expect(off.title).toBe('Invite 5 or pay for Dapta AI');
    expect(q('design-badge-referral-lock-title')!.textContent).toBe('Invite 5 or pay for Dapta AI');
    expect(q('design-badge-referral-lock-title')!.querySelector('a')!.getAttribute('href')).toBe('https://dapta.ai');
    expect(q('badge-pill')!.lastElementChild!.textContent).toBe('Made with dForms');
    expect(q('design-badge-referral-lock-progress')!.textContent).toBe('2 of 5 joined');
    expect((q('referral-link') as HTMLInputElement).value).toBe(LINK);
    expect(q('design-badge-subscribers-only')).toBeNull();
  });

  it('locked, in Spanish', async () => {
    await mount(FREE, { locale: 'es' });
    expect(q('design-badge-referral-lock-title')!.textContent).toBe('Invita a 5 o paga Dapta AI');
    expect(q('badge-pill')!.lastElementChild!.textContent).toBe('Hecho con dForms');
    expect(q('design-badge-referral-lock-progress')!.textContent).toBe('2 de 5 se unieron');
  });

  it('unlocked by a referral: Off is selected and usable, with the reason', async () => {
    save.mockResolvedValue({ ok: true, value: { ...BY_REFERRAL, hideAttribution: false, showing: true } });
    await mount(BY_REFERRAL);
    expect(checked()).toBe(d.badgeOff);
    expect(q('design-badge-referral-unlocked')!.textContent).toBe(
      'Unlocked for life: an owner of this workspace brought 5 people to dForms.',
    );
    expect(q('design-badge-referral-lock')).toBeNull();
    await act(async () => option(d.sizeSm).click());
    expect(save).toHaveBeenCalledWith(false);
  });

  it('no referral lock (the program off, or not an owner): the subscribers note as before', async () => {
    await mount(FREE, { referral: null });
    expect(q('design-badge-referral-lock')).toBeNull();
    expect(q('design-badge-subscribers-only')!.textContent).toBe('Only for Dapta AI subscribers.');
    expect(option(d.badgeOff).title).toBe('Only for Dapta AI subscribers.');
  });

  it('paid: nothing about referrals', async () => {
    await mount(PAID_ON);
    expect(option(d.badgeOff).getAttribute('aria-disabled')).toBeNull();
    expect(q('design-badge-referral-lock')).toBeNull();
    expect(q('design-badge-referral-unlocked')).toBeNull();
  });
});
