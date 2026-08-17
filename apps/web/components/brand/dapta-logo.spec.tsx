/**
 * The parent mark's two invariants: it is TWO-TONE the right way round, and its
 * viewBox is cropped to the ink.
 *
 * Both are the kind of thing a well-meaning edit undoes silently. Flattening the
 * bowl to a literal hex still looks correct on the light form it was checked on
 * and disappears on a dark one; pasting the source file's 279×298 viewBox back
 * still renders a `d`, just at half the height every call site asked for.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DaptaMark } from './dapta-logo';

const markup = (props?: { title?: string; className?: string }) =>
  renderToStaticMarkup(<DaptaMark {...props} />);

/** Every `d="…"` in the rendered mark. */
function paths(svg: string): string[] {
  return [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]!);
}

/**
 * Bounding box of an SVG path, walking the commands this artwork actually uses
 * (M, H, L, C, Z) so that H's single x is not mistaken for an x/y pair. Control
 * points count: a Bézier never leaves its hull, so the hull is a safe over-
 * estimate — which is the direction that matters for asserting a tight crop.
 */
function bounds(d: string) {
  const tokens = d.match(/[MHLCZ]|-?\d*\.?\d+/gi) ?? [];
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const seeX = (v: number) => {
    box.minX = Math.min(box.minX, v);
    box.maxX = Math.max(box.maxX, v);
  };
  const seeY = (v: number) => {
    box.minY = Math.min(box.minY, v);
    box.maxY = Math.max(box.maxY, v);
  };
  let cmd = '';
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/[MHLCZ]/i.test(t)) {
      cmd = t.toUpperCase();
      i += 1;
      continue;
    }
    const n = (k: number) => Number(tokens[i + k]);
    if (cmd === 'H') {
      seeX(n(0));
      i += 1;
    } else if (cmd === 'M' || cmd === 'L') {
      seeX(n(0));
      seeY(n(1));
      i += 2;
    } else if (cmd === 'C') {
      for (let p = 0; p < 6; p += 2) {
        seeX(n(p));
        seeY(n(p + 1));
      }
      i += 6;
    } else {
      i += 1; // V is not used by this artwork; skip anything unexpected
    }
  }
  return box;
}

describe('DaptaMark', () => {
  it('draws the bowl in currentColor and keeps only the tick literal', () => {
    const svg = markup();
    // The bowl must adapt: a literal here is invisible on a form whose ground
    // matches it, and the badge sits on arbitrary host branding.
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain('fill="#cbe84f"');
    // Exactly one of each — not a flat single-colour variant, not a bowl that
    // has quietly become lime too.
    expect(svg.match(/fill="currentColor"/g)).toHaveLength(1);
    expect(svg.match(/fill="#cbe84f"/gi)).toHaveLength(1);
  });

  it('crops the viewBox to the ink, so a CSS height is the height of the glyph', () => {
    const svg = markup();
    const [, x, y, w, h] = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/
      .exec(svg)!
      .map(Number) as [unknown, number, number, number, number];

    const all = paths(svg).map(bounds);
    const ink = {
      minX: Math.min(...all.map((b) => b.minX)),
      minY: Math.min(...all.map((b) => b.minY)),
      maxX: Math.max(...all.map((b) => b.maxX)),
      maxY: Math.max(...all.map((b) => b.maxY)),
    };

    // Nothing clipped…
    expect(ink.minX).toBeGreaterThanOrEqual(x);
    expect(ink.minY).toBeGreaterThanOrEqual(y);
    expect(ink.maxX).toBeLessThanOrEqual(x + w);
    expect(ink.maxY).toBeLessThanOrEqual(y + h);
    // …and no baked-in padding either. The source file pads the same artwork to
    // 279×298, which would leave the ink filling barely half of each axis.
    expect((ink.maxX - ink.minX) / w).toBeGreaterThan(0.98);
    expect((ink.maxY - ink.minY) / h).toBeGreaterThan(0.98);
  });

  it('is decorative by default and only announces itself when labelled', () => {
    // A mark beside visible text sets no title (the badge did, while it carried
    // this one): the text already names the link, and a title would have a
    // screen reader say it twice.
    expect(markup()).toContain('aria-hidden="true"');
    expect(markup()).not.toContain('<title>');

    const labelled = renderToStaticMarkup(<DaptaMark title="Dapta" />);
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('<title>Dapta</title>');
    expect(labelled).not.toContain('aria-hidden');
  });

  it('carries no element ids, so two instances on one page cannot collide', () => {
    expect(markup()).not.toMatch(/\sid="/);
  });

  it('forwards className, since callers size it with CSS', () => {
    expect(markup({ className: 'pf__attribution-mark' })).toContain(
      'class="pf__attribution-mark"',
    );
  });
});
