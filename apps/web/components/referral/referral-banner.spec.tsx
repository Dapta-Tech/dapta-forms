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
    expect(q('referral-banner-long')!.textContent).toBe('Invite 5 people and remove Made with dForms from your forms, for free!');
    expect(q('referral-banner-track')!.getAttribute('aria-label')).toBe('0 of 5 referrals');
  });

  it('at 0 of 5 in Spanish, "gratis" is exclaimed the Spanish way: ¡gratis!', async () => {
    const q = await mount({ locale: 'es', count: 0 });
    const badge = getMessages('es').growth.madeWith;
    expect(q('referral-banner-long')!.textContent).toBe(`Invita a 5 personas y quita ${badge} de tus formularios, ¡gratis!`);
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

  /** The rules inside the reduced-motion block: each selector list and its body. */
  const reducedRules = [...reduced.slice(reduced.indexOf('{') + 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!.split(',').map((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').trim()),
    body: m[2]!,
  }));
  /**
   * Whether the reduced-motion block stops `compound` (the last part of an
   * animated selector, its attribute filters dropped, like `.rb-track::before`):
   * a rule ending in it sets `animation: none` or hides it, or one hides its host.
   */
  const stopped = (compound: string) => {
    const host = compound.replace(/::?[a-z-]+$/, '');
    return reducedRules.some(
      ({ selectors, body }) =>
        (selectors.some((s) => s.endsWith(compound)) && /animation: none|display: none/.test(body)) ||
        (selectors.some((s) => s.endsWith(host)) && /display: none/.test(body)),
    );
  };

  it('animates with CSS only, and every animated rule stops under reduced motion', () => {
    const animated = [...css.matchAll(/([^{}]+)\{[^{}]*\banimation:\s*(?!none)[^;}]+/g)]
      .map((m) => m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim())
      .filter((sel) => !sel.startsWith('@') && !/^(from|to|\d+(\.\d+)?%)/.test(sel));
    expect(animated.length).toBeGreaterThan(8);
    // The new motion is in the list: the beam, the cold dot's halo, the shimmer.
    expect(animated).toContain('.rb-beam::before');
    expect(animated).toContain("[data-heat='cold'] .rb-dot");
    expect(animated).toContain(".rb-track[data-heat='cold']::before");
    expect(reduced).toMatch(/animation:\s*none/);
    for (const rule of animated) {
      for (const sel of rule.split(',').map((s) => s.trim())) {
        const compound = sel.split(/\s+/).at(-1)!.replace(/\[[^\]]*\]/g, '');
        expect(compound, sel).toMatch(/^\.rb-[a-z-]+(::?[a-z-]+)?$/);
        expect(stopped(compound), `${sel} keeps moving`).toBe(true);
      }
    }
  });

  it('at 0 the dot glows green with a pulsing halo, and a shimmer runs to the flag', () => {
    const dot = rule(before, "[data-heat='cold'] .rb-dot");
    expect(dot).toMatch(/background: var\(--rb-green\);/);
    expect(dot).toMatch(/var\(--rb-halo\)/);
    expect(dot).toMatch(/animation: rb-halo [\d.]+s ease-out infinite;/);
    const shimmer = rule(before, ".rb-track[data-heat='cold']::before");
    expect(shimmer).toMatch(/linear-gradient\(90deg, transparent, var\(--rb-shimmer\), transparent\)/);
    expect(shimmer).toMatch(/animation: rb-shimmer [\d.]+s ease-in-out infinite;/);
    expect(css).toMatch(/@keyframes rb-shimmer \{[^@]*to \{\s*background-position: 1\d\d% 0;/);
    // The track is a faint green road, never the flat grey wash.
    expect(rule(before, '.rb-track')).toMatch(/background: var\(--rb-track\);/);
    // The fire hues still own 1 to 4.
    expect(rule(before, "[data-heat='warm'] .rb-dot")).toMatch(/background: var\(--rb-gold\);/);
    expect(rule(before, "[data-heat='hot'] .rb-dot")).toMatch(/background: var\(--rb-coral\);/);
  });

  it('reduced motion keeps the cold dot green and its halo still, and drops the shimmer', () => {
    expect(stopped('.rb-dot')).toBe(true);
    expect(stopped('.rb-track::before')).toBe(true);
    expect(reducedRules.some(({ selectors, body }) => selectors.includes('.rb-track::before') && /display: none/.test(body))).toBe(
      true,
    );
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
    expect(ray).toMatch(/animation: rb-beam-spin [\d.]+s linear infinite;/);
    expect(css).toMatch(/@keyframes rb-beam-spin \{[^@]*to \{\s*--rb-beam-angle: 360deg;/);
    // The strip's shape: the squashed square and the even-pace keyframes.
    const strip = rule(before, '.rb-beam-strip::before');
    expect(strip).toMatch(/scaleY\(tan\(atan2\(48px, 100cqw\)\)\)/);
    expect(strip).toMatch(/animation-name: rb-beam;/);
    expect(css).toMatch(/@keyframes rb-beam \{[^@]*100% \{\s*--rb-beam-angle: 360deg;/);
    // The dialog's shape: a centred square that covers the box.
    expect(rule(before, '.rb-beam-box::before')).toMatch(/transform: translate\(-50%, -50%\);/);
    // Faster at one to go.
    expect(rule(before, ".rb[data-heat='hot'] .rb-beam::before")).toMatch(/animation-duration: [\d.]+s;/);
  });

  it('the beam is double: two identical heads exactly half a lap apart', () => {
    const gradient = rule(before, '.rb-beam::before').match(/conic-gradient\(([\s\S]*?)\);/)![1]!;
    // The stops, split on the top-level commas (color-mix nests its own).
    const parts: string[] = [];
    let depth = 0;
    let part = '';
    for (const ch of gradient) {
      if (ch === ',' && depth === 0) {
        parts.push(part.trim());
        part = '';
        continue;
      }
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      part += ch;
    }
    parts.push(part.trim());
    const stops = parts
      .map((p) => p.match(/^(.*\S) ([\d.]+)deg$/))
      .filter((m): m is RegExpMatchArray => m !== null && !m[1]!.startsWith('transparent'))
      .map((m) => [m[1]!, Number(m[2])] as const);
    const lit = stops.filter(([, at]) => at < 180);
    const second = stops.filter(([, at]) => at >= 180);
    expect(lit.length).toBe(4);
    expect(second.map(([c, at]) => [c, at - 180])).toEqual(lit);
    // Each head's bright core is there, once per head.
    expect(gradient.match(/var\(--rb-beam-core\)/g)).toHaveLength(2);
  });

  it('the banner wears the strip beam', async () => {
    const q = await mount({ count: 3 });
    const beam = q('referral-banner-beam')!;
    expect(beam.className).toBe('rb-beam rb-beam-strip');
    expect(beam.getAttribute('aria-hidden')).toBe('true');
  });

  it('reduced motion drops the moving beam and keeps the faint static ring', () => {
    expect(rule(reduced.slice(reduced.indexOf('{') + 1), '.rb-beam')).toMatch(/display: none;/);
    expect(rule(before, '.rb-strip')).toMatch(/box-shadow: inset 0 0 0 1px var\(--rb-ring\);/);
    expect(reduced).not.toContain('.rb-strip');
    // The dialog's green border, its static ring, is outside the block too.
    expect(rule(before, '.rb-dialog')).toMatch(/border: 1px solid color-mix\(in srgb, var\(--signal\)/);
    expect(reduced).not.toContain('.rb-dialog');
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

  it('the pill is the real one: its shape, on the neutral card ground with the normal border', () => {
    const pill = css.slice(css.indexOf('.rb-pill {'), css.indexOf('}', css.indexOf('.rb-pill {')));
    expect(pill).toMatch(/border-radius: 999px;/);
    expect(pill).toMatch(/color: var\(--foreground\);/);
    expect(pill).toMatch(/background: var\(--card\);/);
    expect(pill).toMatch(/border: 1px solid var\(--border\);/);
    // No green fill anywhere it renders (banner, dialog mock, celebration, switch).
    expect(css).not.toContain('rb-chip');
    for (const m of css.matchAll(/(^|\n)([^{}\n]*\.rb-pill[^{}]*)\{([^{}]*)\}/g)) {
      expect(m[3], m[2]).not.toMatch(/background[^;]*--signal/);
    }
  });

  it('the strip is a soft green bar: dForms green mixed into the card, a touch more on ink', () => {
    const rb = css.slice(css.indexOf('\n.rb {'), css.indexOf('}', css.indexOf('\n.rb {')));
    expect(rb).toMatch(/--rb-tint: (8|9|1[0-2])%;/);
    expect(rb).toMatch(/--rb-bg: color-mix\(in srgb, var\(--signal\) var\(--rb-tint\), var\(--card\)\);/);
    const dark = css.match(/\[data-theme='dark'\] \.rb \{\s*--rb-tint: (\d+)%;/);
    expect(dark).not.toBeNull();
    expect(Number(dark![1])).toBeGreaterThan(Number(rb.match(/--rb-tint: (\d+)%/)![1]));
    expect(Number(dark![1])).toBeLessThanOrEqual(16);
    // The dialog and the celebration keep the plain card.
    expect(vars).toMatch(/--rb-bg: var\(--card\);/);
  });

  it('the green bar keeps every letter at 4.5:1 or more, in both themes', () => {
    const tokens = readFileSync(join(__dirname, '../../../../packages/shared/src/tokens.css'), 'utf8');
    const block = (theme: string) => tokens.slice(tokens.indexOf(`[data-theme='${theme}'] {`), tokens.indexOf('}', tokens.indexOf(`[data-theme='${theme}'] {`)));
    const token = (b: string, name: string) => {
      const hex = b.match(new RegExp(`--${name}: (#[0-9a-f]{6});`, 'i'));
      expect(hex, name).not.toBeNull();
      return [1, 3, 5].map((i) => parseInt(hex![1]!.slice(i, i + 2), 16));
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (a: number[], b: number[]) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    const light = Number(css.match(/\n\.rb \{[^}]*--rb-tint: (\d+)%;/)![1]) / 100;
    const dark = Number(css.match(/\[data-theme='dark'\] \.rb \{\s*--rb-tint: (\d+)%;/)![1]) / 100;
    for (const [theme, tint] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      const b = block(theme);
      const signal = token(b, 'signal');
      const card = token(b, 'card');
      const ground = signal.map((s, i) => s * tint + card[i]! * (1 - tint));
      for (const ink of ['foreground', 'muted-foreground']) {
        expect(ratio(token(b, ink), ground), `${theme} ${ink}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('the fire hues come from the tokens, so they darken on paper', () => {
    expect(vars).toMatch(/--rb-amber: var\(--warning\);/);
    expect(vars).toMatch(/--rb-gold: color-mix\(in srgb, var\(--warning-ink\)/);
    expect(vars).toMatch(/--rb-coral: color-mix\(in srgb, #f2686c \d+%, var\(--destructive\)\);/);
    expect(vars).toMatch(/--rb-beam: color-mix\(in srgb, var\(--signal\) \d+%, var\(--signal-edge\)\);/);
  });
});
