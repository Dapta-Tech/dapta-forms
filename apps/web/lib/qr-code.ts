import { encode, renderSVG } from 'uqr';
import { QR_LOGO_MARKUP, QR_LOGO_VIEWBOX } from './qr-logo';

/**
 * QR codes for sharing a form in print and on screens.
 *
 * The URL encoded is exactly what Copy link copies, with no UTM parameters, so
 * a scanned code and a pasted link land on the same page. Error correction `M`
 * survives a smudged or partly covered print (about 15% of the code) without
 * making the code dense enough to fail on a phone held at arm's length, and a
 * four module quiet zone is what the spec asks for: scanners find the code by
 * its white margin, and `uqr`'s default of one module is too thin on a
 * busy background.
 *
 * A code that carries the product mark in its centre is a different trade. The
 * mark COVERS modules, on purpose, and what reads the code anyway is the error
 * correction: so those codes are encoded at `H` (about 30% recoverable), the
 * highest there is. It costs density (a typical form link goes from 33 to 41
 * modules a side), which is the price of a logo and still an easy read.
 */
const ECC = 'M';
const ECC_WITH_LOGO = 'H';
const QUIET_ZONE = 4;
/** `uqr` draws every module as a square of this many viewBox units. */
const MODULE = 10;
/**
 * How much of the code's side the logo's white tile may take. A quarter of the
 * side is about 6% of the area: a fifth of what `H` can lose, so a print that
 * is also scuffed or folded still reads.
 */
const LOGO_SHARE = 0.25;

/** Side of the exported files, in pixels. Big enough for a poster. */
export const QR_EXPORT_PX = 1024;

/**
 * Finish `uqr`'s root element for export, the only place the SVG is shaped.
 *
 * - `width` and `height`: `uqr` emits only a `viewBox`, and an `<img>` loading
 *   that from a data URL has no intrinsic size, so Safari draws it at 0 x 0 and
 *   the PNG export comes out as an empty white square. Any size already on the
 *   root is replaced, never doubled.
 * - `shape-rendering="crispEdges"`: modules are drawn as adjacent squares, and
 *   antialiasing leaves grey seams between them when 1024 is not a multiple of
 *   the module count. Hard edges keep the PNG pure black and white.
 */
export function finishSvg(svg: string, px: number): string {
  return svg.replace(/<svg\b([^>]*)>/, (_, attrs: string) => {
    const rest = attrs.replace(/\s(?:width|height|shape-rendering)="[^"]*"/g, '');
    return `<svg width="${px}" height="${px}" shape-rendering="crispEdges"${rest}>`;
  });
}

/**
 * How many modules the logo's tile spans, for a code `modules` wide.
 *
 * Odd, so it centres on the code's centre module (a QR code is always an odd
 * number of modules a side) and its edges fall ON the module grid: the tile
 * removes whole modules and never slices one, which would leave slivers a
 * scanner can read either way.
 */
export function logoTileModules(modules: number): number {
  const k = Math.floor(modules * LOGO_SHARE);
  return Math.max(5, k % 2 === 1 ? k : k - 1);
}

/**
 * The product mark over the centre of a code: a white tile cut on the module
 * grid, and the mark inside it, half a module in from each edge.
 *
 * The mark is a nested `<svg>` so it keeps its own coordinate system, and it
 * opts back out of the root's `crispEdges`: hard edges are right for a grid of
 * squares and wrong for a logo, whose curves would come out stair-stepped.
 */
function logoOverlay(modules: number): string {
  const k = logoTileModules(modules);
  const tile = k * MODULE;
  const at = (QUIET_ZONE + (modules - k) / 2) * MODULE;
  const inset = MODULE / 2;
  const side = tile - inset * 2;
  return (
    `<rect x="${at}" y="${at}" width="${tile}" height="${tile}" fill="white"/>` +
    `<svg x="${at + inset}" y="${at + inset}" width="${side}" height="${side}" ` +
    `viewBox="0 0 ${QR_LOGO_VIEWBOX} ${QR_LOGO_VIEWBOX}" shape-rendering="geometricPrecision">` +
    `${QR_LOGO_MARKUP}</svg>`
  );
}

/**
 * The QR code for `url` as an SVG string, sized and ready to save or rasterize.
 *
 * `logo` puts the product mark in the centre. It is the caller's decision
 * because it is a BRANDING decision: only a build that carries the product's
 * own brand may print its mark on a customer's flyer, and this module, which
 * knows nothing about builds, should not be the one to decide.
 */
export function qrSvg(
  url: string,
  px: number = QR_EXPORT_PX,
  { logo = false }: { logo?: boolean } = {},
): string {
  const ecc = logo ? ECC_WITH_LOGO : ECC;
  const svg = finishSvg(renderSVG(url, { ecc, border: QUIET_ZONE }), px);
  if (!logo) return svg;
  // The bare module count, to place the tile; `renderSVG` only reports it
  // through the viewBox.
  const { size } = encode(url, { ecc, border: 0 });
  return svg.replace(/<\/svg>\s*$/, `${logoOverlay(size)}</svg>`);
}

/** `<slug>-qr.png` or `<slug>-qr.svg`, so a folder of them sorts by form. */
export function qrFilename(slug: string, ext: 'png' | 'svg'): string {
  return `${slug || 'form'}-qr.${ext}`;
}
