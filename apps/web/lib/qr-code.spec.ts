import { describe, expect, it } from 'vitest';
import { encode } from 'uqr';
import { QR_EXPORT_PX, qrFilename, qrSvg } from './qr-code';

const URL_ = 'https://forms.dapta.ai/acme/me/tech-week-signup';

describe('qrSvg', () => {
  it('carries a viewBox AND an explicit size, which Safari needs to draw it at all', () => {
    const svg = qrSvg(URL_);
    const root = svg.match(/<svg\b[^>]*>/)?.[0] ?? '';
    expect(root).toContain('viewBox=');
    expect(root).toContain(`width="${QR_EXPORT_PX}"`);
    expect(root).toContain(`height="${QR_EXPORT_PX}"`);
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

describe('qrFilename', () => {
  it('names the file after the form slug', () => {
    expect(qrFilename('tech-week-signup', 'png')).toBe('tech-week-signup-qr.png');
    expect(qrFilename('tech-week-signup', 'svg')).toBe('tech-week-signup-qr.svg');
  });

  it('still produces a usable name when the slug is empty', () => {
    expect(qrFilename('', 'png')).toBe('form-qr.png');
  });
});
