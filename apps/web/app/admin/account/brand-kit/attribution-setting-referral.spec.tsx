// @vitest-environment happy-dom
/**
 * Brand kit's attribution switch with the referral program on:
 *
 *   - locked, for an owner: "Invite 5 or pay for Dapta AI" (Dapta AI linked),
 *     the pill replica (the real mark and the localized "Made with dForms"),
 *     a progress bar with the count, and the link with a copy button, in
 *     English and Spanish; the same line as the tooltip;
 *   - unlocked by a referral: the switch works, with one line saying why;
 *   - without a referral lock (the program off, or the reader not an owner)
 *     and in the paid states, the row is exactly as before.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';
import type { AttributionStatus } from '@/lib/admin-api';
import { referralLockOf, type ReferralLock } from '@/lib/referral-lock';

const actions = vi.hoisted(() => ({ saveAttributionAction: vi.fn() }));
vi.mock('./actions', () => actions);
const events = vi.hoisted(() => [] as unknown[][]);
vi.mock('@/lib/product-analytics', () => ({
  captureEvent: (event: string, props?: unknown) => events.push([event, props]),
}));

import { ReferralDialogContext } from '@/components/referral/referral-dialog-context';
import { AttributionSetting } from './attribution-setting';

let root: Root | null = null;
let container: HTMLElement | null = null;
const writeText = vi.fn(async () => {});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  events.length = 0;
  vi.clearAllMocks();
});

const LANDING = 'https://platform.example.test/';
const LINK = 'https://landing.example.test/?ref=abcd2345';
const THREE: ReferralLock = { link: LINK, count: 3, goal: 5 };

const NOT_PAID: AttributionStatus = { hideAttribution: false, canHide: false, showing: true, verdictSeen: false, referralUnlocked: false };
const LAPSED: AttributionStatus = { hideAttribution: true, canHide: false, showing: true, verdictSeen: true, referralUnlocked: false };
const BY_REFERRAL: AttributionStatus = { hideAttribution: true, canHide: true, showing: false, verdictSeen: false, referralUnlocked: true };
const PAID: AttributionStatus = { hideAttribution: true, canHide: true, showing: false, verdictSeen: true, referralUnlocked: false };

async function mount(
  initial: AttributionStatus,
  opts: {
    referral?: ReferralLock | null;
    locale?: 'en' | 'es';
    canEdit?: boolean;
    /** The shell's dialog opener; absent, as outside the admin shell. */
    openDialog?: (surface: string) => void;
  } = {},
) {
  const locale = opts.locale ?? 'en';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <ReferralDialogContext.Provider value={opts.openDialog ?? null}>
        <AttributionSetting
          initial={initial}
          canEdit={opts.canEdit ?? true}
          daptaAiUrl={LANDING}
          referral={opts.referral === undefined ? THREE : opts.referral}
          madeWith={getMessages(locale).growth.madeWith}
          m={getMessages(locale).admin.attributionSetting}
        />
      </ReferralDialogContext.Provider>,
    ),
  );
  const el = container;
  return {
    el,
    sw: () => el.querySelector<HTMLButtonElement>('[data-testid="attribution-switch"]')!,
    row: () => el.querySelector<HTMLElement>('[data-testid="attribution-switch-row"]')!,
    q: (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`),
  };
}

describe('AttributionSetting, referral program on, locked', () => {
  it('offers invite or pay, with the pill, the progress and the link', async () => {
    const { sw, q, row } = await mount(NOT_PAID);
    expect(sw().disabled).toBe(true);
    const lock = q('attribution-referral-lock')!;
    expect(q('attribution-referral-lock-title')!.textContent).toBe('Invite 5 or pay for Dapta AI');
    const product = lock.querySelector<HTMLAnchorElement>('a')!;
    expect(product.textContent).toBe('Dapta AI');
    expect(product.getAttribute('href')).toBe(LANDING);
    const pill = q('badge-pill')!;
    expect(pill.lastElementChild!.textContent).toBe('Made with dForms');
    expect(pill.children).toHaveLength(2); // the mark, then the label
    // Neutral, as the real public pill: the card ground and the normal border, no green chip.
    expect(pill.className).toContain('bg-card');
    expect(pill.className).toContain('border-border');
    expect(pill.className).not.toContain('rb-chip');
    expect(lock.textContent).toContain('is gone from every workspace you own');
    expect(q('attribution-referral-lock-progress')!.textContent).toBe('3 of 5 joined');
    expect(lock.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('3');
    expect((q('referral-link') as HTMLInputElement).value).toBe(LINK);
    // It replaces the subscribers note, and is the tooltip too.
    expect(q('attribution-subscribers-only')).toBeNull();
    expect(row().getAttribute('title')).toBe('Invite 5 or pay for Dapta AI');
  });

  it('the copy button puts the link on the clipboard and records where it was copied', async () => {
    const { q } = await mount(NOT_PAID);
    await act(async () => q('referral-copy')!.click());
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(q('referral-copy')!.textContent).toBe('Copied');
    expect(events).toEqual([['referral_link_copied', { surface: 'badge_switch' }]]);
  });

  it('Share opens the referral dialog, from the badge switch', async () => {
    const openDialog = vi.fn();
    const { q } = await mount(NOT_PAID, { openDialog });
    const share = q('referral-share')!;
    expect(share.textContent).toBe('Share');
    expect(share.getAttribute('aria-haspopup')).toBe('dialog');
    await act(async () => share.click());
    expect(openDialog).toHaveBeenCalledWith('badge_switch');
  });

  it('outside the admin shell there is no dialog, so no Share', async () => {
    const { q } = await mount(NOT_PAID);
    expect(q('referral-share')).toBeNull();
    expect(q('referral-copy')).not.toBeNull();
  });

  it('in Spanish, the badge is named by its own label', async () => {
    const { q } = await mount(NOT_PAID, { locale: 'es' });
    expect(q('attribution-referral-lock-title')!.textContent).toBe('Invita a 5 o paga Dapta AI');
    expect(q('badge-pill')!.lastElementChild!.textContent).toBe('Hecho con dForms');
    expect(q('attribution-referral-lock')!.textContent).not.toContain('Made with');
    expect(q('attribution-referral-lock-progress')!.textContent).toBe('3 de 5 se unieron');
    expect(q('referral-copy')!.textContent).toBe('Copiar link');
  });

  it('lapsed keeps its sentence and offers the referrals as the way out', async () => {
    const { sw, q } = await mount(LAPSED);
    expect(q('attribution-lapsed')).not.toBeNull();
    expect(q('attribution-referral-lock')).not.toBeNull();
    expect(sw().disabled).toBe(false); // turning it back on never needs an unlock
  });

  it('a refused save names both ways out', async () => {
    actions.saveAttributionAction.mockResolvedValue({ ok: false, code: 'DAPTA_SUBSCRIPTION_REQUIRED', status: LAPSED });
    const { sw, q } = await mount({ ...BY_REFERRAL, hideAttribution: false, showing: true });
    await act(async () => sw().click());
    expect(q('attribution-save-error')!.textContent).toBe('Invite 5 or pay for Dapta AI');
  });

  it('more referrals than the goal never overfill the bar', async () => {
    const { q } = await mount(NOT_PAID, { referral: { link: LINK, count: 7, goal: 5 } });
    expect(q('attribution-referral-lock-progress')!.textContent).toBe('5 of 5 joined');
  });
});

describe('AttributionSetting, unlocked by a referral', () => {
  it('the switch works, with one line saying why', async () => {
    const { sw, q } = await mount(BY_REFERRAL);
    expect(sw().disabled).toBe(false);
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(q('attribution-referral-unlocked')!.textContent).toBe(
      'Unlocked for life: an owner of this workspace brought 5 people to dForms.',
    );
    expect(q('attribution-referral-lock')).toBeNull();
    expect(q('attribution-subscribers-only')).toBeNull();
  });

  it('turning it back on is a save, like any other', async () => {
    actions.saveAttributionAction.mockResolvedValue({ ok: true, value: { ...BY_REFERRAL, hideAttribution: false, showing: true } });
    const { sw } = await mount(BY_REFERRAL);
    await act(async () => sw().click());
    expect(actions.saveAttributionAction).toHaveBeenCalledWith(false);
    expect(sw().getAttribute('aria-checked')).toBe('true');
  });
});

describe('AttributionSetting, unchanged where the program does not apply', () => {
  it('no referral lock (program off, or not an owner): the subscribers note as before', async () => {
    const { q, row } = await mount(NOT_PAID, { referral: null });
    expect(q('attribution-referral-lock')).toBeNull();
    expect(q('attribution-subscribers-only')!.textContent).toBe('Only for Dapta AI subscribers.');
    expect(row().getAttribute('title')).toBe('Only for Dapta AI subscribers.');
  });

  it('paid: no lock and no referral line', async () => {
    const { sw, q } = await mount(PAID);
    expect(sw().disabled).toBe(false);
    expect(q('attribution-referral-lock')).toBeNull();
    expect(q('attribution-referral-unlocked')).toBeNull();
  });
});

describe('referralLockOf', () => {
  const on = { enabled: true, link: LINK, count: 2, goal: 5 };
  it('is the progress for an owner with the program on', () => {
    expect(referralLockOf({ role: 'owner', referral: on })).toEqual({ link: LINK, count: 2, goal: 5 });
  });
  it('is null for an admin or a member, the program off, or an older API', () => {
    expect(referralLockOf({ role: 'admin', referral: on })).toBeNull();
    expect(referralLockOf({ role: 'member', referral: on })).toBeNull();
    expect(referralLockOf({ role: 'owner', referral: { enabled: false } })).toBeNull();
    expect(referralLockOf({ role: 'owner' })).toBeNull();
  });
});
