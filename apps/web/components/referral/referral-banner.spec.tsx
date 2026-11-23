// @vitest-environment happy-dom
/**
 * The referral program's top banner: a thin strip that names the badge by
 * showing a replica of the real pill (mark + `growth.madeWith`), crossed out
 * by a fire line that grows with the count; a "?" that opens a popover with a
 * mini form; the progress bar to the flag; and Copy link, Share and close.
 * Closing it hides it at once and tells the API (7 days, per person).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@quill/shared';

const calls = vi.hoisted(() => ({ events: [] as [string, unknown][], dismissed: 0 }));
vi.mock('@/lib/product-analytics', () => ({
  captureEvent: (event: string, props?: unknown) => calls.events.push([event, props]),
}));
// The real mark, swapped for a marker: which artwork it draws depends on the build.
vi.mock('@/components/brand/brand', () => ({
  BrandMark: ({ className }: { className?: string }) => <svg data-testid="brand-mark" className={className} />,
}));
vi.mock('@/app/admin/referral-actions', () => ({
  dismissReferralBanner: async () => {
    calls.dismissed += 1;
    return { ok: true };
  },
}));

import { ReferralBanner } from './referral-banner';

const LINK = 'https://landing.example.test/?ref=abc23def';

let root: Root | null = null;
let host: HTMLElement | null = null;
let writeText: ReturnType<typeof vi.fn>;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  calls.events = [];
  calls.dismissed = 0;
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(opts: { locale?: Locale; count?: number; onShare?: () => void } = {}) {
  const m = getMessages(opts.locale ?? 'en');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ReferralBanner
        link={LINK}
        count={opts.count ?? 0}
        goal={5}
        badgeLabel={m.growth.madeWith}
        m={m.admin.chrome.referral}
        onShare={opts.onShare ?? (() => {})}
      />,
    ),
  );
  return (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

describe('ReferralBanner: the level', () => {
  it('at 0 of 5: cold, the pill not crossed out, the bar a sliver', async () => {
    const q = await mount({ count: 0 });
    const strip = q('referral-banner')!;
    expect(strip.dataset.heat).toBe('cold');
    expect(strip.dataset.count).toBe('0');
    expect(q('referral-banner-pill')!.dataset.strike).toBe('0');
    expect(q('referral-banner-long')!.textContent).toBe('Invite 5 people and remove Made with dForms from your forms, for free');
    expect(q('referral-banner-track')!.getAttribute('aria-label')).toBe('0 of 5 referrals');
  });

  it('at 3 of 5: warm, the pill 58% crossed out, the bar at 60%', async () => {
    const q = await mount({ count: 3 });
    expect(q('referral-banner')!.dataset.heat).toBe('warm');
    expect(q('referral-banner-pill')!.dataset.strike).toBe('58');
    expect(q('referral-banner-pill')!.style.getPropertyValue('--rb-strike')).toBe('58%');
    expect(q('referral-banner-fill')!.style.width).toBe('60%');
    expect(q('referral-banner-long')!.textContent).toBe('2 to go to remove Made with dForms from your forms');
    expect(q('referral-banner-short')!.textContent).toBe('2 to go: Made with dForms');
  });

  it('at 4 of 5: hot, the pill 80% crossed out and sizzling', async () => {
    const q = await mount({ count: 4 });
    expect(q('referral-banner')!.dataset.heat).toBe('hot');
    expect(q('referral-banner-pill')!.dataset.strike).toBe('80');
    expect(q('referral-banner-fill')!.style.width).toBe('80%');
    expect(q('referral-banner-long')!.textContent).toBe('Just 1 to go to remove Made with dForms for good!');
  });

  it('the strike grows with every referral', async () => {
    const strikes: number[] = [];
    for (const count of [0, 1, 2, 3, 4]) {
      const q = await mount({ count });
      strikes.push(Number(q('referral-banner-pill')!.dataset.strike));
      await act(async () => root!.unmount());
      host!.remove();
      root = null;
    }
    expect(strikes).toEqual([0, 18, 38, 58, 80]);
  });

  it('the pill is the real one: the dForms mark and the localized label', async () => {
    const q = await mount({ locale: 'es', count: 3 });
    const pill = q('referral-banner-pill')!;
    expect(pill.querySelector('[data-testid="brand-mark"]')).not.toBeNull();
    expect(pill.textContent).toBe('Hecho con dForms');
    expect(q('referral-banner-long')!.textContent).toBe('Te faltan 2 para quitar Hecho con dForms de tus formularios');
    expect(q('referral-banner-short')!.textContent).toBe('Faltan 2: Hecho con dForms');
    expect(document.body.textContent).not.toContain('Made with');
  });
});

describe('ReferralBanner: the "?" popover', () => {
  it('opens from the keyboard and closes with Escape, focus back on the button', async () => {
    const q = await mount({ count: 3 });
    const info = q('referral-banner-info') as HTMLButtonElement;
    expect(info.getAttribute('aria-label')).toBe('What is the Made with dForms badge?');
    expect(info.getAttribute('aria-expanded')).toBe('false');
    expect(q('referral-banner-popover')).toBeNull();

    info.focus();
    // A focused button activates on Enter or Space with a click.
    await act(async () => info.click());
    const pop = q('referral-banner-popover')!;
    expect(info.getAttribute('aria-expanded')).toBe('true');
    expect(pop.getAttribute('role')).toBe('dialog');
    expect(pop.getAttribute('aria-label')).toBe('What the badge is');
    expect(info.getAttribute('aria-controls')).toBe(pop.id);
    expect(pop.textContent).toContain('This is the badge.');
    expect(pop.querySelector('[data-testid="referral-banner-mock-pill"]')!.textContent).toBe('Made with dForms');

    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(q('referral-banner-popover')).toBeNull();
    expect(info.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(info);
  });

  it('the button toggles it, and a press outside closes it', async () => {
    const q = await mount();
    const info = q('referral-banner-info')!;
    await act(async () => info.click());
    expect(q('referral-banner-popover')).not.toBeNull();
    await act(async () => info.click());
    expect(q('referral-banner-popover')).toBeNull();

    await act(async () => info.click());
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(q('referral-banner-popover')).toBeNull();
  });
});

describe('ReferralBanner: the actions', () => {
  it('Copy puts the link on the clipboard and records it from the banner', async () => {
    const q = await mount();
    await act(async () => q('referral-banner-copy')!.click());
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(calls.events).toEqual([['referral_link_copied', { surface: 'banner' }]]);
    expect(q('referral-banner-copy')!.getAttribute('aria-label')).toBe('Copied');
  });

  it('a clipboard that refuses opens the share modal instead, recording nothing', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    const onShare = vi.fn();
    const q = await mount({ onShare });
    await act(async () => q('referral-banner-copy')!.click());
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(calls.events).toEqual([]);
  });

  it('Share opens the share modal', async () => {
    const onShare = vi.fn();
    const q = await mount({ onShare });
    await act(async () => q('referral-banner-share')!.click());
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it('close hides it at once, tells the API and records the dismissal', async () => {
    const q = await mount({ count: 3 });
    const close = q('referral-banner-close')!;
    expect(close.getAttribute('aria-label')).toBe('Close banner');
    await act(async () => close.click());
    expect(q('referral-banner')).toBeNull();
    expect(calls.dismissed).toBe(1);
    expect(calls.events).toEqual([['referral_banner_dismissed', { count: 3 }]]);
  });

  it('every button is named, in Spanish too', async () => {
    const q = await mount({ locale: 'es' });
    expect(q('referral-banner-copy')!.getAttribute('aria-label')).toBe('Copiar mi link');
    expect(q('referral-banner-share')!.getAttribute('aria-label')).toBe('Compartir');
    expect(q('referral-banner-close')!.getAttribute('aria-label')).toBe('Cerrar banner');
    expect(q('referral-banner-info')!.getAttribute('aria-label')).toBe('¿Qué es el sello Hecho con dForms?');
  });
});

describe('ReferralBanner: motion', () => {
  const css = readFileSync(join(__dirname, 'referral-banner.css'), 'utf8');
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));

  it('animates with CSS only, and every animated rule stops under reduced motion', () => {
    const animated = [...css.matchAll(/([^{}]+)\{[^{}]*\banimation:\s*(?!none)[^;}]+/g)]
      .map((m) => m[1]!.trim())
      .filter((sel) => !sel.startsWith('@') && !/^(from|to|\d+%)/.test(sel));
    expect(animated.length).toBeGreaterThan(4);
    expect(reduced).toMatch(/animation:\s*none/);
    for (const rule of animated) {
      for (const sel of rule.split(',').map((s) => s.trim())) {
        const cls = sel.match(/\.rb-[a-z-]+/g)!.at(-1)!;
        expect(reduced, `${sel} keeps moving`).toContain(cls);
      }
    }
  });

  it('lays out by container query: short copy below 1024 px, icon-only buttons below 600 px', () => {
    expect(css).toContain('container-type: inline-size');
    expect(css).toMatch(/@container rb \(max-width: 1023\.98px\) \{\s*\.rb-long \{\s*display: none;/);
    expect(css).toMatch(/@container rb \(max-width: 599\.98px\) \{[^@]*\.rb-btn-label \{\s*display: none;/);
  });
});
