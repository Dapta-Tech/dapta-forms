// @vitest-environment happy-dom
/**
 * The referral program's live moments, mounted in the admin shell: a toast
 * when the person's count went up since the last count they saw (kept per
 * person in this browser), and a one-time celebration when the unlock flips
 * on. The first sight of a person only remembers the state, silently. The
 * count is read again on window focus and when the tab comes back, never on
 * a timer.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@quill/shared';
import type { MeReferral } from '@/lib/admin-api';

const calls = vi.hoisted(() => ({
  events: [] as [string, unknown][],
  refreshed: 0,
  reads: 0,
  next: null as unknown,
  reducedMotion: false,
}));
vi.mock('@/lib/product-analytics', () => ({
  captureEvent: (event: string, props?: unknown) => calls.events.push([event, props]),
}));
vi.mock('@/components/brand/brand', () => ({
  BrandMark: ({ className }: { className?: string }) => <svg data-testid="brand-mark" className={className} />,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: () => {
      calls.refreshed += 1;
    },
    push: () => {},
  }),
}));
vi.mock('@/app/admin/referral-actions', () => ({
  dismissReferralBanner: async () => ({ ok: true }),
  readReferralProgress: async () => {
    calls.reads += 1;
    return calls.next;
  },
}));

import { ToastProvider } from '@/components/toast';
import { REFERRAL_SEEN_KEY_PREFIX } from '@/lib/referral-moments';
import { ReferralMoments } from './referral-moments';

const CODE = 'abc23def';
const LINK = `https://landing.example.test/?ref=${CODE}`;
const KEY = `${REFERRAL_SEEN_KEY_PREFIX}${CODE}`;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  calls.events = [];
  calls.refreshed = 0;
  calls.reads = 0;
  calls.next = null;
  calls.reducedMotion = false;
  window.localStorage.clear();
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? calls.reducedMotion : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

interface State {
  count: number;
  unlocked?: boolean;
  locale?: Locale;
}

function element(s: State) {
  const m = getMessages(s.locale ?? 'en');
  return (
    <ToastProvider>
      <ReferralMoments
        link={LINK}
        count={s.count}
        goal={5}
        unlocked={s.unlocked ?? false}
        badgeLabel={m.growth.madeWith}
        m={m.admin.chrome.referral}
      />
    </ToastProvider>
  );
}

/** A dashboard load with this state (a fresh page: a new root). */
async function load(s: State) {
  await act(async () => root?.unmount());
  host?.remove();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(element(s)));
}

const toasts = () => [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent?.replace('×', '').trim());
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const seen = () => JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as { count: number; unlocked: boolean } | null;
const named = (name: string) => calls.events.filter(([e]) => e === name);

describe('ReferralMoments: the toast on a new referral', () => {
  it('shows no toast on the first load and remembers the count silently', async () => {
    await load({ count: 2 });
    expect(toasts()).toEqual([]);
    expect(seen()).toEqual({ count: 2, unlocked: false });
    expect(named('referral_toast_shown')).toEqual([]);
  });

  it('shows a toast when the count went up since the last load', async () => {
    await load({ count: 1 });
    await load({ count: 2 });
    expect(toasts()).toEqual(['Someone joined with your link. 3 to go']);
    expect(seen()).toEqual({ count: 2, unlocked: false });
    expect(named('referral_toast_shown')).toEqual([['referral_toast_shown', { count: 2 }]]);
  });

  it('shows no toast when the count is unchanged', async () => {
    await load({ count: 3 });
    await load({ count: 3 });
    expect(toasts()).toEqual([]);
    expect(named('referral_toast_shown')).toEqual([]);
  });
});

/** Time moves on past the refresh gap, then the window gets focus. */
async function focusLater(next: MeReferral | null, ms = 60_000) {
  calls.next = next;
  const at = Date.now() + ms;
  vi.spyOn(Date, 'now').mockReturnValue(at);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
}

const enabled = (count: number, unlocked = false): MeReferral => ({
  enabled: true,
  link: LINK,
  count,
  goal: 5,
  unlocked,
});

describe('ReferralMoments: the count read again on focus', () => {
  it('a new referral found on focus shows a toast and refreshes the page', async () => {
    await load({ count: 1 });
    await focusLater(enabled(2));
    expect(calls.reads).toBe(1);
    expect(toasts()).toEqual(['Someone joined with your link. 3 to go']);
    expect(calls.refreshed).toBe(1);
  });

  it('nothing new on focus: no toast, no refresh', async () => {
    await load({ count: 1 });
    await focusLater(enabled(1));
    expect(calls.reads).toBe(1);
    expect(toasts()).toEqual([]);
    expect(calls.refreshed).toBe(0);
  });

  it('a focus right after the load does not read again', async () => {
    await load({ count: 1 });
    await focusLater(enabled(2), 1_000);
    expect(calls.reads).toBe(0);
  });

  it('the tab coming back into view reads the count too', async () => {
    await load({ count: 1 });
    calls.next = enabled(3);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(toasts()).toEqual(['2 people joined with your link. 2 to go']);
  });

  it('a program switched off since, or a failed read, changes nothing', async () => {
    await load({ count: 1 });
    await focusLater({ enabled: false });
    await focusLater(null, 120_000);
    expect(toasts()).toEqual([]);
    expect(calls.refreshed).toBe(0);
    expect(seen()).toEqual({ count: 1, unlocked: false });
  });
});

describe('ReferralMoments: the toast copy', () => {
  it('counts down to one left, in Spanish', async () => {
    await load({ count: 3, locale: 'es' });
    await load({ count: 4, locale: 'es' });
    expect(toasts()).toEqual(['Alguien se unió con tu link. Te falta solo 1']);
  });

  it('says "someone else" once the goal was already reached', async () => {
    await load({ count: 5, unlocked: true });
    await load({ count: 6, unlocked: true });
    expect(toasts()).toEqual(['Someone else joined with your link']);
    expect(named('referral_toast_shown')).toEqual([['referral_toast_shown', { count: 6 }]]);
  });
});

describe('ReferralMoments: a browser that refuses storage', () => {
  it('renders and shows nothing when localStorage throws', async () => {
    // Blocked site data: reading `window.localStorage` itself throws.
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    try {
      await load({ count: 1 });
      await load({ count: 2 });
      await load({ count: 5, unlocked: true });
      expect(toasts()).toEqual([]);
      expect(q('referral-celebration')).toBeNull();
    } finally {
      if (real) Object.defineProperty(window, 'localStorage', real);
    }
  });
});

describe('ReferralMoments: storage that fails on each call', () => {
  it('renders and shows nothing when every read and write throws', async () => {
    const store = window.localStorage;
    vi.spyOn(store, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(store, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await load({ count: 1 });
    await load({ count: 2 });
    await load({ count: 5, unlocked: true });
    expect(toasts()).toEqual([]);
    expect(q('referral-celebration')).toBeNull();
  });
});

describe('ReferralMoments: the celebration at the goal', () => {
  it('shows once when the unlock flips on, and not again', async () => {
    await load({ count: 4 });
    await load({ count: 5, unlocked: true });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!)!;
    expect(title.textContent).toBe('You did it: your forms no longer show Made with dForms');
    expect(q('referral-celebration-body')!.textContent).toBe(
      '5 people joined with your link. The badge is gone from every workspace you own, for life, and from the ones you create later.',
    );
    expect(q('referral-celebration-pill')!.textContent).toBe('Made with dForms');
    expect(q('referral-celebration-setting')!.getAttribute('href')).toBe('/admin/account/brand-kit');
    // The referral that reaches the goal is the celebration, not a toast too.
    expect(toasts()).toEqual([]);
    expect(named('referral_celebration_shown')).toHaveLength(1);
    expect(seen()).toEqual({ count: 5, unlocked: true });

    await act(async () => q('referral-celebration-close')!.click());
    expect(q('referral-celebration')).toBeNull();

    await load({ count: 5, unlocked: true });
    expect(q('referral-celebration')).toBeNull();
    expect(named('referral_celebration_shown')).toHaveLength(1);
  });

  it('a flip found on focus celebrates too', async () => {
    await load({ count: 4 });
    await focusLater(enabled(5, true));
    expect(q('referral-celebration')).not.toBeNull();
    expect(calls.refreshed).toBe(1);
  });

  it('does not celebrate a person already unlocked on first sight', async () => {
    await load({ count: 7, unlocked: true });
    expect(q('referral-celebration')).toBeNull();
    expect(named('referral_celebration_shown')).toEqual([]);
    expect(seen()).toEqual({ count: 7, unlocked: true });
  });

  it('the setting link closes it on the way out', async () => {
    await load({ count: 4 });
    await load({ count: 5, unlocked: true });
    await act(async () => q('referral-celebration-setting')!.click());
    expect(q('referral-celebration')).toBeNull();
  });

  it('in Spanish, names the badge as it reads there', async () => {
    await load({ count: 4, locale: 'es' });
    await load({ count: 5, unlocked: true, locale: 'es' });
    expect(q('referral-celebration-title')!.textContent).toBe('Lo lograste: tus formularios ya no llevan Hecho con dForms');
    expect(q('referral-celebration-setting')!.textContent).toBe('Ver el ajuste del sello');
  });

  it('burns the pill away with sparks and the race flag, in motion', async () => {
    await load({ count: 4 });
    await load({ count: 5, unlocked: true });
    expect(q('referral-celebration')!.dataset.motion).toBe('full');
    expect(document.querySelectorAll('.rc-spark').length).toBeGreaterThan(0);
    expect(document.querySelector('.rc-stage .rb-flag')).not.toBeNull();
  });

  it('under reduced motion, shows a still version: the pill crossed out, no sparks', async () => {
    calls.reducedMotion = true;
    await load({ count: 4 });
    await load({ count: 5, unlocked: true });
    expect(q('referral-celebration')!.dataset.motion).toBe('reduce');
    expect(document.querySelectorAll('.rc-spark').length).toBe(0);
    expect(q('referral-celebration-pill')!.dataset.strike).toBe('100');
    expect(document.querySelector('.rc-stage .rb-flag')).not.toBeNull();
  });
});
