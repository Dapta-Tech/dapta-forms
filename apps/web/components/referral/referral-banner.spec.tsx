// @vitest-environment happy-dom
/**
 * The referral program's top banner: a thin strip that names the badge by
 * showing a replica of the real pill (mark + `growth.madeWith`), crossed out
 * by a fire line that grows with the count; the progress bar to the flag; ONE
 * call to action, "Remove the badge", that opens the referral dialog, and a
 * "?" that opens the same dialog; and close. Closing it hides it at once and
 * tells the API (7 days, per person). It follows the app's theme through the
 * semantic tokens, with a dForms green beam running round its edge.
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

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  calls.events = [];
  calls.dismissed = 0;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(opts: { locale?: Locale; count?: number; onOpen?: (from: string) => void } = {}) {
  const m = getMessages(opts.locale ?? 'en');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ReferralBanner
        count={opts.count ?? 0}
        goal={5}
        badgeLabel={m.growth.madeWith}
        m={m.admin.chrome.referral}
        onOpen={opts.onOpen ?? (() => {})}
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
    expect(q('referral-banner-track-fill')!.style.width).toBe('60%');
    expect(q('referral-banner-track')!.dataset.heat).toBe('warm');
    expect(q('referral-banner-long')!.textContent).toBe('2 to go to remove Made with dForms from your forms');
    expect(q('referral-banner-short')!.textContent).toBe('2 to go: Made with dForms');
  });

  it('at 4 of 5: hot, the pill 80% crossed out and sizzling', async () => {
    const q = await mount({ count: 4 });
    expect(q('referral-banner')!.dataset.heat).toBe('hot');
    expect(q('referral-banner-pill')!.dataset.strike).toBe('80');
    expect(q('referral-banner-track-fill')!.style.width).toBe('80%');
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

describe('ReferralBanner: one call to action, and the "?"', () => {
  it('"Remove the badge" opens the dialog, from the banner', async () => {
    const onOpen = vi.fn();
    const q = await mount({ count: 3, onOpen });
    const cta = q('referral-banner-cta')!;
    expect(cta.getAttribute('aria-label')).toBe('Remove the badge');
    expect(cta.getAttribute('aria-haspopup')).toBe('dialog');
    await act(async () => cta.click());
    expect(onOpen).toHaveBeenCalledWith('banner');
    expect(calls.events).toEqual([]);
  });

  it('the "?" keeps its name and opens the same dialog, told apart as banner_help', async () => {
    const onOpen = vi.fn();
    const q = await mount({ onOpen });
    const info = q('referral-banner-info')!;
    expect(info.getAttribute('aria-label')).toBe('What is the Made with dForms badge?');
    await act(async () => info.click());
    expect(onOpen).toHaveBeenCalledWith('banner_help');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('no Copy, no Share and no popover in the strip any more', async () => {
    const q = await mount({ count: 3 });
    expect(q('referral-banner-copy')).toBeNull();
    expect(q('referral-banner-share')).toBeNull();
    expect(q('referral-banner-popover')).toBeNull();
    expect(q('referral-banner')!.querySelectorAll('button')).toHaveLength(3);
  });

  it('the phone label is one word, in Spanish too', async () => {
    const q = await mount({ locale: 'es' });
    const cta = q('referral-banner-cta')!;
    expect(cta.getAttribute('aria-label')).toBe('Quitar el sello');
    expect(cta.querySelector('.rb-btn-label')!.textContent).toBe('Quitar el sello');
    expect(cta.querySelector('.rb-btn-label-short')!.textContent).toBe('Quitar');
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
    expect(q('referral-banner-close')!.getAttribute('aria-label')).toBe('Cerrar banner');
    expect(q('referral-banner-info')!.getAttribute('aria-label')).toBe('¿Qué es el sello Hecho con dForms?');
  });
});

describe('ReferralBanner: motion', () => {
  const css = readFileSync(join(__dirname, 'referral-banner.css'), 'utf8');
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  const before = css.slice(0, css.indexOf('@media (prefers-reduced-motion: reduce)'));
  /** The body of the first rule whose selector list is exactly `selector`. */
  const rule = (source: string, selector: string) => {
    const at = source.search(new RegExp(`(^|[}\\n])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`));
    expect(at, `${selector} is missing`).toBeGreaterThanOrEqual(0);
    const open = source.indexOf('{', at);
    return source.slice(open + 1, source.indexOf('}', open));
  };

  it('animates with CSS only, and every animated rule stops under reduced motion', () => {
    const animated = [...css.matchAll(/([^{}]+)\{[^{}]*\banimation:\s*(?!none)[^;}]+/g)]
      .map((m) => m[1]!.trim())
      .filter((sel) => !sel.startsWith('@') && !/^(from|to|\d+(\.\d+)?%)/.test(sel));
    expect(animated.length).toBeGreaterThan(5);
    expect(animated).toContain('.rb-beam::before');
    expect(reduced).toMatch(/animation:\s*none/);
    for (const rule of animated) {
      for (const sel of rule.split(',').map((s) => s.trim())) {
        const cls = sel.match(/\.rb-[a-z-]+/g)!.at(-1)!;
        expect(reduced, `${sel} keeps moving`).toContain(cls);
      }
    }
  });

  it('the beam: a registered angle turned by keyframes, a conic gradient masked to a ring', () => {
    expect(css).toMatch(/@property --rb-beam-angle \{\s*syntax: '<angle>';/);
    const beam = rule(before, '.rb-beam');
    expect(beam).toMatch(/position: absolute;/);
    expect(beam).toMatch(/inset: 0;/);
    expect(beam).toMatch(/pointer-events: none;/);
    expect(beam).toMatch(/\bmask:\s*linear-gradient\(#000 0 0\) content-box exclude,\s*linear-gradient\(#000 0 0\);/);
    const ray = rule(before, '.rb-beam::before');
    expect(ray).toMatch(/conic-gradient\(\s*from var\(--rb-beam-angle\)/);
    expect(ray).toMatch(/animation: rb-beam [\d.]+s linear infinite;/);
    expect(css).toMatch(/@keyframes rb-beam \{[^@]*100% \{\s*--rb-beam-angle: 360deg;/);
    // Faster at one to go.
    expect(rule(before, ".rb[data-heat='hot'] .rb-beam::before")).toMatch(/animation-duration: [\d.]+s;/);
  });

  it('reduced motion drops the moving beam and keeps the faint static ring', () => {
    expect(rule(reduced.slice(reduced.indexOf('{') + 1), '.rb .rb-beam')).toMatch(/display: none;/);
    expect(rule(before, '.rb-strip')).toMatch(/box-shadow: inset 0 0 0 1px var\(--rb-ring\);/);
    expect(reduced).not.toContain('.rb-strip');
  });

  it('lays out by container query: short copy below 1024 px, one-word call to action below 600 px', () => {
    expect(css).toContain('container-type: inline-size');
    expect(css).toMatch(/@container rb \(max-width: 1023\.98px\) \{\s*\.rb-long \{\s*display: none;/);
    expect(css).toMatch(/@container rb \(max-width: 599\.98px\) \{[^@]*\.rb-btn-label \{\s*display: none;/);
    expect(css).toMatch(/@container rb \(max-width: 599\.98px\) \{[^@]*\.rb-btn-label-short \{\s*display: inline;/);
  });

  it('the pill never shrinks: only the words around it truncate', () => {
    expect(rule(before, '.rb-badge')).toMatch(/flex: none;/);
    const words = rule(before, '.rb-words');
    expect(words).toMatch(/min-width: 0;/);
    expect(words).toMatch(/text-overflow: ellipsis;/);
    // The bar gives its room up first (basis 0), down to its minimum.
    expect(rule(before, '.rb-track')).toMatch(/flex: 1 1 0;/);
  });
});

describe('ReferralBanner: the theme', () => {
  const css = readFileSync(join(__dirname, 'referral-banner.css'), 'utf8');
  const vars = css.slice(css.indexOf('.rb,\n.rb-theme {'), css.indexOf('}', css.indexOf('.rb,\n.rb-theme {')));

  it('the strip has no hard-coded dark ground: its background resolves through the tokens', () => {
    expect(vars).toMatch(/--rb-bg: var\(--card\);/);
    const strip = css.slice(css.indexOf('.rb-strip {'), css.indexOf('}', css.indexOf('.rb-strip {')));
    expect(strip).toMatch(/background: var\(--rb-bg\);/);
    expect(strip).toMatch(/color: var\(--rb-ink\);/);
    expect(vars).toMatch(/--rb-ink: var\(--foreground\);/);
  });

  it('no surface, line or letter is a fixed colour: no white washes, no dark hex', () => {
    // White at low alpha only reads on a dark ground; a dark hex only on a light one.
    expect(css).not.toMatch(/rgba\(255,\s*255,\s*255/);
    expect(css).not.toMatch(/#(1a1a1c|222225|2a2a2f|2e2e33|141416|3a3a40)\b/i);
    for (const prop of ['background', 'color', 'border', 'border-color']) {
      for (const m of css.matchAll(new RegExp(`(?:^|[;{\\s])${prop}:\\s*([^;]+);`, 'g'))) {
        expect(m[1], `${prop}: ${m[1]}`).not.toMatch(/^#[0-9a-f]{3,8}$/i);
      }
    }
  });

  it('the pill is the real one: the public pill\'s own tokens', () => {
    const pill = css.slice(css.indexOf('.rb-pill {'), css.indexOf('}', css.indexOf('.rb-pill {')));
    expect(pill).toMatch(/color: var\(--foreground\);/);
    expect(pill).toMatch(/background: var\(--card\);/);
    expect(pill).toMatch(/border: 1px solid var\(--border\);/);
    expect(pill).toMatch(/border-radius: 999px;/);
  });

  it('the fire hues come from the tokens, so they darken on paper', () => {
    expect(vars).toMatch(/--rb-amber: var\(--warning\);/);
    expect(vars).toMatch(/--rb-gold: color-mix\(in srgb, var\(--warning-ink\)/);
    expect(vars).toMatch(/--rb-coral: color-mix\(in srgb, #f2686c \d+%, var\(--destructive\)\);/);
    expect(vars).toMatch(/--rb-beam: color-mix\(in srgb, var\(--signal\) \d+%, var\(--signal-edge\)\);/);
  });
});
