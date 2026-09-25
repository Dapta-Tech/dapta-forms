import { describe, expect, it } from 'vitest';
import { encode } from 'uqr';
import { QR_EXPORT_PX, finishSvg, qrFilename, qrSvg } from './qr-code';

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
