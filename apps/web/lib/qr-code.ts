import { renderSVG } from 'uqr';

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
 */
const ECC = 'M';
const QUIET_ZONE = 4;

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

/** The QR code for `url` as an SVG string, sized and ready to save or rasterize. */
export function qrSvg(url: string, px: number = QR_EXPORT_PX): string {
  return finishSvg(renderSVG(url, { ecc: ECC, border: QUIET_ZONE }), px);
}

/** `<slug>-qr.png` or `<slug>-qr.svg`, so a folder of them sorts by form. */
export function qrFilename(slug: string, ext: 'png' | 'svg'): string {
  return `${slug || 'form'}-qr.${ext}`;
}
