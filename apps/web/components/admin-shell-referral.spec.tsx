// @vitest-environment happy-dom
/**
 * The referral program's left-menu entry: present in the rail and the drawer
 * only while the program is on, with the person's progress (0/5) as a pill
 * the open rail shows and a screen reader hears, and opening the share modal.
 * Opened from the mobile drawer, the drawer closes so the dialog is not under it.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@quill/shared';

const nav = vi.hoisted(() => ({ pathname: '/admin', events: [] as [string, unknown][], dismissed: 0 }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/app/admin/announcement-actions', () => ({ recordAnnouncementAction: async () => ({ ok: true }) }));
vi.mock('@/app/admin/referral-actions', () => ({
  dismissReferralBanner: async () => {
    nav.dismissed += 1;
    return { ok: true };
  },
  readReferralProgress: async () => null,
}));
vi.mock('@/lib/product-analytics', () => ({
  captureEvent: (event: string, props?: unknown) => nav.events.push([event, props]),
}));

import { AdminShell, PRODUCT_HUNT_REVIEW_URL, type ShellReferral } from './admin-shell';
import { useOpenReferralDialog } from './referral/referral-dialog-context';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REFERRAL: ShellReferral = {
  link: 'https://landing.example.test/?ref=abc23def',
  count: 0,
  goal: 5,
  badgeLabel: 'Made with dForms',
};

function shell(
  opts: {
    collapsed?: boolean;
    locale?: Locale;
    referral?: ShellReferral | null;
    page?: React.ReactNode;
    /** Left out: the build's own answer (a fork in tests). */
    productHunt?: boolean;
  } = {},
) {
  const m = getMessages(opts.locale ?? 'en').admin;
  return (
    <AdminShell
      user={{ displayName: 'Alex Rivera', email: 'alex@example.com' }}
      messages={m.chrome}
      accountNav={m.account.nav}
      initialCollapsed={opts.collapsed ?? false}
      referral={opts.referral === undefined ? REFERRAL : opts.referral}
      {...(opts.productHunt === undefined ? {} : { productHunt: opts.productHunt })}
    >
      {opts.page ?? <p>page</p>}
    </AdminShell>
  );
}

/** The name a screen reader computes: the text, minus what is aria-hidden. */
function accessibleName(el: Element): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) out += n.textContent ?? '';
    if (n.nodeType !== 1) return;
    if ((n as Element).getAttribute('aria-hidden') === 'true') return;
    n.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  return out.replace(/\s+/g, ' ').trim();
}

const entries = (html: string) =>
  [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('[data-testid="nav-referral"]')];

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
}

beforeEach(() => {
  window.localStorage.clear();
  nav.pathname = '/admin';
  nav.events = [];
  nav.dismissed = 0;
  window.matchMedia = ((q: string) => ({
    matches: q.includes('min-width'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe('AdminShell: the referral entry', () => {
  it('sits in the open rail and the drawer with the progress, read as one name', () => {
    const [desktop, drawer] = entries(renderToStaticMarkup(shell()));
    for (const entry of [desktop!, drawer!]) {
      expect(entry.tagName).toBe('BUTTON');
      expect(entry.querySelector('[data-testid="nav-referral-progress"]')!.textContent).toBe('0/5');
      expect(accessibleName(entry)).toBe('Remove badge, 0 of 5 referrals');
    }
  });

  it('wears the banner\'s race flag, not the gift', () => {
    const [desktop, drawer] = entries(renderToStaticMarkup(shell()));
    for (const entry of [desktop!, drawer!]) {
      expect(entry.querySelector('svg.rb-flag-icon')).not.toBeNull();
      // Still, unlike the waving flag at the end of the track.
      expect(entry.querySelector('svg.rb-flag')).toBeNull();
      expect(entry.querySelector('.pi-gift')).toBeNull();
      expect(entry.textContent).not.toContain('Invite friends');
    }
  });

  it('shows the count it is given, in Spanish too', () => {
    const [desktop] = entries(renderToStaticMarkup(shell({ locale: 'es', referral: { ...REFERRAL, count: 3 } })));
    expect(desktop!.querySelector('[data-testid="nav-referral-progress"]')!.textContent).toBe('3/5');
    expect(accessibleName(desktop!)).toBe('Quitar sello, 3 de 5 referidos');
  });

  it('collapsed to the 64px rail: the icon alone, the name and progress still read', () => {
    const [desktop] = entries(renderToStaticMarkup(shell({ collapsed: true })));
    expect(desktop!.querySelector('[data-testid="nav-referral-progress"]')).toBeNull();
    expect(desktop!.getAttribute('title')).toBe('Remove badge, 0 of 5 referrals');
    expect(accessibleName(desktop!)).toBe('Remove badge, 0 of 5 referrals');
    expect(desktop!.querySelector('svg.rb-flag-icon')).not.toBeNull();
  });

  it('is absent while the program is off', () => {
    expect(entries(renderToStaticMarkup(shell({ referral: null })))).toHaveLength(0);
  });

  it('opens the referral dialog with the link and the badge, and records it from the menu', async () => {
    await mount(shell());
    expect(document.querySelector('[data-testid="referral-modal"]')).toBeNull();
    await act(async () => document.querySelector<HTMLElement>('[data-testid="nav-referral"]')!.click());
    expect(document.querySelector('[data-testid="referral-modal"]')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('[data-testid="referral-link"]')!.value).toBe(REFERRAL.link);
    expect(document.querySelector('[data-testid="referral-mock-pill"]')!.textContent).toContain('Made with dForms');
    expect(nav.events).toEqual([['referral_dialog_opened', { surface: 'menu' }]]);
  });

  it('from the drawer, the drawer closes as the modal opens', async () => {
    await mount(shell());
    await act(async () => document.querySelector<HTMLElement>('button[aria-label="Open navigation"]')!.click());
    const drawer = document.querySelector('aside[role="dialog"]')!;
    expect(drawer.hasAttribute('inert')).toBe(false);
    await act(async () => drawer.querySelector<HTMLElement>('[data-testid="nav-referral"]')!.click());
    expect(drawer.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('[data-testid="referral-modal"]')).not.toBeNull();
  });
});

const BANNER: ShellReferral = { ...REFERRAL, count: 3, banner: { badgeLabel: 'Made with dForms' } };
const bannerOf = () => document.querySelector<HTMLElement>('[data-testid="referral-banner"]');

describe('AdminShell: the referral banner', () => {
  it('sits at the top of the main area while the API shows it', async () => {
    await mount(shell({ referral: BANNER }));
    const main = document.querySelector('main')!;
    expect(main.firstElementChild).toBe(bannerOf());
    expect(bannerOf()!.dataset.count).toBe('3');
  });

  it('is absent when the API hides it, and with the program off', async () => {
    await mount(shell({ referral: { ...BANNER, banner: null } }));
    expect(bannerOf()).toBeNull();
    expect(document.querySelector('[data-testid="nav-referral"]')).not.toBeNull();
    await act(async () => root!.unmount());
    await mount(shell({ referral: null }));
    expect(bannerOf()).toBeNull();
  });

  it('stays out of the form builder, which owns the full viewport height', async () => {
    nav.pathname = '/admin/forms/f1/edit';
    await mount(shell({ referral: BANNER }));
    expect(bannerOf()).toBeNull();
  });

  it('"Remove the badge" opens the dialog, whose open, copy and shares say they came from the banner', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
    await mount(shell({ referral: BANNER }));
    await act(async () => document.querySelector<HTMLElement>('[data-testid="referral-banner-cta"]')!.click());
    expect(document.querySelector('[data-testid="referral-modal"]')).not.toBeNull();
    await act(async () => document.querySelector<HTMLElement>('[data-testid="referral-copy"]')!.click());
    expect(nav.events).toEqual([
      ['referral_dialog_opened', { surface: 'banner' }],
      ['referral_link_copied', { surface: 'banner' }],
    ]);
  });

  it('the "?" opens the same dialog, told apart as banner_help', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
    await mount(shell({ referral: BANNER }));
    await act(async () => document.querySelector<HTMLElement>('[data-testid="referral-banner-info"]')!.click());
    expect(document.querySelectorAll('[data-testid="referral-modal"]')).toHaveLength(1);
    await act(async () => document.querySelector<HTMLElement>('[data-testid="referral-copy"]')!.click());
    expect(nav.events).toEqual([
      ['referral_dialog_opened', { surface: 'banner_help' }],
      ['referral_link_copied', { surface: 'banner_help' }],
    ]);
  });

  it('opened from the menu, the dialog says so', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
    await mount(shell({ referral: BANNER }));
    await act(async () => document.querySelector<HTMLElement>('[data-testid="nav-referral"]')!.click());
    await act(async () => document.querySelector<HTMLElement>('[data-testid="referral-copy"]')!.click());
    expect(nav.events).toEqual([
      ['referral_dialog_opened', { surface: 'menu' }],
      ['referral_link_copied', { surface: 'menu' }],
    ]);
  });

  it('close hides it at once and tells the API', async () => {
    await mount(shell({ referral: BANNER }));
    await act(async () => document.querySelector<HTMLElement>('[data-testid="referral-banner-close"]')!.click());
    expect(bannerOf()).toBeNull();
    expect(nav.dismissed).toBe(1);
  });
});

describe('AdminShell: the referral moments', () => {
  const SEEN_KEY = 'dforms.referral.seen.abc23def';
  const celebration = () => document.querySelector('[data-testid="referral-celebration"]');

  it('celebrates the unlock over any page, the form builder too, naming the badge', async () => {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify({ count: 4, unlocked: false }));
    nav.pathname = '/admin/forms/f1/edit';
    await mount(shell({ referral: { ...REFERRAL, count: 5, unlocked: true } }));
    expect(celebration()).not.toBeNull();
    expect(document.querySelector('[data-testid="referral-celebration-title"]')!.textContent).toBe(
      'You did it: your forms no longer show Made with dForms',
    );
    expect(nav.events.filter(([e]) => e === 'referral_celebration_shown')).toHaveLength(1);
  });

  it('remembers the count on the first load, with nothing shown', async () => {
    await mount(shell({ referral: { ...REFERRAL, count: 2 } }));
    expect(JSON.parse(window.localStorage.getItem(SEEN_KEY)!)).toEqual({ count: 2, unlocked: false });
    expect(celebration()).toBeNull();
  });

  it('renders nothing and stores nothing while the program is off', async () => {
    await mount(shell({ referral: null }));
    expect(window.localStorage.length).toBe(0);
    expect(celebration()).toBeNull();
  });
});

/** A page under the shell that opens the dialog the way the badge switch does. */
function BadgeSwitchProbe() {
  const open = useOpenReferralDialog();
  return (
    <button type="button" data-testid="probe" data-has={open ? 'yes' : 'no'} onClick={() => open?.('badge_switch')}>
      share
    </button>
  );
}

describe('AdminShell: the dialog, from a page', () => {
  it('pages under the shell open the same dialog, from the badge switch', async () => {
    await mount(shell({ page: <BadgeSwitchProbe /> }));
    const probe = document.querySelector<HTMLElement>('[data-testid="probe"]')!;
    expect(probe.dataset.has).toBe('yes');
    await act(async () => probe.click());
    expect(document.querySelector('[data-testid="referral-modal"]')).not.toBeNull();
    expect(nav.events).toEqual([['referral_dialog_opened', { surface: 'badge_switch' }]]);
  });

  it('with the program off, pages get no opener (and offer no Share)', async () => {
    await mount(shell({ referral: null, page: <BadgeSwitchProbe /> }));
    expect(document.querySelector<HTMLElement>('[data-testid="probe"]')!.dataset.has).toBe('no');
  });
});

const reviews = (html: string) =>
  [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll<HTMLAnchorElement>('[data-testid="nav-product-hunt"]')];

describe('AdminShell: the Product Hunt review row', () => {
  it('on a Dapta build: under the referral entry, in the rail and the drawer, an external link', () => {
    const html = renderToStaticMarkup(shell({ productHunt: true }));
    const rows = reviews(html);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.tagName).toBe('A');
      expect(row.getAttribute('href')).toBe(PRODUCT_HUNT_REVIEW_URL);
      expect(row.getAttribute('target')).toBe('_blank');
      expect(row.getAttribute('rel')).toBe('noopener noreferrer');
      expect(row.getAttribute('title')).toBe('Like dForms? Review us on Product Hunt');
      expect(accessibleName(row)).toBe('Like dForms? Review on Product Hunt (opens in a new tab)');
      expect(row.querySelector('.pi-external-link')).not.toBeNull();
      // The mark in its own colours.
      expect(row.querySelector('svg circle')!.getAttribute('fill')).toBe('#DA552F');
      // Right after "Remove badge".
      expect(row.parentElement!.previousElementSibling!.querySelector('[data-testid="nav-referral"]')).not.toBeNull();
    }
    expect(PRODUCT_HUNT_REVIEW_URL).toBe('https://www.producthunt.com/products/dforms/reviews/new');
  });

  it('in Spanish', () => {
    const [row] = reviews(renderToStaticMarkup(shell({ productHunt: true, locale: 'es' })));
    expect(row!.getAttribute('title')).toBe('¿Te gusta dForms? Déjanos una reseña en Product Hunt');
    expect(accessibleName(row!)).toBe('¿Te gusta dForms? Reseña en Product Hunt (se abre en una pestaña nueva)');
  });

  it('five filled orange stars under the label, hidden from assistive tech; the label in semibold', () => {
    for (const locale of ['en', 'es'] as const) {
      for (const row of reviews(renderToStaticMarkup(shell({ productHunt: true, locale })))) {
        const stars = row.querySelector<HTMLElement>('[data-testid="nav-product-hunt-stars"]')!;
        expect(stars).not.toBeNull();
        expect(stars.getAttribute('aria-hidden')).toBe('true');
        const paths = [...stars.querySelectorAll('svg path')];
        expect(paths).toHaveLength(5);
        for (const p of paths) expect(p.getAttribute('fill')).toBe('#DA552F');
        // Under the label, inside the text column.
        expect(stars.previousElementSibling!.className).toContain('font-semibold');
        // Taller than its neighbours.
        expect(row.className).toContain('py-3');
        expect(row.className).not.toContain('py-2.5');
      }
    }
    // The name stays the words.
    const [row] = reviews(renderToStaticMarkup(shell({ productHunt: true })));
    expect(accessibleName(row!)).toBe('Like dForms? Review on Product Hunt (opens in a new tab)');
  });

  it('collapsed to the 64px rail: the mark alone, the full sentence as tooltip and name', () => {
    const [desktop] = reviews(renderToStaticMarkup(shell({ productHunt: true, collapsed: true })));
    expect(desktop!.querySelector('.pi-external-link')).toBeNull();
    expect(desktop!.querySelector('[data-testid="nav-product-hunt-stars"]')).toBeNull();
    expect(desktop!.querySelector('svg')).not.toBeNull();
    expect(desktop!.getAttribute('title')).toBe('Like dForms? Review us on Product Hunt');
    expect(accessibleName(desktop!)).toBe('Like dForms? Review us on Product Hunt (opens in a new tab)');
  });

  it('hidden on a fork, which is what a build without the Dapta name is', () => {
    expect(reviews(renderToStaticMarkup(shell()))).toHaveLength(0);
    expect(reviews(renderToStaticMarkup(shell({ productHunt: false })))).toHaveLength(0);
  });

  it('does not depend on the referral program', () => {
    expect(reviews(renderToStaticMarkup(shell({ productHunt: true, referral: null })))).toHaveLength(2);
  });

  it('records the click', async () => {
    await mount(shell({ productHunt: true }));
    const row = document.querySelector<HTMLAnchorElement>('[data-testid="nav-product-hunt"]')!;
    row.addEventListener('click', (e) => e.preventDefault(), { once: true });
    await act(async () => row.click());
    expect(nav.events).toEqual([['product_hunt_review_clicked', { collapsed: false }]]);
  });
});
