// @vitest-environment happy-dom
/**
 * The mobile top bar (<768px) shows the product's brand ONCE: the wordmark
 * from 360px up, the mark alone below that, on every admin page.
 *
 * It used to read "F Forms F" on any build that is not Dapta's (a fork, or a
 * local `next start` without `NEXT_PUBLIC_PRODUCT_NAME`). The bar put its
 * responsive classes (`hidden min-[360px]:block`, `min-[360px]:hidden`) on
 * `BrandWordmark` and `BrandMark` themselves, and their fork fallbacks (the
 * letter chip plus the name) do not take `className`, so both rendered at every
 * width. Dapta's own build passes the classes to its SVGs and was unaffected.
 * The classes now live on wrappers the shell owns, whatever the brand renders.
 *
 * happy-dom does no layout and loads no Tailwind, so `shown` reads the four
 * utilities the bar uses; the Playwright captures at 390px and 340px on both
 * builds are the visual check.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';

const brand = vi.hoisted(() => ({ dapta: false }));
vi.mock('@/lib/product-name', () => ({
  get IS_DAPTA_BRAND() {
    return brand.dapta;
  },
  get PRODUCT_NAME() {
    return brand.dapta ? 'dForms' : 'Forms';
  },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/playbooks/calificador-claude',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/app/admin/announcement-actions', () => ({ recordAnnouncementAction: async () => ({ ok: true }) }));
vi.mock('@/app/admin/referral-actions', () => ({
  dismissReferralBanner: async () => ({ ok: true }),
  readReferralProgress: async () => null,
}));
vi.mock('@/lib/product-analytics', () => ({ captureEvent: () => {} }));

import { AdminShell } from './admin-shell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = getMessages('en').admin;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  brand.dapta = false;
});

function mountBar(): HTMLElement {
  act(() =>
    root.render(
      <AdminShell
        user={{ displayName: 'Alex Rivera', email: 'alex@example.com' }}
        messages={m.chrome}
        accountNav={m.account.nav}
        initialCollapsed={false}
        workspaces={[]}
        currentAccountId="acc-1"
      >
        <p>page</p>
      </AdminShell>,
    ),
  );
  return host.querySelector<HTMLElement>('header')!;
}

const classes = (el: Element) => el.getAttribute('class')?.split(/\s+/) ?? [];

/** Whether the bar's utilities display `el` at `width` (the bar only exists under 768px). */
function shown(el: Element, width: number): boolean {
  const c = classes(el);
  if (width >= 360) {
    if (c.includes('min-[360px]:hidden')) return false;
    if (c.includes('min-[360px]:flex') || c.includes('min-[360px]:block')) return true;
  }
  return !c.includes('hidden');
}

/** What the bar shows besides the hamburger, at `width`. */
function brandAt(bar: HTMLElement, width: number): Element[] {
  return [...bar.children].filter((el) => el.tagName !== 'BUTTON' && shown(el, width));
}

describe.each([
  { name: 'a fork build (fallback chip)', dapta: false },
  { name: "Dapta's build (SVG marks)", dapta: true },
])('mobile top bar brand on $name', ({ dapta }) => {
  beforeEach(() => {
    brand.dapta = dapta;
  });

  it('shows the wordmark once from 360px up', () => {
    const bar = mountBar();
    for (const width of [360, 390, 767]) {
      const visible = brandAt(bar, width);
      expect(visible).toHaveLength(1);
      expect(visible[0]!.getAttribute('data-testid')).toBe('mobile-brand-wordmark');
    }
    if (!dapta) expect(bar.querySelector('[data-testid="mobile-brand-wordmark"]')!.textContent).toBe('FForms');
  });

  it('shows the mark alone below 360px', () => {
    const bar = mountBar();
    for (const width of [320, 359]) {
      const visible = brandAt(bar, width);
      expect(visible).toHaveLength(1);
      expect(visible[0]!.getAttribute('data-testid')).toBe('mobile-brand-mark');
    }
    if (!dapta) expect(bar.querySelector('[data-testid="mobile-brand-mark"]')!.textContent).toBe('F');
  });

  it('keeps the responsive classes on the wrappers, never on the marks', () => {
    const bar = mountBar();
    for (const wrapper of bar.querySelectorAll('[data-testid^="mobile-brand-"]')) {
      for (const inner of wrapper.querySelectorAll('*')) {
        expect(classes(inner).filter((c) => c === 'hidden' || c.startsWith('min-[360px]:'))).toEqual([]);
      }
    }
  });
});
