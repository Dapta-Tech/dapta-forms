import { describe, expect, it } from 'vitest';
import { encode } from 'uqr';
import { QR_EXPORT_PX, finishSvg, logoTileModules, qrFilename, qrSvg } from './qr-code';

const URL_ = 'http://localhost:3400/acme/f/tech-week-signup';

describe('qrSvg', () => {
  it('carries a viewBox AND an explicit size, which Safari needs to draw it at all', () => {
    const svg = qrSvg(URL_);
    const root = svg.match(/<svg\b[^>]*>/)?.[0] ?? '';
    expect(root).toContain('viewBox=');
    expect(root).toContain(`width="${QR_EXPORT_PX}"`);
    expect(root).toContain(`height="${QR_EXPORT_PX}"`);
  });

  it('asks for hard edges, so the 1024 px PNG has no grey seams between modules', () => {
    expect(qrSvg(URL_).match(/<svg\b[^>]*>/)?.[0]).toContain('shape-rendering="crispEdges"');
  });

  it('sizes to whatever it is asked for', () => {
    const root = qrSvg(URL_, 256).match(/<svg\b[^>]*>/)?.[0] ?? '';
    expect(root).toContain('width="256"');
    expect(root).not.toContain(`width="${QR_EXPORT_PX}"`);
  });

  it('paints dark modules on a white ground, never the other way round', () => {
    const svg = qrSvg(URL_);
    expect(svg).toContain('fill="white"');
    expect(svg).toContain('fill="black"');
  });

  it('encodes at ECC M with a four module quiet zone', () => {
    // The viewBox is (modules + 2 * border) * 10 wide in uqr's output, so the
    // quiet zone is pinned by comparing against the bare module count.
    const { size } = encode(URL_, { ecc: 'M', border: 0 });
    const side = Number(qrSvg(URL_).match(/viewBox="0 0 (\d+) \d+"/)?.[1]);
    expect(side).toBe((size + 2 * 4) * 10);
  });

  it('is a pure function of the URL: the same link always prints the same code', () => {
    expect(qrSvg(URL_)).toBe(qrSvg(URL_));
    expect(qrSvg(URL_)).not.toBe(qrSvg(`${URL_}-2`));
  });
});

describe('qrSvg with the product mark', () => {
  const withLogo = qrSvg(URL_, QR_EXPORT_PX, { logo: true });

  it('is off unless asked for: a build without the brand prints a plain code', () => {
    expect(qrSvg(URL_)).not.toContain('qr-logo-brush');
    expect(qrSvg(URL_, QR_EXPORT_PX, { logo: false })).toBe(qrSvg(URL_));
  });

  it('encodes at ECC H, because the mark covers modules the reader must recover', () => {
    const { size } = encode(URL_, { ecc: 'H', border: 0 });
    const side = Number(withLogo.match(/viewBox="0 0 (\d+) \d+"/)?.[1]);
    expect(side).toBe((size + 2 * 4) * 10);
    // Same link, denser code than the plain one: the cost of the logo.
    expect(size).toBeGreaterThan(encode(URL_, { ecc: 'M', border: 0 }).size);
  });

  it('cuts the white tile on the module grid, centred on the code', () => {
    const { size } = encode(URL_, { ecc: 'H', border: 0 });
    const tile = withLogo.match(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="white"\/>/);
    expect(tile).not.toBeNull();
    const [x, y, w, h] = tile!.slice(1).map(Number) as [number, number, number, number];
    expect(x).toBe(y);
    expect(w).toBe(h);
    expect(x % 10).toBe(0);
    expect(w % 10).toBe(0);
    // Centred: the same margin on both sides of the full (quiet zone included) side.
    expect(x + w + x).toBe((size + 2 * 4) * 10);
  });

  it('keeps the tile to a quarter of the side, well inside what H can lose', () => {
    for (const modules of [21, 25, 29, 33, 37, 41, 45, 49, 57, 77, 177]) {
      const k = logoTileModules(modules);
      expect(k % 2).toBe(1);
      expect(k).toBeGreaterThanOrEqual(5);
      expect(k / modules).toBeLessThanOrEqual(0.25);
    }
  });

  it('draws the mark with smooth edges inside a grid drawn with hard ones', () => {
    expect(withLogo.match(/<svg\b[^>]*>/)?.[0]).toContain('shape-rendering="crispEdges"');
    expect(withLogo).toContain('shape-rendering="geometricPrecision"');
  });

  it('is self-contained: nothing in it points outside the file', () => {
    expect(withLogo).not.toMatch(/href=|url\((?!#qr-logo-brush\))/);
    expect(withLogo.trimEnd().endsWith('</svg>')).toBe(true);
  });
});

describe('finishSvg', () => {
  it('adds width, height and crisp edges to a root that only has a viewBox', () => {
    const out = finishSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>',
      64,
    );
    expect(out).toBe(
      '<svg width="64" height="64" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>',
    );
  });

  it('replaces attributes already on the root instead of doubling them', () => {
    const out = finishSvg(
      '<svg width="10" height="10" shape-rendering="auto" viewBox="0 0 10 10"></svg>',
      32,
    );
    expect(out.match(/width=/g)).toHaveLength(1);
    expect(out.match(/shape-rendering=/g)).toHaveLength(1);
    expect(out).toContain('width="32"');
    expect(out).toContain('height="32"');
  });

  it('leaves the size of child elements alone', () => {
    const out = finishSvg('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>', 32);
    expect(out).toContain('<rect width="10" height="10"/>');
  });
});

describe('qrFilename', () => {
  it('names the file after the form slug', () => {
    expect(qrFilename('tech-week-signup', 'png')).toBe('tech-week-signup-qr.png');
    expect(qrFilename('tech-week-signup', 'svg')).toBe('tech-week-signup-qr.svg');
  });

  it('still produces a usable name when the slug is empty', () => {
    expect(qrFilename('', 'png')).toBe('form-qr.png');
  });
});
